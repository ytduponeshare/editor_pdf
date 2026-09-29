import type { CatalogSource, CatalogField } from '../editor/fieldTableTypes';
import type { BindingType, SystemInputType } from '../editor/types';

export interface RoleCatalogField {
  id: string;
  name: string;
  type: BindingType;
  inputType?: SystemInputType;
  options?: string[];
}

export interface FieldCatalogService {
  getSources(): Promise<CatalogSource[]>;
  getFields(sourceId: string): Promise<CatalogField[]>;
  getRoleSources(roleId: string): Promise<CatalogSource[]>;
  getRoleFields(roleId: string, sourceId: string): Promise<RoleCatalogField[]>;
  getRecords(sourceId: string): Promise<{ id: string; values: Record<string, string> }[]>;
}

export const fieldCatalogService: FieldCatalogService = {
  async getRoleSources() {
    return [{ id: 'system', name: '系统字段', kind: 'category' }];
  },
  async getRoleFields(_roleId, sourceId) {
    if (sourceId !== 'system') throw new Error('字段来源不存在');
    const response = await fetch('/api/system-fields');
    if (!response.ok) throw new Error('系统字段加载失败');
    const body = await response.json() as { fields?: RoleCatalogField[] };
    if (!Array.isArray(body.fields)) throw new Error('系统字段返回格式无效');
    return body.fields.map(field => ({
      ...field,
      options: field.options ? [...field.options] : undefined,
    }));
  },
  async getSources() {
    const response = await fetch('/api/field-tables/sources');
    if (!response.ok) throw new Error('字段表格来源加载失败');
    const body = await response.json() as { sources?: CatalogSource[] };
    if (!Array.isArray(body.sources)) throw new Error('字段表格来源返回格式无效');
    return [...body.sources, { id: 'system', name: '系统字段', kind: 'category' }];
  },
  async getFields(sourceId) {
    if (sourceId === 'system') {
      const response = await fetch('/api/system-fields');
      if (!response.ok) throw new Error('系统字段加载失败');
      const body = await response.json() as { fields?: RoleCatalogField[] };
      if (!Array.isArray(body.fields)) throw new Error('系统字段返回格式无效');
      return body.fields.map(field => ({
        id: field.id,
        name: field.name,
        // Table cells are rendered as inline text fields; inputType controls
        // the signing widget (date/select) without changing the field schema.
        type: 'text',
        inputType: field.inputType,
        options: field.options,
      }));
    }
    const response = await fetch(`/api/field-tables/sources/${encodeURIComponent(sourceId)}/fields`);
    if (!response.ok) throw new Error('字段表格字段加载失败');
    const body = await response.json() as { fields?: CatalogField[] };
    if (!Array.isArray(body.fields)) throw new Error('字段表格字段返回格式无效');
    return body.fields;
  },
  async getRecords(sourceId) {
    const response = await fetch(`/api/field-tables/sources/${encodeURIComponent(sourceId)}/records`);
    if (!response.ok) throw new Error('字段表格记录加载失败');
    const body = await response.json() as { records?: { id: string; values: Record<string, string> }[] };
    if (!Array.isArray(body.records)) throw new Error('字段表格记录返回格式无效');
    return body.records;
  },
};
