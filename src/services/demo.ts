import type { ContractTemplateSource, TemplateRole } from '../editor/types';
import type { SigningContract, SigningContractSummary } from './signing';

export interface DemoUser { id: string; name: string; title: string }
export interface DemoTemplateSummary { id: string; name: string; status: 'draft' | 'published'; format: 'html'; roles: TemplateRole[]; fieldCount: number; updatedAt: string }
export interface DemoTemplateDetail extends DemoTemplateSummary { template: ContractTemplateSource }
export interface DemoContractSummary extends SigningContractSummary {
  templateId: string;
  templateName: string;
  assignments: Array<{ roleId: string; userId: string }>;
}
export interface DemoSigningView extends SigningContract {
  currentUser: DemoUser;
  permissions: {
    fieldIds: string[];
    editableTableCells: Array<{ tableId: string; rowId: string; columnId: string }>;
  };
  resourceHints: { loadSignatureLibrary: boolean; loadSealLibrary: boolean };
}
export interface DemoLibraryItem { id: string; name: string; dataUrl: string; createdAt?: string }

async function json<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    let message = '演示服务请求失败';
    try { message = ((await response.json()) as { message?: string }).message || message; } catch { /* use fallback */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export async function listDemoUsers(): Promise<DemoUser[]> {
  return (await json<{ users: DemoUser[] }>('/api/demo/users')).users;
}

export async function listDemoTemplates(): Promise<DemoTemplateSummary[]> {
  return (await json<{ templates: DemoTemplateSummary[] }>('/api/demo/templates')).templates;
}

export async function getDemoTemplate(id: string): Promise<DemoTemplateDetail> {
  return json(`/api/demo/templates/${encodeURIComponent(id)}`);
}

export async function saveDemoTemplate(name: string, template: ContractTemplateSource, id?: string): Promise<{ id: string }> {
  return json(id ? `/api/demo/templates/${encodeURIComponent(id)}` : '/api/demo/templates', {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, template }),
  });
}

export async function issueDemoContract(templateId: string, assignments: Array<{ roleId: string; userId: string }>): Promise<{ contractId: string }> {
  return json('/api/demo/contracts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ templateId, assignments }),
  });
}

export async function listDemoUserContracts(userId: string): Promise<DemoContractSummary[]> {
  return (await json<{ contracts: DemoContractSummary[] }>(`/api/demo/users/${encodeURIComponent(userId)}/contracts`)).contracts;
}

export async function getDemoSigningView(contractId: string, userId: string): Promise<DemoSigningView> {
  return json(`/api/demo/contracts/${encodeURIComponent(contractId)}/signing-view?userId=${encodeURIComponent(userId)}`);
}

export async function listDemoSignatures(userId: string): Promise<DemoLibraryItem[]> {
  return (await json<{ signatures: DemoLibraryItem[] }>(`/api/demo/users/${encodeURIComponent(userId)}/signatures`)).signatures;
}

export async function saveDemoSignature(userId: string, dataUrl: string): Promise<{ id: string }> {
  return json(`/api/demo/users/${encodeURIComponent(userId)}/signatures`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl }),
  });
}

export async function listAvailableDemoSeals(contractId: string, userId: string): Promise<DemoLibraryItem[]> {
  return (await json<{ seals: DemoLibraryItem[] }>(`/api/demo/contracts/${encodeURIComponent(contractId)}/available-seals?userId=${encodeURIComponent(userId)}`)).seals;
}
