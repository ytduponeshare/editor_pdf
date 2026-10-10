import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const output = 'output/verification';
mkdirSync(output, { recursive: true });

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  const page = await browser.newPage();
  const errors: string[] = [];
  let cancelImport = false;
  page.on('pageerror', error => errors.push(String(error)));
  page.on('dialog', dialog => void (cancelImport ? dialog.dismiss() : dialog.accept()));
  await page.setViewport({ width: 1440, height: 1100 });
  try {
    await page.goto(process.env.EDITOR_URL || 'http://localhost:3002', { waitUntil: 'networkidle0' });
    await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent === '本地编辑与签署')?.click());
    const input = await page.waitForSelector('input[type="file"][accept*=".docx"]');
    assert.ok(input);
    await input.uploadFile(resolve('scripts/fixtures/word-import.docx'));
    await page.waitForFunction(() => document.querySelector('.app-message')?.textContent?.includes('Word 导入成功'));
    await page.waitForFunction(() => document.querySelectorAll('.contract-page').length > 1);
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('.contract-document-image')].every(image => image.complete && image.naturalWidth > 0));
    const heading = await page.$eval('.contract-page h1', element => ({ text: element.textContent, align: getComputedStyle(element).textAlign }));
    assert.equal(heading.text, 'Word 导入测试合同');
    assert.equal(heading.align, 'center');
    assert.equal(await page.$$eval('.contract-page ol li', elements => elements.length), 2);
    assert.equal(await page.$eval('.contract-page th', element => element.getAttribute('colspan')), '2');
    assert.ok(await page.$('.contract-page strong em u'));
    assert.equal(await page.$$eval('[data-contract-field], [data-contract-overlay]', elements => elements.length), 0);
    assert.equal(await page.$$eval('.contract-page[data-overflow="true"]', elements => elements.length), 0);
    await page.click('.contract-page h1');
    await page.keyboard.press('End');
    await page.keyboard.type('（已编辑）');
    await page.waitForFunction(() => document.querySelector('.save-state')?.textContent?.includes('已保存') || document.body.textContent?.includes('已保存到本地'));
    await page.waitForFunction(() => localStorage.getItem('editor_pdf:html-template:v1')?.includes('（已编辑）'));
    const template = await page.evaluate(() => JSON.parse(localStorage.getItem('editor_pdf:html-template:v1') || '{}'));
    assert.equal(template.fields.length, 0);
    assert.match(template.html, /data:image\/png;base64/);
    assert.match(template.html, /font-size: 16px/);
    assert.match(template.html, /font-family: Arial/);
    writeFileSync(`${output}/word-import-template.json`, JSON.stringify(template, null, 2));
    await page.reload({ waitUntil: 'networkidle0' });
    await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent === '本地编辑与签署')?.click());
    await page.waitForFunction(() => document.querySelector('.contract-page h1')?.textContent?.includes('（已编辑）'));
    assert.ok(await page.$('.contract-document-image'));
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/pdf/html') && response.request().method() === 'POST', { timeout: 40_000 });
    await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'HTML 导出 PDF')?.click());
    const response = await responsePromise;
    assert.equal(response.status(), 200);
    await page.waitForFunction(() => document.querySelector('.app-message')?.textContent?.includes('PDF 导出成功'));
    const api = process.env.DEMO_API_URL || 'http://127.0.0.1:3202';
    const printed = await fetch(`${api}/api/pdf/html`, {
      method: 'POST', headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: response.request().postData(),
    });
    assert.equal(printed.status, 200);
    const pdf = Buffer.from(await printed.arrayBuffer());
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    writeFileSync(`${output}/word-import.pdf`, pdf);
    // Server-side template persistence must also retain ordinary Word images.
    const saved = await fetch(`${api}/api/demo/templates`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Word 导入回归', template }),
    });
    assert.ok(saved.ok, await saved.text());
    await page.screenshot({ path: `${output}/word-import.png`, fullPage: true });
    // Failed or cancelled imports must not overwrite the edited document.
    cancelImport = true;
    const restoredInput = await page.$('input[type="file"][accept*=".docx"]');
    assert.ok(restoredInput);
    await restoredInput.uploadFile(resolve('scripts/fixtures/word-import.docx'));
    await page.waitForFunction(() => document.querySelector<HTMLInputElement>('input[type="file"][accept*=".docx"]')?.value === '');
    assert.match(await page.$eval('.contract-page h1', element => element.textContent || ''), /（已编辑）/);
    const corrupt = resolve(`${output}/invalid-word.docx`);
    writeFileSync(corrupt, 'Not a Word document');
    await restoredInput.uploadFile(corrupt);
    await page.waitForFunction(() => document.querySelector('.app-message')?.textContent?.includes('导入失败'));
    assert.match(await page.$eval('.contract-page h1', element => element.textContent || ''), /（已编辑）/);
    assert.deepEqual(errors, []);
    console.log('PASS: DOCX formatting, lists, merged tables and images; editing, pagination, local restore, server save and PDF export; failed/cancelled imports retain the document');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
