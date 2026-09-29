export type BasicFieldType = 'text' | 'number' | 'date' | 'phone';
export interface CatalogSource { id: string; name: string; kind: 'list' | 'category' }
export interface CatalogField { id: string; name: string; type: BasicFieldType; inputType?: 'text' | 'date' | 'select'; options?: string[] }
export type ColumnBinding =
  | { kind: 'control'; type: BasicFieldType }
  | { kind: 'system'; fieldId: string; fieldName: string; inputType: 'text' | 'date' | 'select'; options?: string[] }
  | { kind: 'category' | 'current'; sourceId: string; fieldId: string }
  | { kind: 'record'; sourceId: string; fieldId: string; record: number };
export interface FieldTableColumn { id: string; title: string; type: BasicFieldType; binding: ColumnBinding; editable?: boolean }
export interface FieldTableConfig {
  version: 1;
  mode: 'list' | 'category' | 'custom';
  sourceId: string;
  rows: number;
  columns: FieldTableColumn[];
  roleId?: string;
  roleName?: string;
}

export function isFieldTableConfig(value: unknown): value is FieldTableConfig {
  if (!value || typeof value !== 'object') return false;
  const c = value as FieldTableConfig;
  if (c.version !== 1 || !['list', 'category', 'custom'].includes(c.mode)
    || typeof c.sourceId !== 'string' || (c.mode !== 'custom' && !c.sourceId)
    || !Number.isInteger(c.rows) || c.rows < 1 || c.rows > 20 || (c.mode === 'list' && c.rows !== 1)
    || !Array.isArray(c.columns) || !c.columns.length || c.columns.length > 12) return false;
  const ids = new Set<string>();
  return c.columns.every(col => {
    if (!col || typeof col.id !== 'string' || !col.id || ids.has(col.id)
      || typeof col.title !== 'string' || !col.title.trim() || col.title.length > 50
      || !['text', 'number', 'date', 'phone'].includes(col.type) || !col.binding) return false;
    ids.add(col.id);
    const b = col.binding;
    if (b.kind === 'control') return c.mode === 'custom' && b.type === col.type;
    if (b.kind === 'system') return col.type === 'text' && ['text', 'date', 'select'].includes(b.inputType);
    if (typeof b.sourceId !== 'string' || !b.sourceId || typeof b.fieldId !== 'string' || !b.fieldId) return false;
    if (c.mode === 'list') return b.kind === 'current' && b.sourceId === c.sourceId;
    if (c.mode === 'category') return b.kind === 'category' && b.sourceId === c.sourceId;
    return b.kind === 'category' || (b.kind === 'record' && Number.isInteger(b.record) && b.record >= 1);
  });
}
