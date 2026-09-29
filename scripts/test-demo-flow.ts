import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import type { ContractTemplateSource } from '../src/editor/types';

const baseUrl = process.env.DEMO_API_URL || 'http://127.0.0.1:3202';

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const payload = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, payload, checksum]);
}

function signaturePng(): string {
  const width = 120; const height = 60;
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4);
    for (let x = 0; x < width; x += 1) {
      const stroke = x >= 8 && x <= 108 && Math.abs(y - (26 + Math.sin(x / 10) * 8)) < 2;
      pixels[row + 1 + x * 4 + 3] = stroke ? 255 : 0;
    }
  }
  return `data:image/png;base64,${Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]).toString('base64')}`;
}

async function json<T>(path: string, options?: RequestInit): Promise<{ response: Response; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, options);
  return { response, body: await response.json() as T };
}

async function sign(contractId: string, userId: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/signing/contracts/${contractId}/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Demo-User-Id': userId },
    body: JSON.stringify(body),
  });
}

async function main() {
  const users = await json<{ users: Array<{ id: string; name: string }> }>('/api/demo/users');
  assert.deepEqual(users.body.users.map(user => user.id), ['user-zhang', 'user-li']);
  const templates = await json<{ templates: Array<{ id: string; format: 'json' | 'html'; fieldCount: number }> }>('/api/demo/templates');
  const htmlSummary = templates.body.templates.find(template => template.id === 'template-demo-html-001');
  assert.deepEqual(htmlSummary && { format: htmlSummary.format, fieldCount: htmlSummary.fieldCount }, { format: 'html', fieldCount: 8 });
  assert.ok(templates.body.templates.every(template => template.format === 'html'));

  const issued = await json<{ contractId: string }>('/api/demo/contracts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      templateId: 'template-demo-html-001',
      assignments: [{ roleId: 'party-a', userId: 'user-zhang' }, { roleId: 'party-b', userId: 'user-li' }],
    }),
  });
  assert.equal(issued.response.status, 201, JSON.stringify(issued.body));
  const contractId = issued.body.contractId;

  const firstView = await json<any>(`/api/demo/contracts/${contractId}/signing-view?userId=user-zhang`);
  assert.equal(firstView.response.status, 200);
  assert.equal(firstView.body.currentRole.id, 'party-a');
  assert.equal(new Set(firstView.body.tableValues.map((cell: { rowId: string }) => cell.rowId)).size, 2, 'table records were snapshotted at issue time');
  const denied = await json<{ message: string }>(`/api/demo/contracts/${contractId}/signing-view?userId=user-li`);
  assert.equal(denied.response.status, 403);

  const seals = await json<any>(`/api/demo/contracts/${contractId}/available-seals?userId=user-zhang`);
  assert.equal(seals.body.seals.length, 1);
  const signature = signaturePng();
  const savedSignature = await json<{ id: string }>('/api/demo/users/user-zhang/signatures', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl: signature }),
  });
  assert.equal(savedSignature.response.status, 201);
  const signatureLibrary = await json<any>('/api/demo/users/user-zhang/signatures');
  assert.ok(signatureLibrary.body.signatures.some((item: { id: string }) => item.id === savedSignature.body.id));

  const firstSign = await sign(contractId, 'user-zhang', {
    signer: { name: '前端伪造姓名', roleId: 'party-a' },
    values: { 'name-party-a': '张三' }, signatures: { 'signature-party-a': signature },
    seals: { 'seal-party-a': seals.body.seals[0].dataUrl }, tableValues: [],
  });
  assert.equal(firstSign.status, 200, firstSign.ok ? undefined : await firstSign.text());

  const secondView = await json<any>(`/api/demo/contracts/${contractId}/signing-view?userId=user-li`);
  assert.equal(secondView.response.status, 200);
  assert.equal(secondView.body.currentRole.id, 'party-b');
  assert.equal(secondView.body.permissions.editableTableCells.length, 2);
  const secondSign = await sign(contractId, 'user-li', {
    signer: { name: '李四', roleId: 'party-b' },
    values: { 'name-party-b': '李四' }, signatures: { 'signature-party-b': signature }, seals: {},
    tableValues: secondView.body.permissions.editableTableCells.map((cell: object) => ({ ...cell, value: '确认无误' })),
  });
  assert.equal(secondSign.status, 200, secondSign.ok ? undefined : await secondSign.text());

  const userContracts = await json<any>('/api/demo/users/user-li/contracts');
  const completed = userContracts.body.contracts.find((contract: { contractId: string }) => contract.contractId === contractId);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.signers[0].signerName, '张三', 'server uses assigned user identity instead of submitted signer name');
  const pdf = await fetch(`${baseUrl}/api/signing/contracts/${contractId}/pdf`);
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-type') || '', /application\/pdf/);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).toString('ascii', 0, 4), '%PDF');
  console.log(`PASS: template list, issue snapshot, two assigned users, on-demand libraries, ordered signing and final PDF (${contractId})`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
