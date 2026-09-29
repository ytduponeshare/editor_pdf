import type { Editor } from '@tiptap/core';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { Selection } from '@tiptap/pm/state';
import { createId } from './id';
import type { FieldDefinition } from './types';
import { isFieldTableConfig, type FieldTableConfig } from './fieldTableTypes';

export interface FieldTablePreviewRecord { id: string; values: Record<string, string> }

export function selectedFieldTable(editor: Editor): { id: string; config: FieldTableConfig } | null {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === 'table' && isFieldTableConfig(node.attrs.fieldTable))
      return { id: node.attrs.tableId, config: node.attrs.fieldTable };
  }
  const node = editor.state.doc.nodeAt(editor.state.selection.from);
  return node?.type.name === 'table' && isFieldTableConfig(node.attrs.fieldTable)
    ? { id: node.attrs.tableId, config: node.attrs.fieldTable } : null;
}

export function validFieldTables(doc: PMNode): boolean {
  const tables = new Map<string, { config: FieldTableConfig; rows: number }>();
  let valid = true;
  doc.descendants(table => {
    if (table.type.name !== 'table' || !table.attrs.fieldTable) return;
    const config: unknown = table.attrs.fieldTable;
    if (!isFieldTableConfig(config)) { valid = false; return false; }
    const previous = tables.get(table.attrs.tableId);
    if (previous && JSON.stringify(previous.config) !== JSON.stringify(config)) valid = false;
    const entry = previous || { config, rows: 0 };
    table.forEach((row, _offset, rowIndex) => {
      if (row.childCount !== config.columns.length) valid = false;
      const header = rowIndex === 0;
      if (!header) entry.rows++;
      row.forEach((cell, _cellOffset, index) => {
        const column = config.columns[index];
        if (!column || cell.attrs.colspan !== 1 || cell.attrs.rowspan !== 1) { valid = false; return; }
        if (header) {
          if (cell.type.name !== 'tableHeader' || cell.textContent !== column.title) valid = false;
        } else {
          if (cell.type.name !== 'tableCell') valid = false;
          let count = 0;
          cell.descendants(child => {
            if (child.type.name === 'table') valid = false;
            if (child.type.name === 'inlineField' && child.attrs.boundColumn === column.id) {
              count++;
              if (child.attrs.fieldType !== column.type) valid = false;
            } else if (child.type.name === 'inlineField' && child.attrs.boundColumn) valid = false;
          });
          if (count !== 1) valid = false;
        }
      });
    });
    tables.set(table.attrs.tableId, entry);
    return false;
  });
  return valid && Array.from(tables.values()).every(entry => entry.rows === entry.config.rows);
}

