import type { ContractTemplateSource, TemplateRole } from '../editor/types';

export type ContractStatus = 'pending' | 'completed';

export interface ContractFieldValue {
  fieldId: string;
  fieldName: string;
  systemFieldId: string;
  systemFieldName: string;
  inputType: 'text' | 'date' | 'select';
  value: string;
  roleId?: string;
  roleName?: string;
}

export interface ContractSignature {
  fieldId: string;
  fieldName: string;
  dataUrl: string;
  roleId?: string;
  roleName?: string;
}
export interface ContractSeal {
  fieldId: string;
  fieldName: string;
  dataUrl: string;
  roleId?: string;
  roleName?: string;
}
export interface ContractTableValue {
  tableId: string;
  rowId: string;
  columnId: string;
  value: string;
  editable?: boolean;
  roleId?: string;
  roleName?: string;
  sourceId?: string;
}

export interface ContractSigner {
  roleId: string;
  roleName: string;
  signerName: string;
  signedAt: string;
}

export interface SigningContractSummary {
  assignments?: Array<{ roleId: string; userId: string }>;
  contractId: string;
  status: ContractStatus;
  currentRole: TemplateRole | null;
  roleOrder: TemplateRole[];
  signers: ContractSigner[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  pdfUrl: string;
}

export interface SigningContract extends SigningContractSummary {
  currentRoleIndex: number;
  template: ContractTemplateSource;
  fields: ContractFieldValue[];
  signatures: ContractSignature[];
  seals: ContractSeal[];
  tableValues: ContractTableValue[];
}

async function messageFrom(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { message?: string };
    return body.message || fallback;
  } catch {
    return fallback;
  }
}

async function requestJson<T>(url: string, options: RequestInit = {}, fallback = '签署服务请求失败'): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(await messageFrom(response, fallback));
    return response.json() as Promise<T>;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('签署服务连接超时');
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

interface SigningInput {
  signerName: string;
  roleId: string;
  userId?: string;
  values: Record<string, string>;
  signatures: Record<string, string>;
  seals: Record<string, string>;
  tableValues: ContractTableValue[];
}

export async function createSigningContract(input: SigningInput & { template: ContractTemplateSource }): Promise<SigningContract> {
  const created = await requestJson<{ contractId: string }>('/api/signing/contracts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      template: input.template,
      signer: { name: input.signerName, roleId: input.roleId },
      values: input.values,
      signatures: input.signatures,
      seals: input.seals,
      tableValues: input.tableValues,
    }),
  }, '合同创建失败');
  if (!created.contractId) throw new Error('合同创建返回格式无效');
  return getSigningContract(created.contractId);
}

export async function continueSigningContract(contractId: string, input: SigningInput): Promise<SigningContract> {
  const result = await requestJson<{ contractId: string }>(`/api/signing/contracts/${encodeURIComponent(contractId)}/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(input.userId ? { 'X-Demo-User-Id': input.userId } : {}) },
    body: JSON.stringify({
      signer: { name: input.signerName, roleId: input.roleId },
      values: input.values,
      signatures: input.signatures,
      seals: input.seals,
      tableValues: input.tableValues,
    }),
  }, '合同签署失败');
  if (result.contractId !== contractId) throw new Error('合同签署返回格式无效');
  return getSigningContract(contractId);
}

export function getSigningContract(contractId: string): Promise<SigningContract> {
  return requestJson(`/api/signing/contracts/${encodeURIComponent(contractId)}`, {}, '合同读取失败');
}

export async function listSigningContracts(): Promise<SigningContractSummary[]> {
  const body = await requestJson<{ contracts?: SigningContractSummary[] }>('/api/signing/contracts', {}, '合同记录加载失败');
  if (!Array.isArray(body.contracts)) throw new Error('合同记录返回格式无效');
  return body.contracts;
}

export async function downloadSignedPdf(file: Pick<SigningContractSummary, 'pdfUrl' | 'contractId'>): Promise<void> {
  const response = await fetch(file.pdfUrl);
  if (!response.ok || !(response.headers.get('Content-Type') || '').includes('application/pdf')) {
    throw new Error(await messageFrom(response, '合同文件下载失败'));
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${file.contractId}-contract.pdf`;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
