import DOMPurify from 'dompurify';
import { generateHTML, generateJSON, type Editor, type JSONContent } from '@tiptap/core';
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import { createEditorExtensions } from './extensions';
import { isAllowedFontFamily } from './extensions/FontFamily';
import { isAllowedFontSize } from './extensions/FontSize';
import { normalizeTextColor } from './extensions/TextColor';
import { normalizeLineHeight } from './extensions/LineHeight';
import { createId } from './id';
import { validFieldTables } from './fieldTables';
import { isFieldTableConfig } from './fieldTableTypes';
import { validateRoles, validBinding } from './roles';
import {
  LOCAL_STORAGE_KEY,
  PAGE_SETTINGS,
  TEMPLATE_SCHEMA_VERSION,
  type ContractTemplateV3,
  type ContractTemplateSource,
  type FieldDefinition,
  type HtmlContractTemplateV1,
  type PageMargins,
  isFieldType,
  isFloatingFieldType,
  isHtmlContractTemplate,
  normalizePageMargins,
} from './types';

const ALLOWED_DOCUMENT_NODES = new Set([
  'doc',
  'page',
  'paragraph',
  'heading',
  'text',
  'hardBreak',
  'bulletList',
  'orderedList',
  'listItem',
  'inlineField',
  'floatingField',
  'layoutAnchor',
  'pageOverlay',
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
]);

export function createEmptyRuntimeDocument(): JSONContent {
  return {
    type: 'doc',
    attrs: {
      fieldDefinitions: [],
      pageMargins: { ...PAGE_SETTINGS.marginsMm },
    },
    content: [
      {
        type: 'page',
        attrs: { pageId: createId('page'), breakType: 'root' },
        content: [{ type: 'paragraph' }],
      },
    ],
  };
}

export function serializeTemplate(editor: Editor): ContractTemplateV3 {
  const runtimeDocument = editor.getJSON();
  const attrs = { ...(runtimeDocument.attrs || {}) };
  const fields = (attrs.fieldDefinitions || []) as FieldDefinition[];
  const roles = validateRoles(attrs.roles);
  const marginsMm = normalizePageMargins(attrs.pageMargins);
  delete attrs.fieldDefinitions;
  delete attrs.roles;
  delete attrs.pageMargins;

  return {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    pageSettings: { ...PAGE_SETTINGS, marginsMm },
    fields,
    roles,
    document: {
      ...runtimeDocument,
      ...(Object.keys(attrs).length ? { attrs } : { attrs: undefined }),
    },
  };
}

export function hydrateTemplate(template: ContractTemplateV3): JSONContent {
  return {
    ...template.document,
    attrs: {
      ...(template.document.attrs || {}),
      fieldDefinitions: template.fields,
      roles: validateRoles(template.roles),
      pageMargins: template.pageSettings.marginsMm,
    },
  };
}

function collectFieldTables(document: JSONContent): HtmlContractTemplateV1['fieldTables'] {
  const result: HtmlContractTemplateV1['fieldTables'] = [];
  const visit = (node: JSONContent) => {
    if (node.type === 'table' && typeof node.attrs?.tableId === 'string' && node.attrs.tableId) {
      const config = node.attrs.fieldTable;
      if (isFieldTableConfig(config)) result.push({ tableId: node.attrs.tableId, config });
    }
    node.content?.forEach(visit);
  };
  visit(document);
  return result;
}

function attachHtmlMetadata(document: JSONContent, template: HtmlContractTemplateV1): JSONContent {
  const tables = new Map(template.fieldTables.map(item => [item.tableId, item.config]));
  const visit = (node: JSONContent): JSONContent => {
    const content = node.content?.map(visit);
    if (node.type === 'table' && typeof node.attrs?.tableId === 'string') {
      return { ...node, attrs: { ...node.attrs, fieldTable: tables.get(node.attrs.tableId) || null }, content };
    }
    return { ...node, content };
  };
  const hydrated = visit(document);
  return {
    ...hydrated,
    attrs: {
      ...(hydrated.attrs || {}),
      fieldDefinitions: template.fields,
      roles: template.roles,
      pageMargins: template.pageSettings.marginsMm,
    },
  };
}

