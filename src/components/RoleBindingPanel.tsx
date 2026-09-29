import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { bindingTypeFor, type FieldDefinition } from '../editor/types';
import { getRoles, isTableBound, removeRole, saveRole, updateFieldBinding, updateFieldRole } from '../editor/roles';
import { fieldCatalogService, type RoleCatalogField } from '../services/fieldCatalog';
import type { CatalogSource } from '../editor/fieldTableTypes';

export function RoleManager({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string>();
  const [error, setError] = useState('');
  const roles = getRoles(editor);
  const fields = editor.state.doc.attrs.fieldDefinitions as FieldDefinition[];
  return <section className="role-manager">
    <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}>管理角色</button>
    {open ? <>
      {roles.map(role => <div className="role-manager__row" key={role.id}><span>{role.name}</span>
        <button type="button" onClick={() => { setEditing(role.id); setName(role.name); setError(''); }}>重命名</button>
        <button type="button" disabled={fields.some(f => f.roleId === role.id)} title="使用中的角色须先调整相关字段才能删除" onClick={() => { setError(removeRole(editor, role.id)); if (editing === role.id) { setEditing(undefined); setName(''); } }}>删除</button>
      </div>)}
      <label>角色名称<input aria-label="角色名称" maxLength={50} value={name} onChange={e => setName(e.target.value)} /></label>
      <button type="button" onClick={() => { const message = saveRole(editor, name, editing); setError(message); if (!message) { setName(''); setEditing(undefined); } }}>{editing ? '保存角色名' : '新增角色'}</button>
      {editing ? <button type="button" onClick={() => { setEditing(undefined); setName(''); setError(''); }}>取消重命名</button> : null}
      <small>已使用的角色不可删除，请先调整相关字段。</small>
      {error ? <p role="alert">{error}</p> : null}
    </> : null}
  </section>;
}

function BindingEditor({ editor, field }: { editor: Editor; field: FieldDefinition }) {
  const [sources, setSources] = useState<CatalogSource[]>([]);
  const [catalog, setCatalog] = useState<Record<string, RoleCatalogField[]>>({});
  const [sourceId, setSourceId] = useState(field.binding?.sourceId || '');
  const [fieldId, setFieldId] = useState(field.binding?.fieldId || '');
  const [record, setRecord] = useState(field.binding?.record || 1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (!field.roleId) return;
    const roleId = field.roleId;
    setLoading(true); setError('');
    (async () => {
      const nextSources = await fieldCatalogService.getRoleSources(roleId);
      const entries = await Promise.all(nextSources.map(async s => ({ id: s.id, fields: await fieldCatalogService.getRoleFields(roleId, s.id) })));
      if (cancelled) return;
      const next: Record<string, RoleCatalogField[]> = {};
      entries.forEach(e => { next[e.id] = e.fields; }); setCatalog(next); setSources(nextSources);
    })().catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : '目录加载失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [field.roleId, retry]);
  const type = bindingTypeFor(field.type);
  const source = sources.find(s => s.id === sourceId);
  const candidate = catalog[sourceId]?.find(f => (
    f.id === fieldId && (sourceId === 'system' ? field.type === 'text' : f.type === type)
  ));
  const saved = field.binding;
  const stale = saved && !loading && !error && field.roleId && (!sources.some(s => s.id === saved.sourceId && s.kind === (saved.kind === 'record' ? 'list' : 'category'))
    || !catalog[saved.sourceId]?.some(f => f.id === saved.fieldId && f.type === saved.type));
  const reset = () => { setSourceId(saved?.sourceId || ''); setFieldId(saved?.fieldId || ''); setRecord(saved?.record || 1); };
  const apply = () => {
    const live = (editor.state.doc.attrs.fieldDefinitions as FieldDefinition[]).find(f => f.id === field.id);
    if (loading || error || !source || !candidate || !field.roleId || live?.roleId !== field.roleId) return;
    const success = updateFieldBinding(editor, field.id, { version: 1, sourceId, fieldId, type: sourceId === 'system' ? 'text' : type,
      sourceName: source.name, fieldName: candidate.name, kind: source.kind === 'list' ? 'record' : 'category',
      ...(sourceId === 'system' ? { inputType: candidate.inputType, options: candidate.options } : {}),
      ...(source.kind === 'list' ? { record } : {}) });
    if (!success) setError('绑定未保存，请重新选择控件');
  };
  return <section className="role-binding">
    <h3>角色与数据绑定</h3>
    <label>所属角色<select aria-label="所属角色" value={field.roleId || ''} onChange={e => {
      const roleId = e.target.value || undefined;
      if (roleId === field.roleId) return;
      if (field.binding && !window.confirm('更换角色会清空系统字段绑定，并同步到此字段的所有引用。继续吗？')) return;
      updateFieldRole(editor, field.id, roleId);
    }}><option value="">未分配</option>{getRoles(editor).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
    <small>同一文档字段的所有引用共享角色与绑定。</small>
    <p>当前绑定：{saved ? `${saved.sourceName} / ${saved.fieldName}${saved.kind === 'record' ? ` · 第${saved.record}条` : ''}` : '未绑定'}</p>
    {saved ? <button type="button" onClick={() => updateFieldBinding(editor, field.id)}>解除绑定</button> : null}
    {!field.roleId ? <p>先分配角色，再选择系统字段。</p> : field.type !== 'text' ? <p>{field.type === 'signature' ? '签名区只需设置所属角色，签署时必须完成手写签名。' : '当前仅单行文本支持绑定系统字段。'}</p> : <>
      {loading ? <p role="status">加载字段中…</p> : null}
      {error ? <p role="alert">{error}<button type="button" onClick={() => setRetry(r => r + 1)}>重试</button></p> : null}
      {stale ? <p role="alert">原绑定已失效，配置仍保留。请重新选择可用字段。</p> : null}
      <label>数据来源<select aria-label="绑定数据来源" disabled={loading || !!error} value={sourceId} onChange={e => { setSourceId(e.target.value); setFieldId(''); setRecord(1); }}><option value="">请选择来源</option>{sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>系统字段<select aria-label="系统字段" disabled={loading || !!error || !source} value={fieldId} onChange={e => setFieldId(e.target.value)}><option value="">请选择字段</option>{(catalog[sourceId] || []).filter(f => sourceId === 'system' || f.type === type).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      {!loading && !error && (!sources.length || (source && !(catalog[sourceId] || []).some(f => sourceId === 'system' || f.type === type))) ? <p>暂无可绑定的系统字段。</p> : null}
      {source?.kind === 'list' ? <label>第几条记录<input aria-label="绑定记录序号" type="number" min={1} value={record} onChange={e => setRecord(Number(e.target.value))} /></label> : null}
      <div className="role-binding__actions"><button type="button" onClick={reset}>取消选择</button><button type="button" disabled={loading || !!error || !source || !candidate || (source.kind === 'list' && (!Number.isSafeInteger(record) || record < 1))} onClick={apply}>保存绑定</button></div>
    </>}
  </section>;
}

export function RoleBindingPanel({ editor, field }: { editor: Editor; field: FieldDefinition }) {
  if (isTableBound(editor, field.id)) return null;
  return <BindingEditor key={`${field.id}:${field.roleId}:${JSON.stringify(field.binding)}`} editor={editor} field={field} />;
}
