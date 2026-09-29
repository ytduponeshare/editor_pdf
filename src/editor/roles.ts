import type { Editor } from '@tiptap/core';
import { bindingTypeFor, DEFAULT_ROLES, type FieldBinding, type FieldDefinition, type TemplateRole } from './types';
import { createId } from './id';

export function getRoles(editor: Editor): TemplateRole[] { return editor.state.doc.attrs.roles || DEFAULT_ROLES; }
export function isTableBound(editor: Editor, fieldId: string): boolean {
  let locked = false;
  editor.state.doc.descendants(node => { if (node.attrs.fieldId === fieldId && node.attrs.boundColumn) locked = true; });
  return locked;
}
export function saveRole(editor: Editor, name: string, id?: string): string {
  name = name.trim();
  const roles = getRoles(editor);
  if (!name || name.length > 50) return '角色名称须为1～50字';
  if (roles.some(r => r.id !== id && r.name === name)) return '角色名称不能重复';
  if (id && !roles.some(r => r.id === id)) return '角色不存在';
  editor.view.dispatch(editor.state.tr.setDocAttribute('roles', id ? roles.map(r => r.id === id ? { ...r, name } : r) : [...roles, { id: createId('role'), name }]));
  return '';
}
export function removeRole(editor: Editor, id: string): string {
  const fields = editor.state.doc.attrs.fieldDefinitions as FieldDefinition[];
  if (fields.some(f => f.roleId === id)) return '该角色已被字段使用，请先调整相关字段';
  editor.view.dispatch(editor.state.tr.setDocAttribute('roles', getRoles(editor).filter(r => r.id !== id)));
  return '';
}
export function updateFieldRole(editor: Editor, fieldId: string, roleId?: string): boolean {
  if (isTableBound(editor, fieldId) || (roleId && !getRoles(editor).some(r => r.id === roleId))) return false;
  const fields = editor.state.doc.attrs.fieldDefinitions as FieldDefinition[];
  const field = fields.find(f => f.id === fieldId);
  if (!field) return false;
  if (field.roleId === roleId) return true;
  editor.view.dispatch(editor.state.tr.setDocAttribute('fieldDefinitions', fields.map(f => f.id === fieldId ? { ...f, roleId, binding: undefined } : f)));
  return true;
}
export function updateFieldBinding(editor: Editor, fieldId: string, binding?: FieldBinding): boolean {
  if (isTableBound(editor, fieldId)) return false;
  const fields = editor.state.doc.attrs.fieldDefinitions as FieldDefinition[];
  const field = fields.find(f => f.id === fieldId);
  if (!field || (binding && (!field.roleId || !validBinding(binding, field)))) return false;
  editor.view.dispatch(editor.state.tr.setDocAttribute('fieldDefinitions', fields.map(f => f.id === fieldId ? { ...f, binding } : f)));
  return true;
}
export function validBinding(value: unknown, field: FieldDefinition): value is FieldBinding {
  if (!value || typeof value !== 'object') return false;
  const b = value as FieldBinding;
  const baseValid = b.version === 1
    && [b.sourceId, b.fieldId, b.sourceName, b.fieldName].every(s => typeof s === 'string' && !!s.trim())
    && (b.kind === 'category' ? b.record === undefined : b.kind === 'record' && Number.isSafeInteger(b.record) && Number(b.record) >= 1);
  if (!baseValid) return false;
  if (b.sourceId !== 'system') return b.type === bindingTypeFor(field.type);
  if (field.type !== 'text' || b.kind !== 'category' || b.type !== 'text') return false;
  if (!b.inputType || !['text', 'date', 'select'].includes(b.inputType)) return false;
  return b.inputType === 'select'
    ? Array.isArray(b.options) && b.options.length > 0 && b.options.every(option => typeof option === 'string' && !!option.trim())
    : b.options === undefined;
}
export function validateRoles(value: unknown): TemplateRole[] {
  if (value === undefined) return DEFAULT_ROLES.map(r => ({ ...r }));
  if (!Array.isArray(value)) throw new Error('角色集合无效');
  const ids = new Set<string>(); const names = new Set<string>();
  return value.map(r => {
    if (!r || typeof r.id !== 'string' || !r.id || typeof r.name !== 'string' || !r.name.trim() || r.name.trim().length > 50 || ids.has(r.id) || names.has(r.name.trim())) throw new Error('角色标识或名称无效、重复');
    ids.add(r.id); names.add(r.name.trim()); return { id: r.id, name: r.name.trim() };
  });
}
