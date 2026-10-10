import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { ToolbarSelect } from './ToolbarSelect';
import { FieldTableControl } from './FieldTableDialog';
import { selectedFieldTable } from '../editor/fieldTables';
import {
  deleteLogicalTable,
  runLogicalTableCommand,
  type LogicalTableCommand,
} from '../editor/commands';
import { FONT_SIZE_OPTIONS, isAllowedFontSize } from '../editor/extensions/FontSize';
import { FONT_FAMILY_OPTIONS, isAllowedFontFamily } from '../editor/extensions/FontFamily';
import { normalizeTextColor } from '../editor/extensions/TextColor';
import {
  LINE_HEIGHT_PRESETS,
  MAX_LINE_HEIGHT,
  MIN_LINE_HEIGHT,
  normalizeLineHeight,
} from '../editor/extensions/LineHeight';

interface EditorToolbarProps {
  editor: Editor;
  onImport: () => void;
  onDownload: () => void;
  onExportHtml: () => void;
  onExportHtmlPdf: () => void;
  onStartSigning: () => void;
  onOpenSignedFiles: () => void;
  isExporting: boolean;
  isImporting: boolean;
  saveLabel: string;
  documentTitle: string;
  onSaveTemplate?: () => void;
  onBack?: () => void;
  hideLegacySigning?: boolean;
}

interface ToolbarButtonProps {
  label: string;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function ToolbarButton({ label, title, active, disabled, onClick }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`toolbar-button${active ? ' is-active' : ''}`}
      disabled={disabled}
      onMouseDown={(event) => {
        event.preventDefault();
        onClick();
      }}
    >
      {label}
    </button>
  );
}

const TABLE_GRID_ROWS = 8;
const TABLE_GRID_COLUMNS = 10;

function TableInsertPicker({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(3);
  const [columns, setColumns] = useState(3);
  const [withHeaderRow, setWithHeaderRow] = useState(true);
  const [position, setPosition] = useState({ top: 50, left: 0 });
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!pickerRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const insertTable = (nextRows = rows, nextColumns = columns) => {
    editor.chain().focus().insertTable({
      rows: Math.max(1, Math.min(20, nextRows)),
      cols: Math.max(1, Math.min(12, nextColumns)),
      withHeaderRow,
    }).run();
    setOpen(false);
  };

  const togglePicker = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 6,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 330)),
      });
    }
    setOpen((current) => !current);
  };

  return (
    <div className="table-insert-control">
      <button
        ref={buttonRef}
        type="button"
        title="选择行列数并插入表格"
        className={`toolbar-button table-insert-trigger${open ? ' is-active' : ''}`}
        aria-expanded={open}
        onMouseDown={(event) => {
          event.preventDefault();
          togglePicker();
        }}
      >
        插入表格 <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div
          ref={pickerRef}
          className="table-insert-picker"
          style={{ top: position.top, left: position.left }}
          role="dialog"
          aria-label="选择表格大小"
        >
          <div className="table-insert-picker__title">{rows} 行 × {columns} 列</div>
          <div
            className="table-size-grid"
            style={{ gridTemplateColumns: `repeat(${TABLE_GRID_COLUMNS}, 22px)` }}
            onMouseLeave={() => {
              setRows(3);
              setColumns(3);
            }}
          >
            {Array.from({ length: TABLE_GRID_ROWS * TABLE_GRID_COLUMNS }, (_, index) => {
              const cellRow = Math.floor(index / TABLE_GRID_COLUMNS) + 1;
              const cellColumn = (index % TABLE_GRID_COLUMNS) + 1;
              return (
                <button
                  key={`${cellRow}-${cellColumn}`}
                  type="button"
                  className={`table-size-cell${cellRow <= rows && cellColumn <= columns ? ' is-selected' : ''}`}
                  title={`${cellRow} 行 × ${cellColumn} 列`}
                  aria-label={`插入 ${cellRow} 行 ${cellColumn} 列表格`}
                  onMouseEnter={() => {
                    setRows(cellRow);
                    setColumns(cellColumn);
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    insertTable(cellRow, cellColumn);
                  }}
                />
              );
            })}
          </div>
          <div className="table-insert-picker__custom">
            <label>行 <input type="number" min="1" max="20" value={rows} onChange={(event) => setRows(Number(event.target.value) || 1)} /></label>
            <label>列 <input type="number" min="1" max="12" value={columns} onChange={(event) => setColumns(Number(event.target.value) || 1)} /></label>
          </div>
          <label className="table-header-option">
            <input type="checkbox" checked={withHeaderRow} onChange={(event) => setWithHeaderRow(event.target.checked)} />
            首行为表头
          </label>
          <button type="button" className="table-insert-confirm" onClick={() => insertTable()}>插入表格</button>
        </div>
      ) : null}
    </div>
  );
}