export function applyFieldTable(editor: Editor, config: FieldTableConfig, position: number, tableId?: string, previewRecords: FieldTablePreviewRecord[] = []): boolean {
  if (!isFieldTableConfig(config)) return false;
  const locations: Array<{ node: PMNode; pos: number }> = [];
  if (tableId) editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'table' && node.attrs.tableId === tableId) { locations.push({ node, pos }); return false; }
  });
  if (tableId && !locations.length) return false;
  if (!tableId) {
    const resolved = editor.state.doc.resolve(position);
    for (let depth = resolved.depth; depth > 0; depth--) {
      if (resolved.node(depth).type.name === 'table') { position = resolved.after(depth); break; }
    }
  }
  const oldConfig = locations[0]?.node.attrs.fieldTable as FieldTableConfig | undefined;
  const resolvedTableId = tableId || createId('table');
  const preserve = oldConfig?.mode === config.mode && oldConfig?.sourceId === config.sourceId;
  const oldRows: PMNode[] = [];
  locations.forEach(({ node }) => node.forEach((row, _pos, index) => { if (index > 0) oldRows.push(row); }));
  const definitions = [...(editor.state.doc.attrs.fieldDefinitions as FieldDefinition[])];
  const schema = editor.schema;
  const rows: PMNode[] = [];
  const header = config.columns.map(column => {
    const oldIndex = oldConfig?.columns.findIndex(c => c.id === column.id) ?? -1;
    const oldCell = preserve && oldIndex >= 0 ? locations[0]?.node.firstChild?.child(oldIndex) : null;
    return schema.nodes.tableHeader.create(oldCell?.attrs, schema.nodes.paragraph.create(
      oldCell?.firstChild?.attrs, schema.text(column.title, oldCell?.firstChild?.firstChild?.marks),
    ));
  });
  rows.push(schema.nodes.tableRow.create({ rowId: createId('row') }, header));
  for (let r = 0; r < config.rows; r++) {
    const cells = config.columns.map(column => {
      const oldIndex = oldConfig?.columns.findIndex(c => c.id === column.id) ?? -1;
      const oldCell = preserve && oldIndex >= 0 ? oldRows[r]?.child(oldIndex) : null;
      if (oldCell) return oldCell;
      const field = {
        id: createId('field'),
        type: column.type,
        name: column.title,
        roleId: config.roleId,
        binding: column.binding.kind === 'system' ? {
          version: 1 as const,
          sourceId: 'system',
          fieldId: column.binding.fieldId,
          type: 'text' as const,
          sourceName: '系统字段',
          fieldName: column.binding.fieldName,
          kind: 'category' as const,
          inputType: column.binding.inputType,
          options: column.binding.options,
        } : undefined,
      };
      definitions.push(field);
      const recordIndex = column.binding.kind === 'record' ? column.binding.record - 1 : 0;
      const previewRecord = previewRecords[recordIndex] || previewRecords[0];
      const previewValue = previewRecord && column.binding.kind !== 'control' && column.binding.kind !== 'system'
        ? previewRecord.values[column.binding.fieldId] : undefined;
      const reference = schema.nodes.inlineField.create({ fieldId: field.id, refId: createId('ref'), fieldType: field.type,
        fieldName: field.name, displayValue: previewValue || '', width: 120, boundColumn: column.id, tableId: resolvedTableId, rowId: `row-${r + 1}` });
      return schema.nodes.tableCell.create(null, schema.nodes.paragraph.create(null, reference));
    });
    rows.push(schema.nodes.tableRow.create({ rowId: oldRows[r]?.attrs.rowId || createId('row') }, cells));
  }
  const table = schema.nodes.table.create({ tableId: resolvedTableId, fragmentId: createId('fragment'), fieldTable: config }, rows);
  const tr = editor.state.tr.setDocAttribute('fieldDefinitions', definitions);
  if (locations.length) {
    locations.slice().reverse().forEach(({ node, pos }) => tr.delete(pos, pos + node.nodeSize));
    position = tr.mapping.map(locations[0].pos);
  }
  tr.insert(position, Fragment.from(table));
  tr.setSelection(Selection.near(tr.doc.resolve(Math.min(position + 3, tr.doc.content.size))));
  if (!validFieldTables(tr.doc)) return false;
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

export function copyFieldTable(editor: Editor): boolean {
  const selected = selectedFieldTable(editor);
  if (!selected) return false;
  const parts: Array<{ node: PMNode; pos: number }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'table' && node.attrs.tableId === selected.id) { parts.push({ node, pos }); return false; }
  });
  if (!parts.length) return false;
  const fields = [...(editor.state.doc.attrs.fieldDefinitions as FieldDefinition[])];
  const clone = (node: PMNode): PMNode => {
    const attrs = { ...node.attrs };
    if (node.isText) return node;
    if (node.type.name === 'inlineField') {
      const original = fields.find(f => f.id === attrs.fieldId);
      if (original) { const field = { ...original, id: createId('field') }; fields.push(field); attrs.fieldId = field.id; }
      attrs.refId = createId('ref');
    }
    if (node.type.name === 'tableRow') attrs.rowId = createId('row');
    if (node.type.name === 'paragraph') { attrs.blockId = createId('block'); attrs.flowId = createId('flow'); }
    const children: PMNode[] = []; node.forEach(child => children.push(clone(child)));
    return node.type.create(attrs, children, node.marks);
  };
  const rows: PMNode[] = [];
  parts.forEach(({ node }, i) => node.forEach((row, _offset, r) => { if (i === 0 || r > 0) rows.push(clone(row)); }));
  const table = editor.schema.nodes.table.create({ ...parts[0].node.attrs, tableId: createId('table'), fragmentId: createId('fragment'), continuation: false }, rows);
  const last = parts[parts.length - 1];
  const pos = last.pos + last.node.nodeSize;
  const tr = editor.state.tr.setDocAttribute('fieldDefinitions', fields).insert(pos, table);
  tr.setSelection(Selection.near(tr.doc.resolve(pos + 3)));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}
