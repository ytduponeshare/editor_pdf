import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { DemoSigningView, DemoTemplateDetail } from '../src/services/demo';
import type { SigningContract } from '../src/services/signing';

const base = process.env.DEMO_API_URL || 'http://127.0.0.1:3202';
const output = 'output/verification';
mkdirSync(output, { recursive: true });
async function request<T>(path: string, data?: unknown, user?: string, method = 'POST') {
  const response = await fetch(base + path, data === undefined ? undefined : {
    method, headers: { 'Content-Type': 'application/json', ...(user ? { 'X-Demo-User-Id': user } : {}) }, body: JSON.stringify(data),
  });
  const body = await response.json() as T;
  return { status: response.status, body };
}
const assignments = [{ roleId: 'party-a', userId: 'user-zhang' }, { roleId: 'party-b', userId: 'user-li' }];

async function main() {
  const detail = await request<DemoTemplateDetail>('/api/demo/templates/template-demo-html-001');
  const saved = await request<{ id: string }>('/api/demo/templates', { name: '功能回归模板', template: detail.body.template });
  assert.equal(saved.status, 201);
  const changed = await request(`/api/demo/templates/${saved.body.id}`, { name: '功能回归模板更新', template: detail.body.template }, undefined, 'PUT');
  assert.equal(changed.status, 200);
  const duplicate = await request('/api/demo/contracts', { templateId: saved.body.id, assignments: [assignments[0], assignments[0]] });
  assert.equal(duplicate.status, 400);
  const issued = await request<{ contractId: string }>('/api/demo/contracts', { templateId: saved.body.id, assignments });
  assert.equal(issued.status, 201, JSON.stringify(issued.body));
  const id = issued.body.contractId;
  const before = await request<SigningContract>(`/api/signing/contracts/${id}`);
  const baseline = JSON.stringify(before.body);
  const signatureLibrary = await request<{ signatures: Array<{ dataUrl: string }> }>('/api/demo/users/user-zhang/signatures');
  assert.ok(signatureLibrary.body.signatures.length, 'Run test:demo-flow first to seed a validated signature');
  const signature = signatureLibrary.body.signatures[0].dataUrl;
  const seals = await request<{ seals: Array<{ dataUrl: string }> }>(`/api/demo/contracts/${id}/available-seals?userId=user-zhang`);
  const valid = { signer: { name: '客户端姓名', roleId: 'party-a' }, values: { 'name-party-a': '张三' }, signatures: { 'signature-party-a': signature }, seals: { 'seal-party-a': seals.body.seals[0].dataUrl }, tableValues: [] };
  const cases: Array<{ body: unknown; user?: string; status: number }> = [
    { body: valid, user: 'user-li', status: 403 },
    { body: valid, status: 403 },
    { body: { ...valid, template: detail.body.template }, user: 'user-zhang', status: 400 },
    { body: { ...valid, signer: { name: '张三', roleId: 'party-b' } }, user: 'user-zhang', status: 400 },
    { body: { ...valid, signatures: { 'signature-party-a': 'data:image/png;base64,aGVsbG8=' } }, user: 'user-zhang', status: 400 },
    { body: { ...valid, values: { ...valid.values, 'name-party-b': '越权' } }, user: 'user-zhang', status: 400 },
    { body: { ...valid, tableValues: [{ tableId: 'vesting-table', rowId: 'vesting-001', columnId: 'quantity', value: '篡改' }] }, user: 'user-zhang', status: 400 },
    { body: { ...valid, tableValues: [{ tableId: 'unknown', rowId: 'unknown', columnId: 'unknown', value: '篡改' }] }, user: 'user-zhang', status: 400 },
  ];
  for (const test of cases) {
    const rejected = await request(`/api/signing/contracts/${id}/sign`, test.body, test.user);
    assert.equal(rejected.status, test.status, JSON.stringify(rejected.body));
    assert.equal(JSON.stringify((await request<SigningContract>(`/api/signing/contracts/${id}`)).body), baseline, 'Rejected request changed contract state');
  }
  assert.equal((await request(`/api/signing/contracts/${id}/sign`, valid, 'user-zhang')).status, 200);
  const second = (await request<DemoSigningView>(`/api/demo/contracts/${id}/signing-view?userId=user-li`)).body;
  const secondBody = { signer: { name: '客户端伪造', roleId: 'party-b' }, values: { 'name-party-b': '李四' }, signatures: { 'signature-party-b': signature }, seals: {}, tableValues: second.permissions.editableTableCells.map(cell => ({ ...cell, value: '确认' })) };
  const duplicateCell = await request(`/api/signing/contracts/${id}/sign`, { ...secondBody, tableValues: [secondBody.tableValues[0], secondBody.tableValues[0]] }, 'user-li');
  assert.equal(duplicateCell.status, 400);
  const concurrent = await Promise.all([request(`/api/signing/contracts/${id}/sign`, secondBody, 'user-li'), request(`/api/signing/contracts/${id}/sign`, secondBody, 'user-li')]);
  assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 409]);
  const completed = (await request<SigningContract>(`/api/signing/contracts/${id}`)).body;
  assert.equal(completed.signers.length, 2);
  assert.deepEqual(completed.signers.map(signer => signer.signerName), ['张三', '李四']);
  assert.equal((await request(`/api/signing/contracts/${id}/sign`, secondBody, 'user-li')).status, 409);
  // Saving a new template version must leave an issued contract unchanged.
  const modifiedTemplate = { ...detail.body.template, html: 'html' in detail.body.template ? detail.body.template.html.replace('股权归属确认协议', '更新后的协议名称') : '' };
  assert.equal((await request(`/api/demo/templates/${saved.body.id}`, { name: '后续版本', template: modifiedTemplate }, undefined, 'PUT')).status, 200);
  assert.deepEqual((await request<SigningContract>(`/api/signing/contracts/${id}`)).body.template, before.body.template);

  const direct = await request<SigningContract>('/api/signing/contracts', { ...valid, template: detail.body.template });
  assert.equal(direct.status, 201, JSON.stringify(direct.body));
  assert.equal(direct.body.currentRole?.id, 'party-b');
  const directFinish = await request<SigningContract>(`/api/signing/contracts/${direct.body.contractId}/sign`, secondBody);
  assert.equal(directFinish.status, 200, JSON.stringify(directFinish.body));
  assert.equal(directFinish.body.status, 'completed');
  const compatible = await request<{ submissionId: string; signatureCount: number }>(`/api/signing/submissions/${direct.body.contractId}`);
  assert.equal(compatible.status, 200); assert.equal(compatible.body.signatureCount, 2);

  for (const [templateId, filename] of [
    ['template-demo-html-long-table-001', 'static-long'],
    ['template-demo-html-dynamic-long-table-001', 'dynamic-long'],
  ]) {
    const created = await request<{ contractId: string }>('/api/demo/contracts', { templateId, assignments });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const view = (await request<SigningContract>(`/api/signing/contracts/${created.body.contractId}`)).body;
    if (filename === 'dynamic-long') assert.equal(new Set(view.tableValues.map(cell => cell.rowId)).size, 30);
    const preview = await fetch(base + '/api/pdf/template', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template: view.template, signed: view }) });
    assert.equal(preview.status, 200, preview.ok ? '' : await preview.text());
    assert.ok(Number(preview.headers.get('X-Pdf-Pages')) > 3);
    assert.ok(Number(preview.headers.get('X-Pdf-Split-Rows')) > 0);
    if (filename === 'dynamic-long') {
      assert.equal(Number(preview.headers.get('X-Pdf-Anchored-Overlays')), 0);
      assert.ok('html' in view.template && view.template.html.includes('data-signing-area'));
    }
    writeFileSync(`${output}/${filename}.pdf`, Buffer.from(await preview.arrayBuffer()));
    writeFileSync(`${output}/${filename}.json`, JSON.stringify(view, null, 2));
  }
  writeFileSync(`${output}/persisted-contract.json`, JSON.stringify(completed, null, 2));
  console.log('PASS: template CRUD, assignment/role restrictions, image validation, table permissions, atomic concurrent signing, immutable template snapshot, static/dynamic pagination and flow signing areas');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
