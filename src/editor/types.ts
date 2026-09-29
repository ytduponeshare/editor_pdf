import type { JSONContent } from '@tiptap/core';
import type { FieldTableConfig } from './fieldTableTypes';

export const TEMPLATE_SCHEMA_VERSION = 5 as const;
export const LOCAL_STORAGE_KEY = 'editor_pdf:html-template:v1';
export const LEGACY_LOCAL_STORAGE_KEY = 'pdf-editor:contract-template:v4';
export const OLDER_LOCAL_STORAGE_KEY = 'pdf-editor:contract-template:v3';
export const OLDEST_LOCAL_STORAGE_KEY = 'pdf-editor:contract-template:v2';
export const ANCIENT_LOCAL_STORAGE_KEY = 'pdf-editor:contract-template:v1';
export const MIN_PAGE_MARGIN_MM = 5;
export const MAX_PAGE_MARGIN_MM = 40;

export type FieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'phone'
  | 'signature'
  | 'companySeal';

export interface FieldDefinition {
  id: string;
  type: FieldType;
  name: string;
  roleId?: string;
  binding?: FieldBinding;
}

export interface TemplateRole { id: string; name: string }
export type BindingType = 'text' | 'number' | 'date' | 'phone' | 'signatureImage' | 'sealImage';
export type SystemInputType = 'text' | 'date' | 'select';
export interface FieldBinding {
  version: 1;
  sourceId: string;
  fieldId: string;
  type: BindingType;
  sourceName: string;
  fieldName: string;
  kind: 'category' | 'record';
  record?: number;
  inputType?: SystemInputType;
  options?: string[];
}
export const DEFAULT_ROLES: TemplateRole[] = [{ id: 'party-a', name: '甲方' }, { id: 'party-b', name: '乙方' }];
export function bindingTypeFor(type: FieldType): BindingType {
  return type === 'signature' ? 'signatureImage' : type === 'companySeal' ? 'sealImage' : type;
}

export interface PageMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PageSettings {
  size: 'A4';
  orientation: 'portrait';
  marginsMm: PageMargins;
  printStyleVersion: 'contract-a4-v2';
}

export interface ContractTemplateV3 {
  roles?: TemplateRole[];
  schemaVersion: typeof TEMPLATE_SCHEMA_VERSION;
  pageSettings: PageSettings;
  fields: FieldDefinition[];
  document: JSONContent;
}

export interface HtmlContractTemplateV1 {
  format: 'html';
  formatVersion: 1;
  html: string;
  pageSettings: PageSettings;
  roles: TemplateRole[];
  fields: FieldDefinition[];
  fieldTables: Array<{ tableId: string; config: FieldTableConfig }>;
}

export type ContractTemplateSource = ContractTemplateV3 | HtmlContractTemplateV1;

export function isHtmlContractTemplate(template: ContractTemplateSource): template is HtmlContractTemplateV1 {
  return 'format' in template && template.format === 'html';
}

export interface PdfExportResult {
  ok: true;
  requestId: string;
}

export const PAGE_SETTINGS: PageSettings = {
  size: 'A4',
  orientation: 'portrait',
  marginsMm: { top: 20, right: 20, bottom: 20, left: 20 },
  printStyleVersion: 'contract-a4-v2',
};

export function clampPageMargin(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(MAX_PAGE_MARGIN_MM, Math.max(MIN_PAGE_MARGIN_MM, Math.round(parsed)));
}

export function normalizePageMargins(value: unknown): PageMargins {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...PAGE_SETTINGS.marginsMm };
  }
  const margins = value as Partial<PageMargins>;
  return {
    top: clampPageMargin(margins.top),
    right: clampPageMargin(margins.right),
    bottom: clampPageMargin(margins.bottom),
    left: clampPageMargin(margins.left),
  };
}

export const FIELD_LABELS: Record<FieldType, string> = {
  text: '单行文本',
  number: '数字',
  date: '日期',
  phone: '手机号',
  signature: '签署区',
  companySeal: '企业章',
};

export const INLINE_FIELD_TYPES: FieldType[] = ['text', 'number', 'date', 'phone'];

export function isFieldType(value: unknown): value is FieldType {
  return typeof value === 'string' && value in FIELD_LABELS;
}

export function isFloatingFieldType(type: FieldType): boolean {
  return type === 'signature' || type === 'companySeal';
}
