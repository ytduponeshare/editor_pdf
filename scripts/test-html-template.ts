import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getSchema, type Editor } from '@tiptap/core';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import { createEditorExtensions } from '../src/editor/extensions';
import { convertJsonTemplateToHtml, createSanitizedPrintHtml, hydrateTemplateSource, serializeHtmlTemplate, serializeTemplate, validateHtmlTemplate } from '../src/editor/template';
import { PAGE_SETTINGS } from '../src/editor/types';

const dom = new JSDOM();
Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser });
Object.assign(createDOMPurify, createDOMPurify(dom.window));
const schema = getSchema(createEditorExtensions());
const document = {
  type: 'doc',
  attrs: { roles: [{ id: 'party-a', name: '甲方' }], fieldDefinitions: [{ id: 'name', name: '姓名', type: 'text', roleId: 'party-a' }], pageMargins: PAGE_SETTINGS.marginsMm },
  content: [{ type: 'page', attrs: { pageId: 'html-page', breakType: 'root' }, content: [{
    type: 'paragraph', attrs: { lineHeight: 1.5 }, content: [
      { type: 'text', text: 'HTML 独立编辑器：', marks: [{ type: 'textColor', attrs: { color: '#c2410c' } }] },
      { type: 'inlineField', attrs: { refId: 'name-ref', fieldId: 'name', fieldName: '姓名', fieldType: 'text', width: 120 } },
    ],
  }] }],
};
const editor = { getJSON: () => document } as unknown as Editor;
const template = serializeHtmlTemplate(editor);
const restored = validateHtmlTemplate(template, schema);
const migrated = validateHtmlTemplate(convertJsonTemplateToHtml(serializeTemplate(editor)), schema);
assert.deepEqual(migrated.fields, template.fields);
assert.deepEqual(migrated.fieldTables, template.fieldTables);
assert.match(migrated.html, /data-contract-field/);
const runtime = hydrateTemplateSource(restored);
assert.deepEqual(restored.roles, template.roles);
assert.deepEqual(restored.fields, template.fields);
assert.equal(runtime.content?.[0]?.content?.[0]?.attrs?.lineHeight, 1.5);
assert.match(restored.html, /data-contract-field/);
assert.match(restored.html, /color:/);
assert.match(createSanitizedPrintHtml(editor), /class="pdf-page"/);
assert.doesNotMatch(createSanitizedPrintHtml(editor), /data-contract-field|data-field-id/);
assert.throws(() => validateHtmlTemplate({ ...template, formatVersion: 2 }, schema), /版本/);
assert.throws(() => validateHtmlTemplate({ ...template, fields: [] }, schema), /字段/);
assert.throws(() => validateHtmlTemplate({ ...template, pageSettings: { ...template.pageSettings, marginsMm: { top: 0, right: 20, bottom: 20, left: 20 } } }, schema), /页边距/);
for (const id of ['template-demo-html-001', 'template-demo-html-long-table-001', 'template-demo-html-dynamic-long-table-001']) {
  const seed = JSON.parse(readFileSync(`java-backend/src/main/resources/templates/${id}.json`, 'utf8')).template;
  assert.doesNotThrow(() => validateHtmlTemplate(seed, schema), 'Read-only table bindings must survive template import');
  const unassigned = seed.fields.find((field: { roleId?: string; binding?: unknown }) => field.binding && !field.roleId);
  if (unassigned) {
    seed.html += `<section data-contract-page data-page-id="illegal-extra" data-break-type="manual"><p><span data-contract-field data-ref-id="illegal-ref" data-field-id="${unassigned.id}" data-field-type="${unassigned.type}" data-field-name="${unassigned.name}" data-width="130"></span></p></section>`;
    assert.throws(() => validateHtmlTemplate(seed, schema), /字段表格/);
  }
}
dom.window.close();
console.log('PASS: HTML template round trip preserves roles, fields and formatting; invalid metadata is rejected; print HTML drops editor field metadata');
