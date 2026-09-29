import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import { fieldCatalogService } from '../services/fieldCatalog';
import { createId } from '../editor/id';
import { applyFieldTable, copyFieldTable, selectedFieldTable } from '../editor/fieldTables';
import { isFieldTableConfig, type BasicFieldType, type CatalogSource, type CatalogField, type FieldTableConfig, type FieldTableColumn } from '../editor/fieldTableTypes';
import { FIELD_LABELS } from '../editor/types';
import { getRoles } from '../editor/roles';

function Dialog({ editor, initial, tableId, onClose }: {
  editor: Editor; initial?: FieldTableConfig; tableId?: string; onClose: () => void;
}) {
  const [config, setConfig] = useState<FieldTableConfig>(initial || { version: 1, mode: 'list', sourceId: '', rows: 1, columns: [] });
  const [sources, setSources] = useState<CatalogSource[]>([]);
  const [catalog, setCatalog] = useState<Record<string, CatalogField[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [browseSource, setBrowseSource] = useState('');
  const roles = getRoles(editor);
  const position = useRef(editor.state.selection.from);
  const submitting = useRef(false);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const map = ({ transaction }: { transaction: typeof editor.state.tr }) => {
      position.current = transaction.mapping.map(position.current);
    };
    editor.on('transaction', map);
    closeButton.current?.focus();
    return () => { editor.off('transaction', map); };
  }, [editor]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    (async () => {
      const nextSources = await fieldCatalogService.getSources();
      const selected = config.mode === 'custom' ? nextSources : nextSources.filter(s => s.id === config.sourceId);
      const entries = await Promise.all(selected.map(async s => ({ id: s.id, fields: await fieldCatalogService.getFields(s.id) })));
      if (cancelled) return;
      const next: Record<string, CatalogField[]> = {};
      entries.forEach(entry => { next[entry.id] = entry.fields; });
      setSources(nextSources); setCatalog(next);
    })().catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : '加载失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [config.mode, config.sourceId, retry]);

  const changeSource = (mode: FieldTableConfig['mode'], sourceId: string) => {
    if (config.columns.length && !window.confirm('切换来源会清空当前列配置；原表格将在确认保存后重建。继续吗？')) return;
    setConfig({ version: 1, mode, sourceId, rows: mode === 'list' ? 1 : config.rows, columns: [] });
  };
  const updateColumn = (id: string, patch: Partial<FieldTableColumn>) => setConfig(c => ({ ...c, columns: c.columns.map(col => col.id === id ? { ...col, ...patch } : col) }));
  const addField = (source: CatalogSource, field: CatalogField) => {
    const binding = source.id === 'system'
      ? { kind: 'system' as const, fieldId: field.id, fieldName: field.name, inputType: field.inputType || 'text', options: field.options }
      : source.kind === 'category'
      ? { kind: 'category' as const, sourceId: source.id, fieldId: field.id }
      : config.mode === 'list' ? { kind: 'current' as const, sourceId: source.id, fieldId: field.id }
        : { kind: 'record' as const, sourceId: source.id, fieldId: field.id, record: 1 };
    setConfig(c => c.columns.length >= 12 ? c : ({ ...c, columns: [...c.columns, { id: createId('column'), title: field.name, type: field.type, binding }] }));
  };
  const isAvailable = (column: FieldTableColumn) => {
    const b = column.binding;
    if (b.kind === 'control') return true;
    if (b.kind === 'system') return true;
    const source = sources.find(s => s.id === b.sourceId);
    return source?.kind === (b.kind === 'category' ? 'category' : 'list')
      && catalog[b.sourceId]?.some(f => f.id === b.fieldId && f.type === column.type);
  };
  const bindingLabel = (column: FieldTableColumn) => {
    const binding = column.binding;
    if (binding.kind === 'control') return FIELD_LABELS[column.type];
    if (binding.kind === 'system') return `系统字段 / ${binding.fieldName}`;
    return `${sources.find(s => s.id === binding.sourceId)?.name || '来源失效'} / ${catalog[binding.sourceId]?.find(f => f.id === binding.fieldId)?.name || '字段失效'}`;
  };
  const invalid = !loading && !error && (config.columns.some(c => !isAvailable(c))
    || (config.columns.some(c => c.binding.kind === 'control' || c.binding.kind === 'system') && !config.roleId));
  const save = async () => {
    if (submitting.current || loading || error || invalid || !isFieldTableConfig(config)) return;
    const removes = initial && (initial.mode !== config.mode || initial.sourceId !== config.sourceId
      || config.rows < initial.rows || initial.columns.some(c => !config.columns.some(next => next.id === c.id)));
    if (removes && !window.confirm('此次修改会删除部分单元格及其内容，或重建表格。确认保存吗？')) return;
    submitting.current = true;
    try {
      const previewRecords = config.sourceId ? await fieldCatalogService.getRecords(config.sourceId) : [];
      if (applyFieldTable(editor, config, position.current, tableId, previewRecords)) onClose();
      else { submitting.current = false; setError('无法在此位置更新表格，请关闭后重新选择位置。'); }
    } catch (reason) {
      submitting.current = false;
      setError(reason instanceof Error ? reason.message : '表格数据加载失败');
    }
  };
  const activeSource = config.mode === 'custom' ? browseSource : config.sourceId;
  const source = sources.find(s => s.id === activeSource);
  const visibleFields = catalog[activeSource] || [];
  return createPortal(<div className="field-table-backdrop" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    if (event.key === 'Tab') {
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)'));
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <section className="field-table-dialog" role="dialog" aria-modal="true" aria-labelledby="field-table-title">
      <div className="field-table-heading"><h2 id="field-table-title">{initial ? '配置表格' : '插入字段表格'}</h2><button ref={closeButton} onClick={onClose} type="button" aria-label="关闭字段表格配置">×</button></div>
      <div className="field-table-options">
        <label>模式 <select value={config.mode} onChange={e => changeSource(e.target.value as FieldTableConfig['mode'], '')}>
          <option value="list">数据列表</option><option value="category">分类</option><option value="custom">自定义</option>
        </select></label>
        <label>字段来源 <select value={activeSource} disabled={loading} onChange={e => config.mode === 'custom' ? setBrowseSource(e.target.value) : changeSource(config.mode, e.target.value)}>
          <option value="">请选择来源</option>
          {sources.filter(s => config.mode === 'custom' || s.kind === config.mode).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></label>
        {config.mode !== 'list' ? <label>数据行数 <input aria-label="数据行数" type="number" min={1} max={20} value={config.rows} onChange={e => setConfig(c => ({ ...c, rows: Number(e.target.value) }))} /></label> : <span>一行样例 · 将来按记录数重复</span>}
        <label>填写角色 <select aria-label="字段表格填写角色" value={config.roleId || ''} onChange={e => {
          const role = roles.find(item => item.id === e.target.value);
          setConfig(c => ({ ...c, roleId: role?.id, roleName: role?.name }));
        }}><option value="">只读表格</option>{roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
      </div>
      {loading ? <p role="status">加载字段中…</p> : error ? <p role="alert">{error} <button onClick={() => setRetry(r => r + 1)}>重试</button></p> : <>
        <div className="field-table-choices">
          {visibleFields.map(field => <button type="button" disabled={config.columns.length >= 12} key={field.id} onClick={() => { if (source) addField(source, field); }}>＋ {field.name}</button>)}
          {source && !visibleFields.length ? <span>该来源暂无字段</span> : null}
          {!sources.length ? <span>暂无可用来源</span> : null}
        </div>
        {config.mode === 'custom' ? <div className="field-table-choices"><span>兼容字段</span>{(['text', 'number', 'date', 'phone'] as BasicFieldType[]).map(type => <button key={type} type="button" disabled={config.columns.length >= 12} onClick={() => setConfig(c => ({ ...c, columns: [...c.columns, { id: createId('column'), title: FIELD_LABELS[type], type, binding: { kind: 'control', type } }] }))}>＋ {FIELD_LABELS[type]}</button>)}</div> : null}
      </>}
      {invalid ? <p role="alert">部分字段已失效，请移除后重新选择。已有绑定仍保留，取消不会更改原表格。</p> : null}
      <div className="field-table-columns">{config.columns.map((col, index) => <div className="field-table-column" key={col.id}>
        <span>{index + 1}</span><input aria-label={`第${index + 1}列标题`} maxLength={50} value={col.title} onChange={e => updateColumn(col.id, { title: e.target.value })} />
        <small>{loading ? '加载中…' : bindingLabel(col)}{!loading && !error && !isAvailable(col) ? '（失效）' : ''}</small>
        {col.binding.kind === 'record' ? <label>第 <input aria-label={`第${index + 1}列记录序号`} type="number" min={1} value={col.binding.record} onChange={e => { if (col.binding.kind === 'record') updateColumn(col.id, { binding: { ...col.binding, record: Number(e.target.value) } }); }} /> 条</label> : null}
        {[-1, 1].map(delta => <button key={delta} type="button" aria-label={`${delta < 0 ? '上移' : '下移'}第${index + 1}列`} disabled={index + delta < 0 || index + delta >= config.columns.length} onClick={() => setConfig(c => { const columns = [...c.columns]; [columns[index], columns[index + delta]] = [columns[index + delta], columns[index]]; return { ...c, columns }; })}>{delta < 0 ? '↑' : '↓'}</button>)}
        <button type="button" aria-label={`移除第${index + 1}列`} onClick={() => setConfig(c => ({ ...c, columns: c.columns.filter(column => column.id !== col.id) }))}>移除</button>
      </div>)}</div>
      <h3>预览</h3>
      <div className="field-table-preview">{config.columns.length ? <table><thead><tr>{config.columns.map(c => <th key={c.id}>{c.title}</th>)}</tr></thead><tbody>{Array.from({ length: Math.max(1, Math.min(20, config.rows || 1)) }, (_, r) => <tr key={r}>{config.columns.map(c => <td key={c.id}><span>{c.title}</span></td>)}</tr>)}</tbody></table> : <p>请选择字段组成表格，最多12列。</p>}</div>
      <div className="field-table-footer"><button type="button" onClick={onClose}>取消</button><button type="button" className="primary-action" disabled={loading || !!error || invalid || !isFieldTableConfig(config)} onClick={save}>{initial ? '保存配置' : '插入字段表格'}</button></div>
    </section>
  </div>, document.body);
}

export function FieldTableControl({ editor }: { editor: Editor }) {
  const [session, setSession] = useState<{ initial?: FieldTableConfig; tableId?: string } | null>(null);
  const selected = selectedFieldTable(editor);
  return <>
    <button type="button" className="toolbar-button" onMouseDown={e => { e.preventDefault(); setSession({}); }}>字段表格</button>
    {selected ? <button type="button" className="toolbar-button" onMouseDown={e => { e.preventDefault(); setSession({ initial: selected.config, tableId: selected.id }); }}>配置表格</button> : null}
    {selected ? <button type="button" className="toolbar-button" onMouseDown={e => { e.preventDefault(); copyFieldTable(editor); }}>复制表格</button> : null}
    {session ? <Dialog editor={editor} initial={session.initial} tableId={session.tableId} onClose={() => { setSession(null); editor.view.focus(); }} /> : null}
  </>;
}