export function hydrateTemplateSource(template: ContractTemplateSource): JSONContent {
  if (!isHtmlContractTemplate(template)) return hydrateTemplate(template);
  return attachHtmlMetadata(generateJSON(template.html, createEditorExtensions()), template);
}

export function asJsonRuntimeTemplate(template: ContractTemplateSource): ContractTemplateV3 {
  if (!isHtmlContractTemplate(template)) return template;
  return {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    pageSettings: template.pageSettings,
    roles: template.roles,
    fields: template.fields,
    document: (() => {
      const runtime = hydrateTemplateSource(template);
      const attrs = { ...(runtime.attrs || {}) };
      delete attrs.fieldDefinitions;
      delete attrs.roles;
      delete attrs.pageMargins;
      return { ...runtime, attrs: Object.keys(attrs).length ? attrs : undefined };
    })(),
  };
}


function sanitizeTemplateMarkup(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOW_DATA_ATTR: false,
    ALLOWED_TAGS: ['section', 'p', 'h1', 'h2', 'h3', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'br', 'span', 'div', 'table', 'tbody', 'thead', 'tr', 'th', 'td', 'colgroup', 'col'],
    ALLOWED_ATTR: ['class', 'style', 'colspan', 'rowspan', 'colwidth', 'data-contract-page', 'data-page-id', 'data-break-type', 'data-contract-field', 'data-contract-overlay', 'data-contract-anchor', 'data-anchor-id', 'data-anchor-name', 'data-reserved-height', 'data-position-mode', 'data-anchor-align', 'data-anchor-offset-x', 'data-anchor-offset-y', 'data-ref-id', 'data-field-id', 'data-field-type', 'data-field-name', 'data-width', 'data-height', 'data-x', 'data-y', 'data-table-id', 'data-fragment-id', 'data-continuation', 'data-row-id', 'data-repeated-header', 'data-source-row-id', 'data-bound-column'],
  });
}

export function serializeHtmlTemplate(editor: Editor): HtmlContractTemplateV1 {
  return convertJsonTemplateToHtml(serializeTemplate(editor));
}

