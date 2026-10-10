import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const url = process.env.EDITOR_URL || 'http://localhost:3002';
const api = process.env.DEMO_API_URL || 'http://127.0.0.1:3202';
const output = 'output/verification';
mkdirSync(output, { recursive: true });

async function main() {
  const browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('dialog', dialog => void dialog.accept());
  await page.setViewport({ width: 1440, height: 1100 });
  const openEditor = async () => {
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent === '本地编辑与签署')?.click());
    await page.waitForSelector('.contract-page');
  };
  try {
    await openEditor();
    const input = await page.$('input[type="file"]'); assert.ok(input);
    await input.uploadFile(resolve('scripts/fixtures/word-furniture.docx'));
    await page.waitForFunction(() => document.querySelector('.app-message')?.textContent?.includes('Word 导入成功'));
    await page.waitForFunction(() => document.querySelectorAll('.contract-page').length >= 4);
    const pages = await page.$$eval('.contract-page', elements => elements.map(element => ({
      section: element.getAttribute('data-section-id'), header: element.querySelector('[data-page-furniture=header]')?.textContent,
      footer: element.querySelector('[data-page-furniture=footer]')?.textContent, overflow: element.getAttribute('data-overflow'),
    })));
    assert.equal(pages[0].header, '第1节·首页');
    assert.equal(pages[1].header, '第1节·偶数页');
    assert.equal(pages[2].header, '第1节·奇数页');
    assert.equal(await page.$$eval('.contract-page [data-page-furniture=header] img', images => images.length), 1);
    assert.equal(pages.find(item => item.section === 'word-section-2')?.header, '第2节·首页');
    assert.ok(pages.every((item, index) => item.footer?.includes(`第 ${index + 1} 页 / 共 ${pages.length} 页`) && item.overflow === 'false'));
    await page.evaluate(() => [...document.querySelectorAll('.sidebar-tabs button')].find(button => button.textContent === '页眉页脚')?.click());
    await page.select('select[aria-label="页眉页脚页面类型"]', 'first');
    await page.$eval('.furniture-editor .tiptap', element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
      (element as HTMLElement).focus();
    });
    await page.keyboard.type('手动修改首页');
    await page.waitForFunction(() => document.querySelector('.contract-page [data-page-furniture=header]')?.textContent === '手动修改首页');
    await page.waitForFunction(() => localStorage.getItem('editor_pdf:html-template:v1')?.includes('手动修改首页'));
    // Changing the reserved height must preserve text and section identities.
    const height = await page.$('.furniture-panel input[type=number]'); assert.ok(height);
    await height.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); await page.keyboard.type('20'); await page.keyboard.press('Tab');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('editor_pdf:html-template:v1') || '{}').pageFurniture?.sections[0].headerHeightMm === 20);
    await openEditor();
    await page.waitForFunction(() => document.querySelector('.contract-page [data-page-furniture=header]')?.textContent === '手动修改首页');
    assert.equal(await page.$$eval('.contract-page[data-overflow=true]', elements => elements.length), 0);
    let template = await page.evaluate(() => JSON.parse(localStorage.getItem('editor_pdf:html-template:v1') || '{}'));
    assert.equal(template.pageFurniture.sections[1].footer.default, template.pageFurniture.sections[0].footer.default);
    writeFileSync(`${output}/furniture-template.json`, JSON.stringify(template, null, 2));
    const saved = await fetch(`${api}/api/demo/templates`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '页眉页脚回归', template }) });
    assert.ok(saved.ok, saved.ok ? '' : await saved.text());
    const savedIdentity = await saved.json() as { id: string };
    const stored = await (await fetch(`${api}/api/demo/templates/${savedIdentity.id}`)).json();
    assert.deepEqual(stored.template.pageFurniture.sections, template.pageFurniture.sections);
    const pdf = await fetch(`${api}/api/pdf/template`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template, signed: {} }) });
    assert.equal(pdf.status, 200, pdf.status === 200 ? '' : await pdf.text());
    writeFileSync(`${output}/furniture.pdf`, Buffer.from(await pdf.arrayBuffer()));
    assert.ok(Number(pdf.headers.get('X-Pdf-Pages')) >= 4);
    // Force server-only repagination: continuation pages must inherit all variants,
    // while the second section keeps its own first-page header.
    template = JSON.parse(JSON.stringify(template));
    template.html = template.html.replace('</section>', `${'<p>后端新增正文分页验证</p>'.repeat(80)}</section>`);
    const runtimePdf = await fetch(`${api}/api/pdf/template`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template, signed: {} }) });
    assert.equal(runtimePdf.status, 200, runtimePdf.status === 200 ? '' : await runtimePdf.text());
    assert.ok(Number(runtimePdf.headers.get('X-Pdf-Pages')) > Number(pdf.headers.get('X-Pdf-Pages')));
    writeFileSync(`${output}/furniture-runtime.pdf`, Buffer.from(await runtimePdf.arrayBuffer()));
    // Split the second page into an independent section, starting from its own
    // settings even when the sidebar has another section selected.
    await page.evaluate(() => [...document.querySelectorAll('.sidebar-tabs button')].find(button => button.textContent === '页眉页脚')?.click());
    await page.select('select[aria-label="编辑节"]', 'word-section-2');
    await page.evaluate(() => {
      const element = document.querySelectorAll('.contract-page')[1].querySelector('.contract-page__content p') as HTMLElement;
      const range = document.createRange(); range.selectNodeContents(element); range.collapse(true);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
      (element.closest('.ProseMirror') as HTMLElement).focus();
    });
    await page.evaluate(() => [...document.querySelectorAll('.furniture-panel button')].find(button => button.textContent === '从当前页开始新节')?.click());
    await page.waitForFunction(() => document.querySelectorAll('select[aria-label="编辑节"] option').length === 3);
    const newSection = await page.$eval('select[aria-label="编辑节"]', element => (element as HTMLSelectElement).value);
    assert.notEqual(newSection, 'word-section-2');
    const sectionPages = await page.$$eval('.contract-page', elements => elements.map(element => element.getAttribute('data-section-id')));
    assert.equal(sectionPages[0], 'word-section-1');
    assert.equal(sectionPages[1], newSection);
    assert.ok(sectionPages.includes('word-section-2'));
    await page.select('select[aria-label="页眉页脚页面类型"]', 'first');
    await page.$eval('.furniture-editor .tiptap', element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
      (element as HTMLElement).focus();
    });
    await page.keyboard.type('独立节页眉');
    await page.waitForFunction(() => document.querySelectorAll('.contract-page')[1].querySelector('[data-page-furniture=header]')?.textContent === '独立节页眉');
    assert.equal(await page.$eval('.contract-page [data-page-furniture=header]', element => element.textContent), '手动修改首页');
    await page.evaluate(() => [...document.querySelectorAll('.furniture-panel button')].find(button => button.textContent === '复制上一节设置')?.click());
    await page.waitForFunction(() => document.querySelector('.furniture-editor .tiptap')?.textContent === '手动修改首页');
    // Formatting and footer editing must apply to the selected section only.
    await page.$eval('.furniture-editor .tiptap', element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
      (element as HTMLElement).focus();
    });
    await page.select('select[aria-label="页眉页脚字号"]', '18');
    await page.evaluate(() => [...document.querySelectorAll('.furniture-editor:first-of-type button')].find(button => button.textContent === '右对齐')?.click());
    const footerEditors = await page.$$('.furniture-editor .tiptap');
    await footerEditors[1].evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
      (element as HTMLElement).focus();
    });
    await page.keyboard.type('新节页脚 {page}/{pages}');
    await page.waitForFunction(() => document.querySelectorAll('.contract-page')[1].querySelector('[data-page-furniture=footer]')?.textContent?.startsWith('新节页脚 2/'));
    await page.waitForFunction(() => {
      const saved = JSON.parse(localStorage.getItem('editor_pdf:html-template:v1') || '{}');
      return saved.pageFurniture?.sections[1]?.footer.first.includes('新节页脚') && saved.pageFurniture?.sections[1]?.header.first.includes('18px') && saved.pageFurniture?.sections[1]?.header.first.includes('text-align: right');
    });
    await openEditor();
    await page.waitForFunction(() => document.querySelectorAll('.contract-page')[1].querySelector('[data-page-furniture=footer]')?.textContent?.startsWith('新节页脚 2/'));
    await page.screenshot({ path: `${output}/furniture-ui.png`, fullPage: true });
    const signingTemplate = JSON.parse(readFileSync('java-backend/src/main/resources/templates/template-demo-html-001.json', 'utf8')).template;
    const signingSection = { ...template.pageFurniture.sections[0], id: 'default', differentFirstPage: false, differentOddEven: false,
      header: { default: '<p>签署页眉</p>', first: '', even: '' },
      footer: { default: '<p>{page}/{pages}</p>', first: '', even: '' },
    };
    signingTemplate.pageFurniture = { sections: [signingSection] };
    writeFileSync(`${output}/furniture-signing-template.json`, JSON.stringify(signingTemplate));
    const signingInput = await page.$('input[type=file]'); assert.ok(signingInput);
    await signingInput.uploadFile(resolve(`${output}/furniture-signing-template.json`));
    await page.waitForFunction(() => document.querySelector('.contract-page [data-page-furniture=header]')?.textContent === '签署页眉');
    await page.evaluate(() => [...document.querySelectorAll('.editor-toolbar button')].find(button => button.textContent === '发起签署')?.click());
    await page.waitForSelector('.signing-dialog input');
    await page.type('.signing-dialog input', '页眉验证用户');
    await page.evaluate(() => [...document.querySelectorAll('.signing-dialog button')].find(button => button.textContent === '进入签署')?.click());
    await page.waitForSelector('.signing-canvas .contract-page [data-page-furniture=header]');
    await page.waitForFunction(() => !document.body.textContent?.includes('正在加载字段表格'));
    const signingPages = await page.$$eval('.signing-canvas .contract-page', pages => pages.map(page => ({ header: page.querySelector('[data-page-furniture=header]')?.textContent, footer: page.querySelector('[data-page-furniture=footer]')?.textContent })));
    assert.ok(signingPages.every((item, index) => item.header === '签署页眉' && item.footer === `${index + 1}/${signingPages.length}`));
    assert.deepEqual(errors, []);
    console.log('PASS: Word first/odd/even/section headers, logo, inherited footer and field counters; edits, formatting, independent sections and setting copy; restore, server persistence and PDF repagination');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
