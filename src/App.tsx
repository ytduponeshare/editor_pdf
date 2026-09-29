import { useEffect, useMemo, useRef, useState } from 'react';
import { getSchema, type Editor as TiptapEditor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { EditorContent, useEditor } from '@tiptap/react';
import { EditorToolbar } from './components/EditorToolbar';
import { CONTROL_DRAG_TYPE, EditorSidebar } from './components/EditorSidebar';
import { insertExistingField, insertNewField } from './editor/commands';
import { createEditorExtensions } from './editor/extensions';
import {
  createEmptyRuntimeDocument,
  downloadTemplate,
  downloadHtml,
  hydrateTemplateSource,
  loadTemplateFromLocalStorage,
  readTemplateFile,
  saveTemplateToLocalStorage,
  createSanitizedPrintHtml,
} from './editor/template';
import { type FieldType } from './editor/types';
import { pdfExportService } from './services/pdfExport';
import { type ContractTemplateSource } from './editor/types';

type SaveState = 'saved' | 'saving' | 'error';

interface DragPayload {
  kind: 'new' | 'existing';
  type?: FieldType;
  fieldId?: string;
}

function getInitialDocument(extensions: ReturnType<typeof createEditorExtensions>, template?: ContractTemplateSource) {
  const schema = getSchema(extensions);
  try {
    const storedTemplate = template || loadTemplateFromLocalStorage(schema);
    return { content: storedTemplate ? hydrateTemplateSource(storedTemplate) : createEmptyRuntimeDocument(), error: '' };
  } catch (error) {
    return {
      content: createEmptyRuntimeDocument(),
      error: error instanceof Error ? `本地模板恢复失败：${error.message}` : '本地模板恢复失败',
    };
  }
}

function hasOverflowingPage(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.contract-page[data-overflow="true"]');
}

export function ContractEditor() {
  const extensions = useMemo(() => createEditorExtensions(), []);
  const initial = useMemo(() => getInitialDocument(extensions), [extensions]);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState(initial.error);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [isExporting, setIsExporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const lastCaretPositionRef = useRef<number | null>(null);

  const editor = useEditor({ extensions, content: initial.content, autofocus: 'end' });
  useEffect(() => {
    if (!editor) return undefined;

    const initialSelection = editor.state.selection;
    if (
      initialSelection instanceof TextSelection
      && initialSelection.$head.parent.inlineContent
    ) {
      lastCaretPositionRef.current = initialSelection.head;
    }

    const updateRevision = ({ transaction }: { transaction: typeof editor.state.tr }) => {
      if (lastCaretPositionRef.current !== null && transaction.docChanged) {
        lastCaretPositionRef.current = transaction.mapping.map(
          lastCaretPositionRef.current,
          1,
        );
      }

      const selection = editor.state.selection;
      if (
        transaction.selectionSet
        && selection instanceof TextSelection
        && selection.$head.parent.inlineContent
      ) {
        lastCaretPositionRef.current = selection.head;
      }
      setRevision((current) => current + 1);
    };
    const scheduleSave = () => {
      setSaveState('saving');
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        try {
          saveTemplateToLocalStorage(editor);
          setSaveState('saved');
        } catch (error) {
          setSaveState('error');
          setMessage(error instanceof Error ? error.message : '自动保存失败');
        }
      }, 500);
    };

    editor.on('transaction', updateRevision);
    editor.on('update', scheduleSave);
    return () => {
      editor.off('transaction', updateRevision);
      editor.off('update', scheduleSave);
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    };
  }, [editor]);

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    const raw = event.dataTransfer.getData(CONTROL_DRAG_TYPE);
    if (!raw || !editor) return;

    event.preventDefault();
    event.stopPropagation();
    try {
      const payload = JSON.parse(raw) as DragPayload;
      const position = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
      const inserted = payload.kind === 'new' && payload.type
        ? insertNewField(editor, payload.type, position)
        : payload.kind === 'existing' && payload.fieldId
          ? insertExistingField(editor, payload.fieldId, position)
          : false;
      if (!inserted) setMessage('该位置无法插入控件，请拖到页面可编辑区域');
    } catch {
      setMessage('无法识别拖入的控件');
    }
  };

  const handleImport = async (file: File) => {
    if (!editor) return;
    try {
      const template = await readTemplateFile(file, editor.schema);
      if (!window.confirm('导入模板会覆盖当前内容，确定继续吗？')) return;
      editor.commands.setContent(hydrateTemplateSource(template), { emitUpdate: true });
      setMessage('模板导入成功');
    } catch (error) {
      setMessage(error instanceof Error ? `导入失败：${error.message}` : '模板导入失败');
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const handleHtmlPdfExport = async (activeEditor: TiptapEditor) => {
    const overflowingPage = hasOverflowingPage();
    if (overflowingPage) {
      setMessage('存在内容溢出的页面，请调整后再导出。');
      overflowingPage.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setIsExporting(true);
    setMessage('');
    try {
      await pdfExportService.exportHtmlPdf(createSanitizedPrintHtml(activeEditor));
      setMessage('PDF 导出成功');
    } catch (error) {
      setMessage(error instanceof Error ? `导出失败：${error.message}` : 'HTML PDF 导出失败，请重试');
    } finally {
      setIsExporting(false);
    }
  };

  const handleHtmlExport = (activeEditor: TiptapEditor) => {
    const overflowingPage = hasOverflowingPage();
    if (overflowingPage) {
      setMessage('存在内容溢出的页面，请调整后再导出。');
      overflowingPage.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    downloadHtml(activeEditor);
    setMessage('HTML 导出成功');
  };

  if (!editor) return <div className="app-loading">编辑器加载中…</div>;


  const saveLabel = saveState === 'saving' ? '保存中…' : saveState === 'error' ? '保存失败' : '已保存到本地';

  return (
    <div className="app-shell">
      <EditorToolbar
        editor={editor}
        onImport={() => importInputRef.current?.click()}
        onDownload={() => downloadTemplate(editor, 'html')}
        onExportHtml={() => handleHtmlExport(editor)}
        onExportHtmlPdf={() => void handleHtmlPdfExport(editor)}
        isExporting={isExporting}
        saveLabel={saveLabel}
      />
      {message ? <div className="app-message" role="status"><span>{message}</span><button type="button" onClick={() => setMessage('')} aria-label="关闭提示">×</button></div> : null}
      <div className="editor-layout">
        <main
          className="editor-canvas"
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes(CONTROL_DRAG_TYPE)) {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
            }
          }}
          onDrop={handleDrop}
        >
          <EditorContent editor={editor} />
        </main>
        <EditorSidebar
          editor={editor}
          revision={revision}
          insertionPosition={lastCaretPositionRef.current}
          onInsertionUnavailable={() => {
            setMessage('请先在正文中点击选择插入位置，或将控件拖入页面');
          }}
        />
      </div>
      <input
        ref={importInputRef}
        className="visually-hidden"
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleImport(file);
        }}
      />
    </div>
  );
}

export default function App() {
  return <ContractEditor />;
}
