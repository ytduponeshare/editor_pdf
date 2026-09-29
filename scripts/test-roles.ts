import assert from 'node:assert/strict';
import { getSchema, type Editor } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { history, undo, redo } from '@tiptap/pm/history';
import { createEditorExtensions } from '../src/editor/extensions';
import { getRoles, saveRole, removeRole, updateFieldRole, updateFieldBinding, validBinding, validateRoles, isTableBound } from '../src/editor/roles';
import { fieldCatalogService } from '../src/services/fieldCatalog';
import { insertNewField, duplicateSelectedReference } from '../src/editor/commands';
import { serializeTemplate, hydrateTemplate } from '../src/editor/template';
import type { FieldDefinition } from '../src/editor/types';

globalThis.fetch = async (input) => {
  if (String(input) !== '/api/system-fields') return new Response(null, { status: 404 });
  return new Response(JSON.stringify({ fields: [
    { id: 'name', name: '姓名', type: 'text', inputType: 'text' },
    { id: 'birthday', name: '生日', type: 'text', inputType: 'date' },
    { id: 'gender', name: '性别', type: 'text', inputType: 'select', options: ['男', '女', '其他'] },
    { id: 'date', name: '日期', type: 'text', inputType: 'date' },
  ] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

async function main() {
  const schema = getSchema(createEditorExtensions());
  let state = EditorState.create({ schema, doc: schema.node('doc', { fieldDefinitions: [] }, [schema.node('page', { pageId: 'p', breakType: 'root' }, [schema.node('paragraph')])]), plugins: [history()] });
  const editor = { schema, get state() { return state; }, getJSON: () => state.doc.toJSON(), view: { dispatch(tr) { state = state.applyTransaction(tr).state; } } } as Editor;
  assert.equal(getRoles(editor).length, 2);
  assert.equal(saveRole(editor, ' 丙方 '), '');
  assert.notEqual(saveRole(editor, '丙方'), '');
  assert.notEqual(saveRole(editor, ' '), '');
  assert.equal(insertNewField(editor, 'text', 2), true);
  const field = () => (state.doc.attrs.fieldDefinitions as FieldDefinition[])[0];
  assert.equal(updateFieldRole(editor, field().id, 'party-a'), true);
  const binding = { version: 1 as const, sourceId: 'system', fieldId: 'name', type: 'text' as const, sourceName: '系统字段', fieldName: '姓名', kind: 'category' as const, inputType: 'text' as const };
  assert.equal(updateFieldBinding(editor, field().id, binding), true);
  assert.notEqual(removeRole(editor, 'party-a'), '');
  assert.equal(saveRole(editor, '出租方', 'party-a'), '');
  assert.deepEqual(field().binding, binding);
  assert.equal(duplicateSelectedReference(editor, false), true);
  assert.equal((state.doc.attrs.fieldDefinitions as FieldDefinition[]).length, 1);
  assert.equal(duplicateSelectedReference(editor, true), true);
  const independent = (state.doc.attrs.fieldDefinitions as FieldDefinition[])[1];
  assert.deepEqual(independent.binding, binding);
  assert.equal(updateFieldRole(editor, field().id, 'party-b'), true);
  assert.equal(field().binding, undefined);
  assert.deepEqual((state.doc.attrs.fieldDefinitions as FieldDefinition[])[1].binding, binding);
  const snapshot = state.doc.toJSON();
  assert.equal(undo(state, tr => editor.view.dispatch(tr)), true);
  assert.equal(redo(state, tr => editor.view.dispatch(tr)), true);
  assert.deepEqual(state.doc.toJSON(), snapshot);
  const template = serializeTemplate(editor);
  assert.deepEqual(schema.nodeFromJSON(hydrateTemplate(template)).attrs.roles, getRoles(editor));
  assert.deepEqual(schema.nodeFromJSON(hydrateTemplate(template)).attrs.fieldDefinitions, state.doc.attrs.fieldDefinitions);
  assert.equal(validateRoles(undefined).length, 2);
  assert.throws(() => validateRoles([{ id: 'x', name: '甲方' }, { id: 'x', name: '乙方' }]));
  assert.equal(validBinding({ ...binding, kind: 'record', record: 0 }, field()), false);
  assert.equal(validBinding({ ...binding, type: 'signatureImage' }, field()), false);
  assert.equal(validBinding({ ...binding, kind: 'record', record: 2 }, field()), false);
  assert.equal(validBinding({ ...binding, fieldId: 'birthday', fieldName: '生日', inputType: 'date' }, field()), true);
  assert.equal(validBinding({ ...binding, fieldId: 'gender', fieldName: '性别', inputType: 'select', options: ['男', '女', '其他'] }, field()), true);
  let refPos = -1;
  state.doc.descendants((node, pos) => { if (node.attrs.fieldId === field().id) refPos = pos; });
  editor.view.dispatch(state.tr.setNodeMarkup(refPos, undefined, { ...state.doc.nodeAt(refPos)!.attrs, boundColumn: 'protected' }));
  assert.equal(isTableBound(editor, field().id), true);
  assert.equal(updateFieldRole(editor, field().id, 'party-a'), false);
  assert.equal(updateFieldBinding(editor, field().id, binding), false);
  assert.deepEqual(await fieldCatalogService.getRoleFields('party-a', 'system'), await fieldCatalogService.getRoleFields('party-b', 'system'));
  assert.equal((await fieldCatalogService.getRoleFields('custom-role', 'system')).filter(f => f.inputType === 'select').length, 1);
  await assert.rejects(fieldCatalogService.getRoleFields('party-a', 'missing'));
  console.log('PASS: role validation, role usage protection, shared bindings, independent copy, clearing on role switch, undo/redo, serialization, legacy defaults, type/record checks, table isolation and role catalogs');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
