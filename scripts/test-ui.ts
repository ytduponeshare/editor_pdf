import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import puppeteer, { type Page } from 'puppeteer-core';

const url = process.env.EDITOR_URL || 'http://localhost:3002';
const output = 'output/verification';
mkdirSync(output, { recursive: true });
async function click(page: Page, label: string, parent = 'body') {
  await page.waitForFunction((label, parent) => [...(document.querySelector(parent)?.querySelectorAll('button') || [])].some(button => button.textContent?.trim() === label), {}, label, parent);
  const button = await page.evaluateHandle((label, parent) => {
    const root = document.querySelector(parent);
    return [...(root?.querySelectorAll('button') || [])].find(button => button.textContent?.trim() === label);
  }, label, parent);
  const element = button.asElement(); assert.ok(element, `Missing button: ${label}`); await element.click(); await button.dispose();
}
async function replaceText(page: Page, selector: string, value: string) {
  await page.waitForSelector(selector);
  await page.$eval(selector, element => {
    (element as HTMLElement).focus();
    if (element instanceof HTMLInputElement) element.select();
    else { const range = document.createRange(); range.selectNodeContents(element); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); }
  });
  await page.keyboard.type(value);
}
async function draw(page: Page) {
  const canvas = await page.waitForSelector('.signature-pad canvas'); await waitForLayout(page); assert.ok(canvas);
  await canvas.evaluate(element => element.scrollIntoView({ block: 'center' }));
  const rect = await canvas.boundingBox(); assert.ok(rect);
  await page.mouse.move(rect.x + 12, rect.y + rect.height * .5); await page.mouse.down();
  for (let i = 1; i < 14; i++) await page.mouse.move(rect.x + 12 + i * 8, rect.y + rect.height * .5 + Math.sin(i) * 8);
  await page.mouse.up();
}
async function waitForLayout(page: Page) {
  await page.evaluate('globalThis.__name ||= (target) => target;');
  await page.evaluate(() => new Promise<void>(resolve => {
    let timer: ReturnType<typeof setTimeout>;
    const observer = new MutationObserver(() => arm());
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { observer.disconnect(); resolve(); }, 250); };
    observer.observe(document.querySelector('.signing-canvas') || document.body, { childList: true, subtree: true, characterData: true });
    arm();
  }));
}

