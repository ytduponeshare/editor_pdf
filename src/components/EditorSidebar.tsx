import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { RoleBindingPanel, RoleManager } from './RoleBindingPanel';
import {
  createAndBindLayoutAnchor,
  deleteSelectedReference,
  duplicateSelectedReference,
  getFields,
  getLayoutAnchors,
  getPageMargins,
  getSelectedFieldReference,
  insertExistingField,
  insertNewField,
  renameField,
  resetSelectedReferenceSize,
  updateSelectedReference,
  updatePageMargins,
} from '../editor/commands';
import {
  FIELD_LABELS,
  MAX_PAGE_MARGIN_MM,
  MIN_PAGE_MARGIN_MM,
  PAGE_SETTINGS,
  clampPageMargin,
  type FieldDefinition,
  type FieldType,
  type PageMargins,
} from '../editor/types';

export const CONTROL_DRAG_TYPE = 'application/x-contract-control';

interface DragPayload {
  kind: 'new' | 'existing';
  type?: FieldType;
  fieldId?: string;
}

interface EditorSidebarProps {
  editor: Editor;
  revision: number;
  insertionPosition: number | null;
  onInsertionUnavailable: () => void;
}

const CONTROL_ICONS: Record<FieldType, string> = {
  text: 'T', number: '123', date: '日', phone: '☎', signature: '签', companySeal: '章',
};

function writeDragPayload(event: React.DragEvent, payload: DragPayload) {
  const serialized = JSON.stringify(payload);
  event.dataTransfer.setData(CONTROL_DRAG_TYPE, serialized);
  event.dataTransfer.setData('text/plain', serialized);
  event.dataTransfer.effectAllowed = 'copy';
}

function ControlItem({ type, onInsert }: { type: FieldType; onInsert: () => void }) {
  return (
    <button type="button" className="control-item" draggable onDragStart={(event) => writeDragPayload(event, { kind: 'new', type })} onClick={onInsert}>
      <span className="control-item__icon">{CONTROL_ICONS[type]}</span>
      <span>{FIELD_LABELS[type]}</span>
    </button>
  );
}

function FieldLibraryItem({
  field,
  editor,
  insertionPosition,
  onInsertionUnavailable,
}: {
  field: FieldDefinition;
  editor: Editor;
  insertionPosition: number | null;
  onInsertionUnavailable: () => void;
}) {
  const insertAtCaret = () => {
    if (
      insertionPosition === null
      || !insertExistingField(editor, field.id, insertionPosition)
    ) {
      onInsertionUnavailable();
    }
  };

  return (
    <button type="button" className="document-field" draggable onDragStart={(event) => writeDragPayload(event, { kind: 'existing', fieldId: field.id })} onClick={insertAtCaret} title={`再次插入“${field.name}”`}>
      <span className="document-field__type">{CONTROL_ICONS[field.type]}</span>
      <span className="document-field__name">{field.name}</span>
    </button>
  );
}

function getFloatingAvailableSize(refId: string): { width: number; height: number } | null {
  const wrapper = Array.from(document.querySelectorAll<HTMLElement>('[data-ref-id]'))
    .find((element) => element.dataset.refId === refId);
  const box = wrapper?.querySelector<HTMLElement>('.page-overlay__box, .floating-field__box');
  const safeArea = box?.closest<HTMLElement>('.contract-page')
    ?.querySelector<HTMLElement>('.contract-page__content');
  if (!box || !safeArea) return null;

  const boxRect = box.getBoundingClientRect();
  const safeRect = safeArea.getBoundingClientRect();
  return {
    width: Math.floor(safeRect.right - boxRect.left),
    height: Math.floor(safeRect.bottom - boxRect.top),
  };
}

const MARGIN_FIELDS: Array<{ key: keyof PageMargins; label: string }> = [
  { key: 'top', label: '上' },
  { key: 'right', label: '右' },
  { key: 'bottom', label: '下' },
  { key: 'left', label: '左' },
];

function PageSettingsPanel({ editor }: { editor: Editor }) {
  const margins = getPageMargins(editor);
  const [linked, setLinked] = useState(
    margins.top === margins.right && margins.top === margins.bottom && margins.top === margins.left,
  );

  const changeMargin = (key: keyof PageMargins, rawValue: string) => {
    const value = clampPageMargin(rawValue);
    const next = linked
      ? { top: value, right: value, bottom: value, left: value }
      : { ...margins, [key]: value };
    updatePageMargins(editor, next);
  };

  return (
    <section className="page-settings-panel">
      <div className="page-settings-panel__heading">
        <div><strong>页面设置</strong><small>A4 纵向 · 全部页面</small></div>
        <label><input type="checkbox" checked={linked} onChange={(event) => setLinked(event.target.checked)} /> 四边联动</label>
      </div>
      <div className="page-margin-grid">
        {MARGIN_FIELDS.map(({ key, label }) => (
          <label key={key}>
            <span>{label}边距</span>
            <div><input type="number" min={MIN_PAGE_MARGIN_MM} max={MAX_PAGE_MARGIN_MM} value={margins[key]} onChange={(event) => changeMargin(key, event.target.value)} /><span>mm</span></div>
          </label>
        ))}
      </div>
      <p>正文和浮动控件只能位于页边距以内的安全区域。</p>
      <button type="button" className="page-settings-reset" onClick={() => updatePageMargins(editor, { ...PAGE_SETTINGS.marginsMm })}>恢复默认 20mm</button>
    </section>
  );
}

