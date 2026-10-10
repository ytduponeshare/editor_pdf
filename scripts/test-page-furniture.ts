import assert from 'node:assert/strict';
import { getSchema, type Editor } from '@tiptap/core';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import { createEditorExtensions } from '../src/editor/extensions';
import { createDocumentSection, furnitureVariant, furnitureWithCounters, validatePageFurniture } from '../src/editor/pageFurniture';
import { serializeHtmlTemplate, hydrateTemplateSource, validateHtmlTemplate, createSanitizedPrintHtml } from '../src/editor/template';
import { PAGE_SETTINGS } from '../src/editor/types';

const dom = new JSDOM();
Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser });
Object.assign(createDOMPurify, createDOMPurify(dom.window));
const schema = getSchema(createEditorExtensions());
const section = { ...createDocumentSection('section-a'), headerEnabled: true, footerEnabled: true, differentFirstPage: true, differentOddEven: true,
  header: { default: '<p>普通页</p>', first: '<p>首页</p>', even: '<p>偶数页</p>' },
  footer: { default: '<p>第 {page} 页 / 共 {pages} 页</p>', first: '', even: '<p>{page}/{pages}</p>' },
};
assert.equal(furnitureVariant(section, true, 2), 'first');
assert.equal(furnitureVariant(section, false, 2), 'even');
assert.equal(furnitureVariant(section, false, 3), 'default');
assert.match(furnitureWithCounters('<p>{page}/{pages}</p>', 2, 6), /data-page-counter="page">2/);
assert.match(furnitureWithCounters('<p>{page}/{pages}</p>', 2, 6), /data-page-counter="pages">6/);
assert.throws(() => validatePageFurniture({ sections: [{ ...section, headerHeightMm: 100 }] }), /高度/);
assert.throws(() => validatePageFurniture({ sections: [section, section] }), /重复/);
assert.throws(() => validatePageFurniture({ sections: [{ ...section, header: { ...section.header, default: '<script>1</script>' } }] }), /不支持/);
assert.throws(() => validatePageFurniture({ sections: [{ ...section, header: { ...section.header, default: '<img src="https://example.com/a.png">' } }] }), /图片/);
const runtime = { type: 'doc', attrs: { pageFurniture: { sections: [section] }, pageMargins: PAGE_SETTINGS.marginsMm, fieldDefinitions: [] },
  content: [1, 2, 3].map(index => ({ type: 'page', attrs: { pageId: `page-${index}`, sectionId: 'section-a', breakType: index === 1 ? 'root' : 'manual' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: `正文 ${index}` }] }] })),
};
const editor = { getJSON: () => runtime } as unknown as Editor;
const template = serializeHtmlTemplate(editor);
const restored = validateHtmlTemplate(template, schema);
assert.deepEqual(restored.pageFurniture, template.pageFurniture);
assert.deepEqual(hydrateTemplateSource(restored).attrs?.pageFurniture, template.pageFurniture);
assert.doesNotMatch(template.html, /page-furniture--|data-page-counter/);
const printed = new dom.window.DOMParser().parseFromString(createSanitizedPrintHtml(editor), 'text/html');
const pages = printed.querySelectorAll<HTMLElement>('.pdf-page');
assert.equal(pages[0].style.paddingTop, '35mm');
assert.equal(pages[0].querySelector('[data-furniture-variant="first"]')?.textContent, '首页');
assert.equal(pages[1].querySelector<HTMLElement>('[data-page-furniture="header"][data-furniture-variant="even"]')?.style.display, 'block');
assert.throws(() => validateHtmlTemplate({ ...template, pageFurniture: { sections: [createDocumentSection()] } }, schema), /节不存在/);
dom.window.close();
console.log('PASS: furniture selection, token counters, schema validation, template round trip and reserved print space');
