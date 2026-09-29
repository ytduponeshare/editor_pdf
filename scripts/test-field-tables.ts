import assert from 'node:assert/strict';
import { getSchema, type Editor } from '@tiptap/core';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo, redo } from '@tiptap/pm/history';
import { Plugin } from '@tiptap/pm/state';
import { createEditorExtensions } from '../src/editor/extensions';
import { applyFieldTable, copyFieldTable, validFieldTables } from '../src/editor/fieldTables';
import { isFieldTableConfig, type FieldTableConfig } from '../src/editor/fieldTableTypes';
import { PAGE_SETTINGS } from '../src/editor/types';
import { fieldCatalogService } from '../src/services/fieldCatalog';

async function main() {
  const schema = getSchema(createEditorExtensions());
  let state = EditorState.create({ schema, doc: schema.node('doc', { fieldDefinitions: [] }, [schema.node('page', { pageId: 'page1', breakType: 'root' }, [schema.node('paragraph')])]), plugins: [history(), new Plugin({ filterTransaction: tr => !tr.docChanged || validFieldTables(tr.doc) })] });
  const editor = { schema, get state() { return state; }, view: { dispatch(tr) { state = state.applyTransaction(tr).state; } } } as Editor;
  const config: FieldTableConfig = { version: 1, mode: 'category', sourceId: 'employee', rows: 3, columns: [
    { id: 'name', title: '姓名', type: 'text', binding: { kind: 'category', sourceId: 'employee', fieldId: 'name' } },
    { id: 'phone', title: '电话', type: 'phone', binding: { kind: 'category', sourceId: 'employee', fieldId: 'phone' } },
  ] };
  assert.equal(applyFieldTable(editor, config, 2), true);
  const find = () => { const tables: Array<{ node: typeof state.doc; pos: number }> = []; state.doc.descendants((node, pos) => { if (node.type.name === 'table') { tables.push({ node, pos }); return false; } }); return tables; };
  let table = find()[0]; assert.equal(table.node.childCount, 4);
  const cellBefore = table.node.child(1).child(0).toJSON();
  const bindingPos = table.pos + 1 + table.node.firstChild!.nodeSize + 3;
  const before = state.doc;
  editor.view.dispatch(state.tr.delete(bindingPos, bindingPos + 1));
  assert.equal(state.doc, before, 'bound placeholder deletion rejected');
  editor.view.dispatch(state.tr.delete(table.pos + 1, table.pos + 1 + table.node.firstChild!.nodeSize));
  assert.equal(state.doc, before, 'header deletion rejected');
  assert.equal(applyFieldTable(editor, { ...config, columns: [config.columns[1], { ...config.columns[0], title: '员工姓名' }] }, 2, table.node.attrs.tableId), true);
  assert.deepEqual(find()[0].node.child(1).child(1).toJSON(), cellBefore, 'reorder preserves cell identity and content');
  assert.equal(validFieldTables(schema.nodeFromJSON(state.doc.toJSON())), true, 'JSON round trip');
  const edited = state.doc.toJSON();
  assert.equal(undo(state, tr => editor.view.dispatch(tr)), true);
  assert.equal(redo(state, tr => editor.view.dispatch(tr)), true);
  assert.deepEqual(state.doc.toJSON(), edited);
  table = find()[0];
  editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, table.pos + 4)));
  assert.equal(copyFieldTable(editor), true);
  assert.equal(find().length, 2);
  assert.notEqual(find()[0].node.child(1).child(0).firstChild!.firstChild!.attrs.fieldId, find()[1].node.child(1).child(0).firstChild!.firstChild!.attrs.fieldId);
  const custom: FieldTableConfig = { version: 1, mode: 'custom', sourceId: '', rows: 2, columns: [
    { id: 'record', title: '第二次归属', type: 'number', binding: { kind: 'record', sourceId: 'vesting', fieldId: 'quantity', record: 2 } },
    { id: 'manual', title: '备注', type: 'text', binding: { kind: 'control', type: 'text' } },
  ] };
  assert.equal(applyFieldTable(editor, custom, state.doc.content.size - 1), true);
  assert.equal(validFieldTables(state.doc), true);
  assert.equal(isFieldTableConfig({ ...custom, rows: 0 }), false);
  assert.equal(isFieldTableConfig({ ...custom, columns: [{ ...custom.columns[0], binding: { ...custom.columns[0].binding, record: 0 } }] }), false);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/field-tables/sources')) return new Response(JSON.stringify({ sources: [
      { id: 'vesting', name: '归属记录', kind: 'list' },
      { id: 'grants', name: '授予记录', kind: 'list' },
      { id: 'employee', name: '员工目录', kind: 'category' },
    ] }), { status: 200 });
    if (url.endsWith('/api/field-tables/sources/vesting/fields')) return new Response(JSON.stringify({ fields: [{ id: 'date', name: '归属日期', type: 'date' }] }), { status: 200 });
    if (url.endsWith('/api/field-tables/sources/grants/fields')) return new Response(JSON.stringify({ fields: [{ id: 'price', name: '价格', type: 'number' }] }), { status: 200 });
    if (url.endsWith('/api/field-tables/sources/missing/fields')) return new Response('{}', { status: 404 });
    return originalFetch(input);
  }) as typeof fetch;
  assert.equal((await fieldCatalogService.getSources()).length, 4);
  assert.notDeepEqual(await fieldCatalogService.getFields('vesting'), await fieldCatalogService.getFields('grants'));
  await assert.rejects(fieldCatalogService.getFields('missing'));
  globalThis.fetch = originalFetch;
  console.log('PASS: insert, binding protection, header protection, reconfiguration preservation, JSON round trip, undo/redo, copy independence, custom bindings, catalog and invalid inputs');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