async function main() {
  const browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 1100 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(String(error))); page.setDefaultTimeout(30_000);
  try {
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.demo-card'); assert.ok(await page.$('button'));
    const basic = await page.$('.demo-card[data-template-id="template-demo-html-001"]'); assert.ok(basic);
    await basic.$eval('button', button => button.click());
    await page.waitForSelector('.editor-toolbar');
    const labels = await page.$$eval('.editor-toolbar button', buttons => buttons.map(button => button.textContent?.trim()));
    assert.ok(labels.includes('插入表格 ▾') || labels.some(label => label?.includes('插入表格')));
    assert.ok(labels.includes('保存到模板库')); assert.ok(labels.includes('HTML 导出 PDF'));
    page.once('dialog', dialog => void dialog.accept('浏览器完整流程回归'));
    await click(page, '保存到模板库'); await page.waitForSelector('.demo-card');
    const createdCard = (await page.$$('.demo-card'))[0];
    assert.match(await createdCard.evaluate(element => element.textContent || ''), /浏览器完整流程回归/);
    await createdCard.$$eval('button', buttons => buttons[1].click());
    await page.waitForSelector('.demo-form-row select'); await click(page, '确认发送合同');
    await page.waitForFunction(() => document.querySelector('.demo-alert')?.textContent?.includes('合同发送成功'));
    const contractId = await page.$eval('.demo-alert', element => element.textContent?.match(/[a-f0-9-]{36}/)?.[0]); assert.ok(contractId);
    await click(page, '张三', '.demo-header'); await page.waitForSelector('.demo-list');
    await click(page, '进入签署', '.demo-list article:first-child');
    await page.waitForSelector('.signature-pad canvas'); await waitForLayout(page);
    const longName = '李四'.repeat(100);
    await replaceText(page, '.signing-field__text[role="textbox"]', longName);
    const flow = await page.$eval('.signing-field__text', element => {
      const rects = [...element.getClientRects()];
      const page = element.closest('.contract-page__content')!; const bounds = page.getBoundingClientRect();
      return { fragments: rects.length, inside: rects.every(rect => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1), value: element.textContent };
    });
    assert.equal(flow.value, longName); assert.ok(flow.fragments > 1, 'Long signing text should wrap like Word'); assert.ok(flow.inside, 'Text overflowed page width');
    await draw(page); await click(page, '存入签名库');
    await page.waitForFunction(() => document.querySelector('.signature-chooser small')?.textContent?.includes('已保存'));
    await page.select('select[aria-label="选择企业印章"]', 'seal-demo-company');
    await page.screenshot({ path: `${output}/signing-word-wrap.png`, fullPage: true });
    const previewResponse = page.waitForResponse(response => response.url().endsWith('/api/pdf/template'));
    await click(page, '导出 PDF', '.signing-header'); const preview = await previewResponse;
    assert.equal(preview.status(), 200);
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('.signing-header .primary-action')?.disabled);
    await click(page, '完成本方签署'); await page.waitForSelector('.signing-receipt');
    await click(page, '返回合同列表'); await page.waitForSelector('.demo-header'); await click(page, '李四', '.demo-header');
    await page.waitForFunction(() => document.querySelector('.demo-page__title h1')?.textContent === '李四的合同');
    await click(page, '进入签署', '.demo-list article:first-child'); await page.waitForSelector('.signature-pad canvas'); await waitForLayout(page);
    const tableInputs = await page.$$('.signing-field input[aria-label="员工确认"]'); assert.equal(tableInputs.length, 2);
    for (const input of tableInputs) await input.type('确认无误');
    await draw(page); await click(page, '完成本方签署'); await page.waitForSelector('.signing-receipt');
    assert.match(await page.$eval('.signing-receipt h1', element => element.textContent || ''), /合同签署完成/);
    await page.screenshot({ path: `${output}/completed-contract.png`, fullPage: true });
    const pdf = await fetch(`${url}/api/signing/contracts/${contractId}/pdf`); assert.equal(pdf.status, 200);
    writeFileSync(`${output}/ui-signed.pdf`, Buffer.from(await pdf.arrayBuffer()));
    const contract = await (await fetch(`${url}/api/signing/contracts/${contractId}`)).json();
    writeFileSync(`${output}/ui-contract.json`, JSON.stringify(contract, null, 2));
    assert.equal(contract.fields[0].value, longName); assert.equal(contract.signatures.length, 2); assert.equal(contract.seals.length, 1);
    assert.ok(contract.tableValues.filter((cell: { editable: boolean; value: string }) => cell.editable).every((cell: { value: string }) => cell.value === '确认无误'));
    await click(page, '返回合同列表'); await click(page, '本地编辑与签署', '.demo-header'); await page.waitForSelector('.editor-toolbar');
    await click(page, '合同记录'); await page.waitForSelector('.signed-files-dialog a');
    await page.click('button[aria-label="关闭合同记录"]');
    const fixture = `${output}/ui-import-template.json`; writeFileSync(fixture, readFileSync('java-backend/src/main/resources/templates/template-demo-html-001.json', 'utf8'));
    // Upload the editable envelope, rather than the seed fixture wrapper.
    const wrapped = JSON.parse(readFileSync(fixture, 'utf8')); writeFileSync(fixture, JSON.stringify(wrapped.template));
    page.once('dialog', dialog => void dialog.accept()); const fileInput = await page.$('input[type="file"]'); assert.ok(fileInput); await fileInput.uploadFile(fixture);
    await page.waitForFunction(() => document.querySelector('.app-message')?.textContent?.includes('模板导入成功'));
    await page.waitForFunction(() => localStorage.getItem('editor_pdf:html-template:v1')?.includes('股权归属确认协议'));
    writeFileSync(`${output}/ui-local-template.json`, await page.evaluate(() => localStorage.getItem('editor_pdf:html-template:v1') || ''));
    await page.reload({ waitUntil: 'networkidle0' }); await click(page, '本地编辑与签署', '.demo-header'); await page.waitForSelector('.editor-toolbar');
    await page.waitForFunction(() => document.querySelector('.editor-canvas')?.textContent?.includes('股权归属确认协议'));
    assert.match(await page.$eval('.editor-canvas', element => element.textContent || ''), /股权归属确认协议/);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('PASS UI: template edit/save/send, actor switch, Word wrapping, signature library, seal selection, preview export, both signing roles, final PDF, contract records, HTML import and local restore');
  } catch (error) {
    console.error(await page.evaluate(() => ({ message: document.querySelector('.app-message')?.textContent, stored: localStorage.getItem('editor_pdf:html-template:v1')?.slice(0, 180) })));
    throw error;
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