export function convertJsonTemplateToHtml(template: ContractTemplateV3): HtmlContractTemplateV1 {
  const parsed = new DOMParser().parseFromString(
    generateHTML(hydrateTemplate(template), createEditorExtensions()),
    'text/html',
  );
  parsed.querySelectorAll<HTMLElement>('[data-inline-field]').forEach(element => {
    element.removeAttribute('data-inline-field');
    element.setAttribute('data-contract-field', 'true');
  });
  parsed.querySelectorAll<HTMLElement>('[data-page-overlay]').forEach(element => {
    element.removeAttribute('data-page-overlay');
    element.setAttribute('data-contract-overlay', 'true');
  });
  const html = sanitizeTemplateMarkup(parsed.body.innerHTML);
  return {
    format: 'html',
    formatVersion: 1,
    html,
    pageSettings: template.pageSettings,
    roles: template.roles || [],
    fields: template.fields,
    fieldTables: collectFieldTables(template.document),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tableBoundFieldIds(document: JSONContent): Set<string> {
  const ids = new Set<string>();
  const visit = (node: JSONContent, inFieldTable = false) => {
    const inside = inFieldTable || node.type === 'table' && isFieldTableConfig(node.attrs?.fieldTable);
    if (inside && node.type === 'inlineField' && node.attrs?.boundColumn && typeof node.attrs.fieldId === 'string') ids.add(node.attrs.fieldId);
    node.content?.forEach(child => visit(child, inside));
  };
  visit(document);
  return ids;
}

function validateFields(value: unknown, tableFields = new Set<string>()): FieldDefinition[] {
  if (!Array.isArray(value)) {
    throw new Error('模板 fields 必须是数组');
  }

  const ids = new Set<string>();
  return value.map((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string') {
      throw new Error('模板包含无效字段');
    }
    if (!isFieldType(item.type)) {
      throw new Error(`不支持的字段类型：${String(item.type)}`);
    }
    if (!item.name.trim() || item.name.length > 50) {
      throw new Error('字段名称不能为空且不能超过 50 个字符');
    }
    if (ids.has(item.id)) {
      throw new Error(`字段 ID 重复：${item.id}`);
    }
    ids.add(item.id);
    const field: FieldDefinition = { id: item.id, name: item.name, type: item.type };
    if (item.roleId !== undefined) {
      if (typeof item.roleId !== 'string' || !item.roleId) throw new Error('字段角色无效');
      field.roleId = item.roleId;
    }
    if (item.binding !== undefined) {
      if ((!field.roleId && !tableFields.has(field.id)) || !validBinding(item.binding, field)) throw new Error('字段数据库绑定无效');
      field.binding = item.binding;
    }
    return field;
  });
}

function validateDocumentNodes(
  document: JSONContent,
  fields: FieldDefinition[],
  schema: Schema,
  allowLegacyFloating: boolean,
  pageMargins: PageMargins,
): void {
  if (document.type !== 'doc' || !Array.isArray(document.content) || !document.content.length) {
    throw new Error('模板至少需要包含一页');
  }

  const fieldMap = new Map(fields.map((field) => [field.id, field]));
  const pageIds = new Set<string>();
  const refIds = new Set<string>();
  const fragmentIds = new Set<string>();
  const rowIds = new Set<string>();
  const sourceRowIds = new Set<string>();
  const anchors = new Map<string, number>();
  const anchoredOverlays: Array<{ fieldName: string; anchorId: string; height: number; offsetY: number }> = [];

  const walk = (node: JSONContent, parentType?: string, inFieldTable = false) => {
    const inside = inFieldTable || node.type === 'table' && isFieldTableConfig(node.attrs?.fieldTable);
    if (!node.type || !ALLOWED_DOCUMENT_NODES.has(node.type)) {
      throw new Error(`模板包含不支持的节点：${node.type || 'unknown'}`);
    }

    node.marks?.forEach((mark) => {
      if (mark.type === 'fontSize' && !isAllowedFontSize(mark.attrs?.size)) {
        throw new Error('模板包含不支持的字号');
      }
      if (mark.type === 'fontFamily' && !isAllowedFontFamily(mark.attrs?.family)) {
        throw new Error('模板包含不支持的字体');
      }
      if (mark.type === 'textColor' && !normalizeTextColor(mark.attrs?.color)) {
        throw new Error('模板包含不支持的字体颜色');
      }
    });

    if ((node.type === 'paragraph' || node.type === 'heading')
      && node.attrs?.lineHeight !== null
      && node.attrs?.lineHeight !== undefined
      && !normalizeLineHeight(node.attrs.lineHeight)) {
      throw new Error('模板包含不支持的行距');
    }

    if (node.type === 'page') {
      const pageId = node.attrs?.pageId;
      if (typeof pageId !== 'string' || !pageId || pageIds.has(pageId)) {
        throw new Error('页面 ID 缺失或重复');
      }
      if (!['root', 'manual', 'auto'].includes(String(node.attrs?.breakType))) {
        throw new Error('页面分页类型无效');
      }
      pageIds.add(pageId);
    }

    if (node.type === 'table') {
      const tableId = node.attrs?.tableId;
      const fragmentId = node.attrs?.fragmentId;
      if (typeof tableId !== 'string' || !tableId) {
        throw new Error('表格 ID 缺失');
      }
      if (typeof fragmentId !== 'string' || !fragmentId || fragmentIds.has(fragmentId)) {
        throw new Error('表格片段 ID 缺失或重复');
      }
      fragmentIds.add(fragmentId);
    }

    if (node.type === 'tableRow') {
      const rowId = node.attrs?.rowId;
      if (typeof rowId !== 'string' || !rowId || rowIds.has(rowId)) {
        throw new Error('表格行 ID 缺失或重复');
      }
      rowIds.add(rowId);
      if (node.attrs?.repeatedHeader) {
        const sourceRowId = node.attrs?.sourceRowId;
        if (typeof sourceRowId !== 'string' || !sourceRowId) {
          throw new Error('续页表头缺少来源行');
        }
        sourceRowIds.add(sourceRowId);
      }
    }

    if (node.type === 'layoutAnchor') {
      const anchorId = node.attrs?.anchorId;
      const anchorName = node.attrs?.anchorName;
      const reservedHeight = Number(node.attrs?.reservedHeight);
      if (typeof anchorId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(anchorId) || anchors.has(anchorId)) {
        throw new Error('锚点 ID 缺失、重复或格式无效');
      }
      if (typeof anchorName !== 'string' || !anchorName.trim() || anchorName.length > 50) {
        throw new Error('锚点名称不能为空且不能超过 50 个字符');
      }
      if (!Number.isFinite(reservedHeight) || reservedHeight < 40 || reservedHeight > 900) {
        throw new Error(`锚点 ${anchorName} 的预留高度无效`);
      }
      anchors.set(anchorId, reservedHeight);
    }

    if (
      node.type === 'inlineField'
      || node.type === 'floatingField'
      || node.type === 'pageOverlay'
    ) {
      if (node.type === 'floatingField' && !allowLegacyFloating) {
        throw new Error('新版模板不支持文流内浮动控件');
      }
      if (node.type === 'pageOverlay' && parentType !== 'page') {
        throw new Error('页面浮层控件必须直属于页面');
      }
      const fieldId = node.attrs?.fieldId;
      const refId = node.attrs?.refId;
      const field = typeof fieldId === 'string' ? fieldMap.get(fieldId) : undefined;
      if (!field || typeof refId !== 'string' || !refId || refIds.has(refId)) {
        throw new Error('字段引用不存在、缺失或重复');
      }
      if (field.binding && !field.roleId && (!inside || !node.attrs?.boundColumn)) throw new Error('未分配角色的绑定字段必须属于字段表格');
      if (node.type === 'pageOverlay' && !isFloatingFieldType(field.type)) {
        throw new Error('只有签署区和企业章可以作为页面浮层');
      }
      if (node.type === 'pageOverlay') {
        const positionMode = node.attrs?.positionMode ?? 'page';
        if (positionMode !== 'page' && positionMode !== 'anchor') throw new Error(`字段 ${field.name} 的定位方式无效`);
        if (positionMode === 'anchor') {
          const anchorId = node.attrs?.anchorId;
          const align = node.attrs?.anchorAlign ?? 'left';
          const offsetX = Number(node.attrs?.anchorOffsetX);
          const offsetY = Number(node.attrs?.anchorOffsetY);
          if (typeof anchorId !== 'string' || !anchorId || !['left', 'center', 'right'].includes(String(align))
            || !Number.isFinite(offsetX) || !Number.isFinite(offsetY) || offsetY < 0) {
            throw new Error(`字段 ${field.name} 的锚点配置无效`);
          }
          anchoredOverlays.push({ fieldName: field.name, anchorId, height: Number(node.attrs?.height), offsetY });
        }
      }
      if (node.attrs?.fieldType !== field.type) {
        throw new Error(`字段 ${field.name} 的引用类型不一致`);
      }
      if (node.attrs?.fieldName !== field.name) {
        throw new Error(`字段 ${field.name} 的引用名称不一致`);
      }
      const width = Number(node.attrs?.width);
      const minimumWidth = field.type === 'signature' ? 80 : 60;
      const maximumWidth = node.type === 'inlineField' ? 400 : 794;
      if (!Number.isFinite(width) || width < minimumWidth || width > maximumWidth) {
        throw new Error(`字段 ${field.name} 的宽度无效`);
      }
      if (node.type === 'floatingField' || node.type === 'pageOverlay') {
        const height = Number(node.attrs?.height);
        const minimumHeight = field.type === 'signature' ? 40 : 60;
        const offsets = node.type === 'pageOverlay'
          ? [node.attrs?.x, node.attrs?.y].map(Number)
          : [node.attrs?.offsetX, node.attrs?.offsetY].map(Number);
        if (
          !Number.isFinite(height) ||
          height < minimumHeight ||
          height > 1123 ||
          offsets.some((value) => !Number.isFinite(value))
        ) {
          throw new Error(`字段 ${field.name} 的浮动位置无效`);
        }
        if (node.type === 'pageOverlay') {
          const x = Number(node.attrs?.x);
          const y = Number(node.attrs?.y);
          const safeWidth = (210 - pageMargins.left - pageMargins.right) * 96 / 25.4;
          const safeHeight = (297 - pageMargins.top - pageMargins.bottom) * 96 / 25.4;
          if (
            x < 0
            || y < 0
            || x + width > safeWidth + 1
            || y + height > safeHeight + 1
          ) {
            throw new Error(`字段 ${field.name} 超出页面安全区域`);
          }
        }
      }
      refIds.add(refId);
    }

    node.content?.forEach((child) => walk(child, node.type, inside));
  };

  walk(document);
  sourceRowIds.forEach((sourceRowId) => {
    if (!rowIds.has(sourceRowId)) {
      throw new Error('续页表头引用的来源行不存在');
    }
  });
  anchoredOverlays.forEach((overlay) => {
    const reservedHeight = anchors.get(overlay.anchorId);
    if (reservedHeight === undefined) throw new Error(`字段 ${overlay.fieldName} 引用的锚点不存在`);
    if (overlay.offsetY + overlay.height > reservedHeight) throw new Error(`字段 ${overlay.fieldName} 超出锚点预留区域`);
  });
  const runtime = {
    ...document,
    attrs: { ...(document.attrs || {}), fieldDefinitions: fields },
  };
  const parsed = schema.nodeFromJSON(runtime);
  parsed.check();
  if (!validFieldTables(parsed)) throw new Error('字段表格配置或单元格绑定无效');

  parsed.forEach((node: ProseMirrorNode) => {
    if (node.type.name !== 'page') {
      throw new Error('文档根节点只能包含页面');
    }
  });
}

function migrateLegacyDocument(document: JSONContent): JSONContent {
  const migrated = JSON.parse(JSON.stringify(document)) as JSONContent;
  migrated.content?.forEach((page, index) => {
    if (page.type === 'page') {
      page.attrs = {
        ...(page.attrs || {}),
        breakType: index === 0 ? 'root' : 'manual',
      };
    }
  });
  return migrated;
}

function validatePageMargins(value: unknown): PageMargins {
  if (!isRecord(value)) throw new Error('模板页边距设置无效');
  const keys: Array<keyof PageMargins> = ['top', 'right', 'bottom', 'left'];
  keys.forEach((key) => {
    const margin = value[key];
    if (typeof margin !== 'number' || !Number.isFinite(margin) || margin < 5 || margin > 40) {
      throw new Error('模板页边距必须在 5～40mm 之间');
    }
  });
  return normalizePageMargins(value);
}

export function validateTemplate(value: unknown, schema: Schema): ContractTemplateV3 {
  if (
    !isRecord(value) ||
    (
      value.schemaVersion !== 1
      && value.schemaVersion !== 2
      && value.schemaVersion !== 3
      && value.schemaVersion !== 4
      && value.schemaVersion !== TEMPLATE_SCHEMA_VERSION
    )
  ) {
    throw new Error('模板版本不受支持');
  }

  if (!isRecord(value.pageSettings)) {
    throw new Error('模板页面设置无效');
  }

  const settings = value.pageSettings;
  if (
    settings.size !== PAGE_SETTINGS.size ||
    settings.orientation !== PAGE_SETTINGS.orientation
  ) {
    throw new Error('模板页面规格不受支持');
  }
  const isLegacyTemplate = value.schemaVersion === 1 || value.schemaVersion === 2;
  if (
    (isLegacyTemplate && settings.printStyleVersion !== 'contract-a4-v1') ||
    (!isLegacyTemplate && settings.printStyleVersion !== PAGE_SETTINGS.printStyleVersion)
  ) throw new Error('模板打印样式版本不受支持');
  const marginsMm = isLegacyTemplate
    ? normalizePageMargins({
        top: settings.marginMm,
        right: settings.marginMm,
        bottom: settings.marginMm,
        left: settings.marginMm,
      })
    : validatePageMargins(settings.marginsMm);

  if (!isRecord(value.document)) {
    throw new Error('模板文档结构无效');
  }

  const fields = validateFields(value.fields, tableBoundFieldIds(value.document as JSONContent));
  const roles = validateRoles(value.roles);
  if (fields.some(f => f.roleId && !roles.some(r => r.id === f.roleId))) throw new Error('字段引用的角色不存在');
  const document = value.schemaVersion === 1
    ? migrateLegacyDocument(value.document as JSONContent)
    : value.document as JSONContent;
  validateDocumentNodes(
    document,
    fields,
    schema,
    value.schemaVersion <= 3,
    marginsMm,
  );

  return {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    pageSettings: { ...PAGE_SETTINGS, marginsMm },
    fields,
    roles,
    document,
  };
}

export function validateHtmlTemplate(value: unknown, schema: Schema): HtmlContractTemplateV1 {
  if (!isRecord(value) || value.format !== 'html' || value.formatVersion !== 1 || typeof value.html !== 'string' || !value.html.trim()) {
    throw new Error('HTML 模板版本或内容无效');
  }
  const settings = value.pageSettings;
  if (!isRecord(settings) || settings.size !== PAGE_SETTINGS.size || settings.orientation !== PAGE_SETTINGS.orientation || settings.printStyleVersion !== PAGE_SETTINGS.printStyleVersion) {
    throw new Error('模板页面规格不受支持');
  }
  if (!Array.isArray(value.fieldTables)) throw new Error('字段表格元数据无效');
  const tableIds = new Set<string>();
  const fieldTables = value.fieldTables.map(item => {
    if (!isRecord(item) || typeof item.tableId !== 'string' || !item.tableId || tableIds.has(item.tableId) || !isFieldTableConfig(item.config)) {
      throw new Error('字段表格元数据无效或重复');
    }
    tableIds.add(item.tableId);
    return { tableId: item.tableId, config: item.config };
  });
  const html = sanitizeTemplateMarkup(value.html);
  const dom = new DOMParser().parseFromString(html, 'text/html');
  const tableFields = new Set(Array.from(dom.querySelectorAll<HTMLElement>('table[data-table-id] [data-bound-column][data-field-id]')).map(field => field.dataset.fieldId!));
  const template: HtmlContractTemplateV1 = {
    format: 'html', formatVersion: 1,
    html,
    pageSettings: { ...PAGE_SETTINGS, marginsMm: validatePageMargins(settings.marginsMm) },
    fields: validateFields(value.fields, tableFields), roles: validateRoles(value.roles), fieldTables,
  };
  validateTemplate(asJsonRuntimeTemplate(template), schema);
  return template;
}

export function saveTemplateToLocalStorage(editor: Editor): void {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(serializeHtmlTemplate(editor)));
}