function PropertyPanel({ editor, revision, insertionPosition }: Pick<EditorSidebarProps, 'editor' | 'revision' | 'insertionPosition'>) {
  const selected = getSelectedFieldReference(editor);
  const [name, setName] = useState(selected?.field.name || '');

  useEffect(() => {
    setName(selected?.field.name || '');
  }, [selected?.field.id, selected?.field.name, revision]);

  if (!selected) {
    return <div className="sidebar-empty"><span>未选中控件</span><p>在页面中点击一个字段占位控件后，可在这里编辑属性。</p></div>;
  }

  const isFloating = selected.node.type.name === 'floatingField'
    || selected.node.type.name === 'pageOverlay';
  const supportsAnchor = selected.node.type.name === 'pageOverlay';
  const positionMode = selected.node.attrs.positionMode === 'anchor' ? 'anchor' : 'page';
  const anchors = supportsAnchor ? getLayoutAnchors(editor) : [];
  const minimumWidth = isFloating
    ? selected.field.type === 'signature' ? 80 : 60
    : 60;
  const minimumHeight = selected.field.type === 'signature' ? 40 : 60;
  const floatingAvailableSize = isFloating
    ? getFloatingAvailableSize(selected.node.attrs.refId)
    : null;
  const maximumWidth = isFloating
    ? Math.max(minimumWidth, Math.min(794, floatingAvailableSize?.width || 794))
    : 400;
  const maximumHeight = Math.max(
    minimumHeight,
    Math.min(1123, floatingAvailableSize?.height || 1123),
  );
  const commitName = () => {
    if (!renameField(editor, selected.field.id, name)) setName(selected.field.name);
  };

  return (
    <div className="property-panel">
      <RoleBindingPanel editor={editor} field={selected.field} />
      <div className="property-panel__type">
        <span className="control-item__icon">{CONTROL_ICONS[selected.field.type]}</span>
        <div><strong>{FIELD_LABELS[selected.field.type]}</strong><small>{isFloating ? '浮动占位控件' : '文流占位控件'}</small></div>
      </div>
      <label className="property-field">
        <span>控件名称</span>
        <input value={name} maxLength={50} onChange={(event) => setName(event.target.value)} onBlur={commitName} onKeyDown={(event) => { if (event.key === 'Enter') { commitName(); event.currentTarget.blur(); } }} />
      </label>
      <label className="property-field">
        <span>宽度（px）</span>
        <input type="number" min={minimumWidth} max={maximumWidth} value={selected.node.attrs.width} onChange={(event) => updateSelectedReference(editor, { width: Math.min(maximumWidth, Math.max(minimumWidth, Number(event.target.value) || 0)) })} />
      </label>
      {isFloating ? (
        <label className="property-field">
          <span>高度（px）</span>
          <input type="number" min={minimumHeight} max={maximumHeight} value={selected.node.attrs.height} onChange={(event) => updateSelectedReference(editor, { height: Math.min(maximumHeight, Math.max(minimumHeight, Number(event.target.value) || 0)) })} />
        </label>
      ) : null}
      {supportsAnchor ? (
        <section className="anchor-property-section">
          <label className="property-field">
            <span>定位方式</span>
            <select
              value={positionMode}
              onChange={(event) => updateSelectedReference(editor, event.target.value === 'anchor'
                ? {
                    positionMode: 'anchor',
                    anchorId: selected.node.attrs.anchorId || anchors[0]?.id || null,
                    anchorAlign: selected.node.attrs.anchorAlign || 'left',
                    anchorOffsetX: Number(selected.node.attrs.anchorOffsetX) || 0,
                    anchorOffsetY: Number(selected.node.attrs.anchorOffsetY) || 0,
                  }
                : { positionMode: 'page', anchorId: null })}
            >
              <option value="page">固定在当前页面</option>
              <option value="anchor" disabled={!anchors.length}>跟随正文锚点</option>
            </select>
          </label>
          {positionMode === 'anchor' ? (
            <>
              <label className="property-field">
                <span>锚点</span>
                <select value={selected.node.attrs.anchorId || ''} onChange={(event) => updateSelectedReference(editor, { anchorId: event.target.value })}>
                  <option value="" disabled>请选择锚点</option>
                  {anchors.map(anchor => <option key={anchor.id} value={anchor.id}>{anchor.name}</option>)}
                </select>
              </label>
              <label className="property-field">
                <span>水平对齐</span>
                <select value={selected.node.attrs.anchorAlign || 'left'} onChange={(event) => updateSelectedReference(editor, { anchorAlign: event.target.value })}>
                  <option value="left">左对齐</option>
                  <option value="center">居中</option>
                  <option value="right">右对齐</option>
                </select>
              </label>
              <label className="property-field">
                <span>横向偏移（px）</span>
                <input type="number" value={Number(selected.node.attrs.anchorOffsetX) || 0} onChange={(event) => updateSelectedReference(editor, { anchorOffsetX: Number(event.target.value) || 0 })} />
              </label>
              <label className="property-field">
                <span>纵向偏移（px）</span>
                <input type="number" min={0} value={Number(selected.node.attrs.anchorOffsetY) || 0} onChange={(event) => updateSelectedReference(editor, { anchorOffsetY: Math.max(0, Number(event.target.value) || 0) })} />
              </label>
              <p className="sidebar-hint">锚点空间不足时会整体移动到下一页，签署区和企业章不会拆分。</p>
            </>
          ) : null}
          <button type="button" onClick={() => createAndBindLayoutAnchor(editor, insertionPosition)}>在正文光标后新建锚点并绑定</button>
        </section>
      ) : null}
      <div className="property-panel__actions">
        {selected.node.attrs.boundColumn ? <p>此控件绑定字段表格，增删列请使用工具栏“配置表格”。</p> : null}
        <button type="button" onClick={() => resetSelectedReferenceSize(editor)}>恢复默认尺寸</button>
        <button type="button" disabled={!!selected.node.attrs.boundColumn} onClick={() => duplicateSelectedReference(editor, false)}>复制引用</button>
        <button type="button" disabled={!!selected.node.attrs.boundColumn} onClick={() => duplicateSelectedReference(editor, true)}>复制为独立字段</button>
        <button type="button" disabled={!!selected.node.attrs.boundColumn} className="danger-action" onClick={() => deleteSelectedReference(editor)}>删除控件</button>
      </div>
    </div>
  );
}