export function EditorToolbar({
  editor,
  onImport,
  onDownload,
  onExportHtml,
  onExportHtmlPdf,
  onStartSigning,
  onOpenSignedFiles,
  isExporting,
  isImporting,
  saveLabel,
  documentTitle,
  onSaveTemplate,
  onBack,
  hideLegacySigning,
}: EditorToolbarProps) {
  const moreActionsRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    const closeOnOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && !moreActionsRef.current?.contains(event.target)) {
        moreActionsRef.current?.removeAttribute('open');
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') moreActionsRef.current?.removeAttribute('open');
    };
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  const [customLineHeight, setCustomLineHeight] = useState('2');
  const headingLevel = editor.isActive('heading', { level: 1 })
    ? '1'
    : editor.isActive('heading', { level: 2 })
      ? '2'
      : editor.isActive('heading', { level: 3 })
        ? '3'
        : 'paragraph';
  const fieldTableActive = !!selectedFieldTable(editor);
  const tableActive = editor.isActive('table') && !fieldTableActive;
  const activeFontSize = editor.getAttributes('fontSize').size;
  const activeFontFamily = editor.getAttributes('fontFamily').family;
  const activeTextColor = normalizeTextColor(editor.getAttributes('textColor').color) || '#111827';
  const activeLineHeight = normalizeLineHeight(
    editor.isActive('heading')
      ? editor.getAttributes('heading').lineHeight
      : editor.getAttributes('paragraph').lineHeight,
  );
  const lineHeightMode = activeLineHeight === null
    ? 'default'
    : LINE_HEIGHT_PRESETS.includes(activeLineHeight as 1 | 1.5)
      ? String(activeLineHeight)
      : 'custom';

  const runTableCommand = (command: LogicalTableCommand) => {
    runLogicalTableCommand(editor, command);
  };

  const setBlockType = (value: string) => {
    if (value === 'paragraph') {
      editor.chain().focus().setParagraph().run();
      return;
    }
    editor.chain().focus().toggleHeading({ level: Number(value) as 1 | 2 | 3 }).run();
  };

  const setFontSize = (value: string) => {
    if (value === 'default') {
      editor.chain().focus().unsetMark('fontSize').run();
      return;
    }
    const size = Number(value);
    if (isAllowedFontSize(size)) {
      editor.chain().focus().setMark('fontSize', { size }).run();
    }
  };

  const setFontFamily = (value: string) => {
    if (value === 'default') {
      editor.chain().focus().unsetMark('fontFamily').run();
      return;
    }
    if (isAllowedFontFamily(value)) {
      editor.chain().focus().setMark('fontFamily', { family: value }).run();
    }
  };

  const setTextColor = (value: string) => {
    const color = normalizeTextColor(value);
    if (color) editor.chain().focus().setMark('textColor', { color }).run();
  };

  const applyLineHeight = (value: number | null) => {
    const chain = editor.chain().focus();
    if (value === null) {
      chain.resetAttributes('paragraph', 'lineHeight').resetAttributes('heading', 'lineHeight').run();
      return;
    }
    chain.updateAttributes('paragraph', { lineHeight: value }).updateAttributes('heading', { lineHeight: value }).run();
  };

  const setLineHeightMode = (value: string) => {
    if (value === 'default') {
      applyLineHeight(null);
      return;
    }
    if (value === 'custom') {
      const next = normalizeLineHeight(customLineHeight) || 2;
      setCustomLineHeight(String(next));
      applyLineHeight(next);
      return;
    }
    const next = normalizeLineHeight(value);
    if (next) applyLineHeight(next);
  };

  const updateCustomLineHeight = (value: string) => {
    setCustomLineHeight(value);
    const next = normalizeLineHeight(value);
    if (next) applyLineHeight(next);
  };

  return (
    <header className="editor-toolbar" aria-label="合同编辑工具栏">
      <div className="editor-document-bar">
        <div className="editor-document-bar__identity">
          {onBack ? <button type="button" className="secondary-action editor-back" onClick={onBack}>返回模板列表</button> : null}
          <div className="editor-document-title"><strong title={documentTitle}>{documentTitle}</strong><span>合同模板编辑</span></div>
          <span className="save-status" role="status">{saveLabel}</span>
        </div>
        <div className="editor-document-bar__actions">
          <button type="button" className="secondary-action" disabled={isImporting} onClick={onImport}>{isImporting ? '导入中…' : '导入模板 / Word'}</button>
          <button type="button" className="secondary-action" disabled={isExporting} onClick={onExportHtmlPdf}>{isExporting ? '导出中…' : '导出 PDF'}</button>
          <details ref={moreActionsRef} className="editor-more-actions">
            <summary className="secondary-action">更多操作</summary>
            <div className="editor-more-actions__menu" onClick={(event) => {
              if (event.target instanceof HTMLElement && event.target.closest('button')) {
                moreActionsRef.current?.removeAttribute('open');
              }
            }}>
              <button type="button" onClick={onDownload}>下载模板包</button>
              <button type="button" onClick={onExportHtml}>下载 HTML</button>
              {!hideLegacySigning ? <button type="button" onClick={onOpenSignedFiles}>合同记录</button> : null}
            </div>
          </details>
          {!hideLegacySigning ? <button type="button" className="primary-action" onClick={onStartSigning}>发起签署</button> : null}
          {onSaveTemplate ? <button type="button" className="primary-action" onClick={onSaveTemplate}>保存到模板库</button> : null}
        </div>
      </div>
      <div className="editor-format-bar" role="group" aria-label="文字与段落格式">
        <div className="editor-toolbar__group">
          <ToolbarButton label="↶" title="撤销" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()} />
          <ToolbarButton label="↷" title="重做" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()} />
        </div>
        <div className="editor-toolbar__group">
          <ToolbarSelect
            label="段落样式"
            value={headingLevel}
            onChange={setBlockType}
            options={[
              { value: 'paragraph', label: '正文' },
              { value: '1', label: '一级标题' },
              { value: '2', label: '二级标题' },
              { value: '3', label: '三级标题' },
            ]}
          />
          <ToolbarSelect
            label="字号"
            title="设置字号"
            value={isAllowedFontSize(activeFontSize) ? String(activeFontSize) : 'default'}
            onChange={setFontSize}
            options={[
              { value: 'default', label: '默认字号' },
              ...FONT_SIZE_OPTIONS.map(size => ({ value: String(size), label: `${size}px` })),
            ]}
          />
          <ToolbarSelect
            label="字体"
            title="设置字体"
            value={isAllowedFontFamily(activeFontFamily) ? activeFontFamily : 'default'}
            onChange={setFontFamily}
            options={[{ value: 'default', label: '默认字体' }, ...FONT_FAMILY_OPTIONS]}
          />
          <label className="toolbar-color-control" title="设置字体颜色">
            <span>颜色</span>
            <input
              type="color"
              aria-label="字体颜色"
              value={activeTextColor}
              onChange={(event) => setTextColor(event.target.value)}
            />
          </label>
          <ToolbarButton label="还原颜色" title="恢复默认字体颜色" onClick={() => editor.chain().focus().unsetMark('textColor').run()} />
          <ToolbarSelect
            label="行距"
            title="设置行距"
            value={lineHeightMode}
            onChange={setLineHeightMode}
            options={[
              { value: 'default', label: '默认行距' },
              { value: '1', label: '1 倍行距' },
              { value: '1.5', label: '1.5 倍行距' },
              { value: 'custom', label: '自定义' },
            ]}
          />
          {lineHeightMode === 'custom' ? (
            <label className="toolbar-line-height-custom" title={`自定义行距（${MIN_LINE_HEIGHT}～${MAX_LINE_HEIGHT}）`}>
              <span>倍</span>
              <input
                type="number"
                aria-label="自定义行距"
                min={MIN_LINE_HEIGHT}
                max={MAX_LINE_HEIGHT}
                step="0.1"
                value={activeLineHeight === null ? customLineHeight : String(activeLineHeight)}
                onChange={(event) => updateCustomLineHeight(event.target.value)}
              />
            </label>
          ) : null}
          <ToolbarButton label="B" title="加粗（Cmd/Ctrl+B）" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} />
          <ToolbarButton label="I" title="斜体（Cmd/Ctrl+I）" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} />
          <ToolbarButton label="U" title="下划线（Cmd/Ctrl+U）" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} />
          <ToolbarButton label="S" title="删除线" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} />
        </div>
        <div className="editor-toolbar__group">
          <ToolbarButton label="左" title="左对齐" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()} />
          <ToolbarButton label="中" title="居中" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()} />
          <ToolbarButton label="右" title="右对齐" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()} />
          <ToolbarButton label="两端" title="两端对齐" active={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()} />
          <ToolbarButton label="• 列表" title="无序列表" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} />
          <ToolbarButton label="1. 列表" title="有序列表" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
          <ToolbarButton label="清除格式" title="清除选中文本格式" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} />
        </div>
      </div>
      <div className="editor-insert-bar" role="group" aria-label="表格工具">
        <span className="editor-tool-label">插入</span>
        <div className="editor-toolbar__group editor-toolbar__group--table">
          <TableInsertPicker editor={editor} />
          <FieldTableControl editor={editor} />
          {tableActive ? <span className="table-tools-label">表格操作</span> : null}
          <ToolbarButton label="上插行" title="在当前行上方增加一行" disabled={!tableActive} onClick={() => runTableCommand('addRowBefore')} />
          <ToolbarButton label="下插行" title="在当前行下方增加一行" disabled={!tableActive} onClick={() => runTableCommand('addRowAfter')} />
          <ToolbarButton label="删行" title="删除当前行" disabled={!tableActive} onClick={() => runTableCommand('deleteRow')} />
          <ToolbarButton label="左插列" title="在当前列左侧增加一列" disabled={!tableActive} onClick={() => runTableCommand('addColumnBefore')} />
          <ToolbarButton label="右插列" title="在当前列右侧增加一列" disabled={!tableActive} onClick={() => runTableCommand('addColumnAfter')} />
          <ToolbarButton label="删列" title="删除当前列" disabled={!tableActive} onClick={() => runTableCommand('deleteColumn')} />
          <ToolbarButton label="合并" title="拖动选择相邻单元格后合并" disabled={fieldTableActive || !editor.can().mergeCells()} onClick={() => editor.chain().focus().mergeCells().run()} />
          <ToolbarButton label="拆分" title="拆分当前已合并的单元格" disabled={fieldTableActive || !editor.can().splitCell()} onClick={() => editor.chain().focus().splitCell().run()} />
          <ToolbarButton label="表头" title="切换第一行为表头" disabled={!tableActive} onClick={() => runTableCommand('toggleHeaderRow')} />
          <ToolbarButton label="删表" title="删除整张逻辑表格（包括所有续页片段）" disabled={!editor.isActive('table')} onClick={() => deleteLogicalTable(editor)} />
        </div>
      </div>
    </header>
  );
}
