import assert from 'node:assert/strict';
import { getSchema, type Editor } from '@tiptap/core';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import { createEditorExtensions } from '../src/editor/extensions';
import { createSanitizedPrintHtml, hydrateTemplateSource, serializeHtmlTemplate, validateHtmlTemplate } from '../src/editor/template';
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
dom.window.close();
console.log('PASS: HTML template round trip preserves roles, fields and formatting; invalid metadata is rejected; print HTML drops editor field metadata');