export function EditorSidebar({
  editor,
  revision,
  insertionPosition,
  onInsertionUnavailable,
}: EditorSidebarProps) {
  const selected = getSelectedFieldReference(editor);
  const [activeTab, setActiveTab] = useState<'library' | 'properties'>(selected ? 'properties' : 'library');
  const fields = getFields(editor);

  useEffect(() => {
    if (selected) setActiveTab('properties');
  }, [selected?.node.attrs.refId]);

  const insertAtCaret = (type: FieldType) => {
    if (
      insertionPosition === null
      || !insertNewField(editor, type, insertionPosition)
    ) {
      onInsertionUnavailable();
    }
  };

  return (
    <aside className="editor-sidebar">
      <div className="sidebar-tabs">
        <button type="button" className={activeTab === 'library' ? 'is-active' : ''} onClick={() => setActiveTab('library')}>控件库</button>
        <button type="button" className={activeTab === 'properties' ? 'is-active' : ''} onClick={() => setActiveTab('properties')}>属性设置</button>
      </div>
      <RoleManager editor={editor} />
      {activeTab === 'library' ? (
        <div className="sidebar-content">
          <section className="sidebar-section">
            <h2>基础字段</h2>
            <div className="control-grid">{(['text', 'number', 'date', 'phone'] as FieldType[]).map((type) => <ControlItem key={type} type={type} onInsert={() => insertAtCaret(type)} />)}</div>
          </section>
          <section className="sidebar-section">
            <h2>签署控件</h2>
            <div className="control-grid">{(['signature', 'companySeal'] as FieldType[]).map((type) => <ControlItem key={type} type={type} onInsert={() => insertAtCaret(type)} />)}</div>
          </section>
          <section className="sidebar-section">
            <h2>文档字段 <span>{fields.length}</span></h2>
            {fields.length ? <div className="document-fields">{fields.map((field) => <FieldLibraryItem key={field.id} field={field} editor={editor} insertionPosition={insertionPosition} onInsertionUnavailable={onInsertionUnavailable} />)}</div> : <p className="sidebar-hint">插入控件后，可在这里复用已有字段。</p>}
          </section>
        </div>
      ) : (
        <div className="sidebar-content">
          <PageSettingsPanel editor={editor} />
          {selected ? (
            <div className="control-property-section">
              <PropertyPanel editor={editor} revision={revision} insertionPosition={insertionPosition} />
            </div>
          ) : null}
        </div>
      )}
    </aside>
  );
}