export function loadTemplateFromLocalStorage(schema: Schema): HtmlContractTemplateV1 | null {
  const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
  return saved ? validateHtmlTemplate(JSON.parse(saved), schema) : null;
}

export function downloadTemplate(editor: Editor, format: 'json' | 'html' = 'html'): void {
  const template = format === 'html' ? serializeHtmlTemplate(editor) : serializeTemplate(editor);
  const blob = new Blob([JSON.stringify(template, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = format === 'html' ? 'contract-template-html-v1.json' : 'contract-template-v5.json';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readTemplateFile(file: File, schema: Schema): Promise<HtmlContractTemplateV1> {
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('模板文件不能超过 5MB');
  }
  const value: unknown = JSON.parse(await file.text());
  return isRecord(value) && value.format === 'html'
    ? validateHtmlTemplate(value, schema)
    : convertJsonTemplateToHtml(validateTemplate(value, schema));
}

export function createSanitizedPrintHtml(editor: Editor): string {
  const template = serializeTemplate(editor);
  const { top, right, bottom, left } = template.pageSettings.marginsMm;
  const runtimeDocument = hydrateTemplate(template);
  const rawHtml = generateHTML(runtimeDocument, createEditorExtensions());
  const parsed = new DOMParser().parseFromString(rawHtml, 'text/html');

  parsed.querySelectorAll<HTMLElement>('[data-inline-field]').forEach((element) => {
    const width = Math.max(60, Math.min(400, Number(element.dataset.width) || 120));
    element.textContent = '\u00a0';
    element.className = 'pdf-inline-field';
    element.style.width = `${width}px`;
  });

  parsed.querySelectorAll<HTMLElement>('[data-floating-field]').forEach((element) => {
    const minimumWidth = element.dataset.fieldType === 'signature' ? 80 : 60;
    const minimumHeight = element.dataset.fieldType === 'signature' ? 40 : 60;
    const width = Math.max(minimumWidth, Math.min(794, Number(element.dataset.width) || 120));
    const height = Math.max(minimumHeight, Math.min(1123, Number(element.dataset.height) || 80));
    const x = Number(element.dataset.offsetX) || 0;
    const y = Number(element.dataset.offsetY) || 0;
    const label = element.dataset.fieldName || (element.dataset.fieldType === 'companySeal' ? '企业章' : '签署区');
    element.textContent = '';
    element.className = 'pdf-floating-anchor';
    element.style.setProperty('--field-width', `${width}px`);
    element.style.setProperty('--field-height', `${height}px`);
    element.style.setProperty('--field-x', `${x}px`);
    element.style.setProperty('--field-y', `${y}px`);
    const placeholder = parsed.createElement('span');
    placeholder.className = 'pdf-field-placeholder';
    placeholder.textContent = label;
    element.appendChild(placeholder);
  });

  parsed.querySelectorAll<HTMLElement>('[data-page-overlay]').forEach((element) => {
    const minimumWidth = element.dataset.fieldType === 'signature' ? 80 : 60;
    const minimumHeight = element.dataset.fieldType === 'signature' ? 40 : 60;
    const width = Math.max(minimumWidth, Math.min(794, Number(element.dataset.width) || 120));
    const height = Math.max(minimumHeight, Math.min(1123, Number(element.dataset.height) || 80));
    const x = Math.max(0, Number(element.dataset.x) || 0);
    const y = Math.max(0, Number(element.dataset.y) || 0);
    const label = element.dataset.fieldName || (element.dataset.fieldType === 'companySeal' ? '企业章' : '签署区');
    element.textContent = '';
    element.className = 'pdf-page-overlay';
    element.style.setProperty('--field-width', `${width}px`);
    element.style.setProperty('--field-height', `${height}px`);
    element.style.setProperty('--field-x', `${x}px`);
    element.style.setProperty('--field-y', `${y}px`);
    const placeholder = parsed.createElement('span');
    placeholder.className = 'pdf-field-placeholder';
    placeholder.textContent = label;
    element.appendChild(placeholder);
  });

  parsed.querySelectorAll<HTMLElement>('[data-contract-anchor]').forEach((element) => {
    const height = Math.max(40, Math.min(900, Number(element.dataset.reservedHeight) || 140));
    element.className = 'pdf-layout-anchor';
    element.style.height = `${height}px`;
  });

  parsed.querySelectorAll<HTMLElement>('section[data-contract-page]').forEach((page) => {
    page.className = 'pdf-page';
  });

  const cleanBody = DOMPurify.sanitize(parsed.body.innerHTML, {
    ALLOW_DATA_ATTR: false,
    ALLOWED_TAGS: ['section', 'p', 'h1', 'h2', 'h3', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'br', 'span', 'div', 'table', 'tbody', 'thead', 'tr', 'th', 'td', 'colgroup', 'col'],
    ALLOWED_ATTR: ['class', 'style', 'colspan', 'rowspan', 'colwidth', 'data-contract-page', 'data-page-id', 'data-break-type', 'data-contract-anchor', 'data-anchor-id', 'data-anchor-name', 'data-reserved-height', 'data-position-mode', 'data-anchor-align', 'data-anchor-offset-x', 'data-anchor-offset-y', 'data-table-id', 'data-fragment-id', 'data-continuation', 'data-row-id', 'data-repeated-header', 'data-source-row-id'],
  });

  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><style>
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #111827; font-family: Arial, "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 14px; line-height: 1.7; }
    .pdf-page { --page-safe-left: ${left}mm; --page-safe-top: ${top}mm; position: relative; width: 210mm; height: 296mm; padding: ${top}mm ${right}mm ${bottom}mm ${left}mm; break-before: page; page-break-before: always; overflow: hidden; }
    .pdf-page:first-child { break-before: auto; page-break-before: auto; }
    .pdf-inline-field { display: inline-block; min-height: 1.45em; margin: 0 2px; border-bottom: 1px solid #111827; vertical-align: baseline; }
    .pdf-floating-anchor { position: relative; display: inline-block; width: 0; height: 0; }
    .pdf-page-overlay { position: absolute; z-index: 2; top: calc(var(--page-safe-top) + var(--field-y)); left: calc(var(--page-safe-left) + var(--field-x)); width: var(--field-width); height: var(--field-height); background: transparent; }
    .pdf-layout-anchor { position: relative; width: 100%; break-inside: avoid; page-break-inside: avoid; }
    .pdf-field-placeholder { display: grid; place-items: center; border: 1px dashed #7c8ba1; color: #667085; background: transparent; font-size: 13px; text-align: center; }
    .pdf-page-overlay > .pdf-field-placeholder { width: 100%; height: 100%; }
    .pdf-floating-anchor > .pdf-field-placeholder { position: absolute; z-index: 1; top: var(--field-y); left: var(--field-x); width: var(--field-width); height: var(--field-height); }
    p { margin: 0 0 0.75em; line-height: 1.7; }
    p:empty { min-height: 1.7em; }
    h1 { margin: 0 0 0.8em; font-size: 28px; line-height: 1.35; }
    h2 { margin: 0 0 0.7em; font-size: 22px; line-height: 1.4; }
    h3 { margin: 0 0 0.65em; font-size: 18px; line-height: 1.45; }
    h1, h2, h3 { break-after: avoid; }
    ul, ol { margin: 0 0 0.75em; padding-left: 2em; }
    .tableWrapper { margin: 0 0 0.85em; overflow: visible; }
    table {
      width: 100%;
      margin: 0 0 0.85em;
      border-collapse: collapse;
      table-layout: fixed;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    th, td {
      padding: 7px 8px;
      border: 1px solid #6b7280;
      vertical-align: top;
      min-width: 0;
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    th {
      background: #f2f4f7;
      font-weight: 600;
      text-align: left;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    th p, td p { min-height: 1.7em; margin: 0; }
    th .pdf-inline-field, td .pdf-inline-field { max-width: 100%; white-space: pre-wrap; overflow-wrap: anywhere; }
    tr { break-inside: avoid; }
  </style></head><body>${cleanBody}</body></html>`;
}

export function downloadHtml(editor: Editor): void {
  const blob = new Blob([createSanitizedPrintHtml(editor)], {
    type: 'text/html;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'contract-template.html';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
