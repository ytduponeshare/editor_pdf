import { useEffect, useMemo, useState } from 'react';
import { type Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import { FontSize, FONT_SIZE_OPTIONS } from '../editor/extensions/FontSize';
import { FontFamily } from '../editor/extensions/FontFamily';
import { TextColor } from '../editor/extensions/TextColor';
import { LineHeight } from '../editor/extensions/LineHeight';
import { DocumentImage } from '../editor/extensions/DocumentImage';
import { createId } from '../editor/id';
import { createDocumentSection, validatePageFurniture, sanitizeFurnitureHtml, type DocumentSection, type FurnitureKind, type FurnitureVariant } from '../editor/pageFurniture';

function FurnitureEditor({ html, onChange }: { html: string; onChange: (html: string) => void }) {
  const extensions = useMemo(() => [
    StarterKit.configure({ blockquote: false, code: false, codeBlock: false, horizontalRule: false, link: false, heading: { levels: [1, 2, 3] } }),
    FontSize, FontFamily, TextColor, LineHeight, DocumentImage,
    Table, TableRow, TableHeader, TableCell,
    TextAlign.configure({ types: ['paragraph', 'heading'] }),
  ], []);
  const editor = useEditor({ extensions, content: html || '<p></p>', onUpdate: ({ editor }) => onChange(sanitizeFurnitureHtml(editor.getHTML())) });
  useEffect(() => {
    const content = html || '<p></p>';
    if (editor && editor.getHTML() !== content) editor.commands.setContent(content, { emitUpdate: false });
  }, [editor, html]);
  if (!editor) return null;
  return <div className="furniture-editor">
    <div className="furniture-editor__tools">
      <button type="button" onClick={() => editor.chain().focus().toggleBold().run()}>加粗</button>
      <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()}>斜体</button>
      <select aria-label="页眉页脚字号" defaultValue="12" onChange={event => editor.chain().focus().setMark('fontSize', { size: Number(event.target.value) }).run()}>
        {FONT_SIZE_OPTIONS.map(size => <option key={size} value={size}>{size}px</option>)}
      </select>
      {(['left', 'center', 'right'] as const).map((align, index) => <button key={align} type="button" onClick={() => editor.chain().focus().setTextAlign(align).run()}>{['左对齐', '居中', '右对齐'][index]}</button>)}
      <button type="button" onClick={() => editor.chain().focus().insertContent('{page}').run()}>插入页码</button>
      <button type="button" onClick={() => editor.chain().focus().insertContent('{pages}').run()}>插入总页数</button>
    </div>
    <EditorContent editor={editor} />
  </div>;
}

export function PageFurniturePanel({ editor }: { editor: Editor }) {
  const furniture = validatePageFurniture(editor.state.doc.attrs.pageFurniture);
  const [sectionId, setSectionId] = useState(furniture.sections[0].id);
  const [variant, setVariant] = useState<FurnitureVariant>('default');
  const [error, setError] = useState('');
  const section = furniture.sections.find(item => item.id === sectionId) || furniture.sections[0];
  const update = (change: Partial<DocumentSection>) => {
    try {
      const next = validatePageFurniture({ sections: furniture.sections.map(item => item.id === section.id ? { ...item, ...change } : item) });
      editor.commands.command(({ tr }) => { tr.setDocAttribute('pageFurniture', next); return true; });
      setError('');
    } catch (error) { setError(error instanceof Error ? error.message : '页眉页脚设置失败'); }
  };
  const startSection = () => {
    const index = editor.state.selection.$head.index(0);
    const current = editor.state.doc.child(index);
    const currentSection = furniture.sections.find(item => item.id === current.attrs.sectionId) || section;
    const id = createId('section');
    const next = { ...currentSection, id, name: `第 ${furniture.sections.length + 1} 节` };
    if (furniture.sections.length >= 100) { setError('最多支持 100 节'); return; }
    editor.commands.command(({ tr }) => {
      const sections = [...furniture.sections];
      sections.splice(sections.findIndex(item => item.id === currentSection.id) + 1, 0, next);
      tr.setDocAttribute('pageFurniture', { sections });
      let ended = false;
      editor.state.doc.forEach((page, position, pageIndex) => {
        if (pageIndex < index || ended) return;
        if (page.attrs.sectionId !== current.attrs.sectionId) { ended = true; return; }
        tr.setNodeMarkup(position, undefined, { ...page.attrs, sectionId: id, ...(pageIndex === index && index > 0 ? { breakType: 'manual' } : {}) });
      });
      return true;
    });
    setSectionId(id);
  };
  const variants: FurnitureVariant[] = ['default', ...(section.differentFirstPage ? ['first' as const] : []), ...(section.differentOddEven ? ['even' as const] : [])];
  const activeVariant = variants.includes(variant) ? variant : 'default';
  return <section className="sidebar-section furniture-panel">
    <h2>页眉页脚</h2>
    <label>编辑节<select aria-label="编辑节" value={section.id} onChange={event => setSectionId(event.target.value)}>{furniture.sections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label>节名称<input type="text" value={section.name} maxLength={50} onChange={event => update({ name: event.target.value || '未命名节' })} /></label>
    <button type="button" onClick={startSection}>从当前页开始新节</button>
    <button type="button" onClick={() => {
      const index = furniture.sections.findIndex(item => item.id === section.id);
      if (index > 0) { const previous = furniture.sections[index - 1]; update({ ...previous, id: section.id, name: section.name }); }
    }} disabled={furniture.sections[0].id === section.id}>复制上一节设置</button>
    <label className="furniture-check"><input type="checkbox" checked={section.differentFirstPage} onChange={event => update({ differentFirstPage: event.target.checked })} />首页不同（每节）</label>
    <label className="furniture-check"><input type="checkbox" checked={section.differentOddEven} onChange={event => update({ differentOddEven: event.target.checked })} />奇偶页不同</label>
    <label>页面类型<select aria-label="页眉页脚页面类型" value={activeVariant} onChange={event => setVariant(event.target.value as FurnitureVariant)}>{variants.map(item => <option key={item} value={item}>{item === 'first' ? '首页' : item === 'even' ? '偶数页' : section.differentOddEven ? '奇数页' : '普通页'}</option>)}</select></label>
    {(['header', 'footer'] as FurnitureKind[]).map(kind => <div key={kind}>
      <label className="furniture-check"><input type="checkbox" checked={section[`${kind}Enabled`]} onChange={event => update({ [`${kind}Enabled`]: event.target.checked })} />启用{kind === 'header' ? '页眉' : '页脚'}</label>
      {section[`${kind}Enabled`] ? <>
        <label>{kind === 'header' ? '页眉' : '页脚'}高度（mm）<input key={`${section.id}-${kind}-${section[`${kind}HeightMm`]}`} type="number" min="5" max="40" defaultValue={section[`${kind}HeightMm`]} onBlur={event => {
          const value = Number(event.target.value);
          update({ [`${kind}HeightMm`]: value });
          if (value < 5 || value > 40) event.target.value = String(section[`${kind}HeightMm`]);
        }} /></label>
        <FurnitureEditor key={`${section.id}-${kind}-${activeVariant}`} html={section[kind][activeVariant]} onChange={html => update({ [kind]: { ...section[kind], [activeVariant]: html } })} />
      </> : null}
    </div>)}
    <p className="sidebar-hint">页码按整份文档连续计算。输入 {'{page}'}、{'{pages}'} 可显示当前页和总页数。调整高度会重新分页。</p>
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
