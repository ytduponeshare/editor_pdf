import type { Editor } from '@tiptap/core';
import { NodeSelection, Selection } from '@tiptap/pm/state';
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { CellSelection } from '@tiptap/pm/tables';
import { createId } from './id';
import { selectedFieldTable } from './fieldTables';
import {
  FIELD_LABELS,
  type FieldDefinition,
  type FieldType,
  type PageMargins,
  isFloatingFieldType,
  normalizePageMargins,
} from './types';

const PAGINATION_META = 'contractPagination';

export interface SelectedFieldReference {
  position: number;
  node: ProseMirrorNode;
  field: FieldDefinition;
}

export interface FieldDropPoint {
  clientX: number;
  clientY: number;
}

function getFieldDefinitions(editor: Editor): FieldDefinition[] {
  return (editor.state.doc.attrs.fieldDefinitions || []) as FieldDefinition[];
}

function createDefaultFieldName(type: FieldType, fields: FieldDefinition[]): string {
  const label = FIELD_LABELS[type];
  const count = fields.filter((field) => field.type === type).length + 1;
  return `${label} ${count}`;
}

function resolveInlinePosition(editor: Editor, requestedPosition?: number): number | null {
  const { doc, selection } = editor.state;
  const position = Math.max(0, Math.min(requestedPosition ?? selection.from, doc.content.size));
  const resolved = doc.resolve(position);

  if (resolved.parent.inlineContent) {
    return position;
  }

  const nearSelection = Selection.near(resolved, 1);
  if (nearSelection.$from.parent.inlineContent) {
    return nearSelection.from;
  }

  let fallback: number | null = null;
  doc.descendants((node, nodePosition) => {
    if (fallback === null && node.inlineContent) {
      fallback = nodePosition + 1;
      return false;
    }
    return fallback === null;
  });
  return fallback;
}

function createReferenceAttrs(field: FieldDefinition) {
  const common = {
    refId: createId('ref'),
    fieldId: field.id,
    fieldType: field.type,
    fieldName: field.name,
  };

  if (isFloatingFieldType(field.type)) {
    return {
      nodeName: 'floatingField',
      attrs: {
        ...common,
        width: field.type === 'signature' ? 160 : 120,
        height: field.type === 'signature' ? 80 : 120,
        offsetX: 12,
        offsetY: 12,
      },
    };
  }

  return {
    nodeName: 'inlineField',
    attrs: { ...common, width: 120 },
  };
}

function resolveSigningAreaPosition(editor: Editor, requestedPosition?: number): number | null {
  const page = findPageAtPosition(editor, requestedPosition);
  if (!page) return null;
  const resolved = editor.state.doc.resolve(Math.max(page.position + 1,
    Math.min(requestedPosition ?? editor.state.selection.from, page.position + page.node.nodeSize - 1)));
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    if (resolved.node(depth).type.name === 'page') {
      if (depth < resolved.depth) return resolved.after(depth + 1);
      let trailingSize = 0;
      for (let index = page.node.childCount - 1; index >= 0 && page.node.child(index).type.name === 'pageOverlay'; index -= 1) trailingSize += page.node.child(index).nodeSize;
      return page.position + page.node.nodeSize - 1 - trailingSize;
    }
  }
  return null;
}

function findPageAtPosition(
  editor: Editor,
  requestedPosition?: number,
): { node: ProseMirrorNode; position: number } | null {
  const safePosition = Math.max(
    0,
    Math.min(requestedPosition ?? editor.state.selection.from, editor.state.doc.content.size),
  );
  const resolved = editor.state.doc.resolve(safePosition);
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    if (resolved.node(depth).type.name === 'page') {
      return { node: resolved.node(depth), position: resolved.before(depth) };
    }
  }
  const firstPage = editor.state.doc.firstChild;
  return firstPage?.type.name === 'page' ? { node: firstPage, position: 0 } : null;
}

function getPageContentElement(editor: Editor, pagePosition: number): HTMLElement | null {
  const dom = editor.view.nodeDOM(pagePosition);
  if (!(dom instanceof HTMLElement)) return null;
  const page = dom.matches('.contract-page')
    ? dom
    : dom.querySelector<HTMLElement>('.contract-page');
  return page?.querySelector<HTMLElement>('.contract-page__content') || null;
}

function resolveOverlayInsertion(
  editor: Editor,
  attrs: Record<string, unknown>,
  requestedPosition?: number,
  dropPoint?: FieldDropPoint,
): { position: number; attrs: Record<string, unknown>; areaPosition?: number } | null {
  const areaElement = dropPoint ? Array.from(editor.view.dom.querySelectorAll<HTMLElement>('[data-signing-area]'))
    .find(element => { const rect = element.getBoundingClientRect(); return dropPoint.clientX >= rect.left && dropPoint.clientX <= rect.right && dropPoint.clientY >= rect.top && dropPoint.clientY <= rect.bottom; }) : null;
  const selectedAreaPosition = !dropPoint && editor.state.selection.$from.parent.type.name === 'signingArea'
    ? editor.state.selection.from : requestedPosition;
  const resolved = editor.state.doc.resolve(Math.max(0, Math.min(selectedAreaPosition ?? editor.state.selection.from, editor.state.doc.content.size)));
  let areaPosition: number | undefined;
  let area: ProseMirrorNode | null = null;
  if (areaElement) editor.state.doc.descendants((node, position) => {
    if (node.type.name === 'signingArea' && node.attrs.areaId === areaElement.dataset.areaId) { area = node; areaPosition = position; return false; }
    return true;
  });
  else if (!dropPoint) for (let depth = resolved.depth; depth > 0; depth -= 1) {
    if (resolved.node(depth).type.name === 'signingArea') { area = resolved.node(depth); areaPosition = resolved.before(depth); break; }
  }
  if (area && areaPosition !== undefined) {
    const areaNode: ProseMirrorNode = area;
    let x = 12; let y = 12;
    if (areaElement && dropPoint) { const rect = areaElement.getBoundingClientRect(); x = Math.max(0, Math.min(rect.width - Number(attrs.width), dropPoint.clientX - rect.left)); y = Math.max(0, dropPoint.clientY - rect.top); }
    else areaNode.forEach(child => { x = Math.max(x, Number(child.attrs.x) + Number(child.attrs.width) + 12); });
    const page = findPageAtPosition(editor, areaPosition);
    const content = page && getPageContentElement(editor, page.position);
    if (content) {
      const bounds = content.getBoundingClientRect();
      if (x + Number(attrs.width) > bounds.width) { x = 12; areaNode.forEach(child => { y = Math.max(y, Number(child.attrs.y) + Number(child.attrs.height) + 12); }); }
      y = Math.min(y, Math.max(0, bounds.height - Number(attrs.height) - 32));
    }
    return { position: areaPosition + areaNode.nodeSize - 1, areaPosition, attrs: { ...attrs, x: Math.round(x), y: Math.round(y) } };
  }
  const position = resolveSigningAreaPosition(editor, requestedPosition);
  if (position === null) return null;
  const page = dropPoint && findPageAtPosition(editor, position);
  const content = page && getPageContentElement(editor, page.position);
  const bounds = content && content.getBoundingClientRect();
  const x = dropPoint && bounds
    ? Math.max(0, Math.min(bounds.width - Number(attrs.width), dropPoint.clientX - bounds.left))
    : 12;
  return { position, attrs: { ...attrs, x: Math.round(x), y: 12 } };
}

export function moveSigningField(editor: Editor, position: number, attrs: Record<string, unknown>, point: FieldDropPoint): boolean {
  const node = editor.state.doc.nodeAt(position);
  if (!node || node.type.name !== 'pageOverlay') return false;
  const targetPosition = editor.view.posAtCoords({ left: point.clientX, top: point.clientY })?.pos;
  if (targetPosition === undefined) return false;
  const insertion = resolveOverlayInsertion(editor, attrs, targetPosition, point);
  if (!insertion) return false;
  const source = editor.state.doc.resolve(position);
  const sameArea = source.parent.type.name === 'signingArea' && insertion.areaPosition === source.before(source.depth);
  if (sameArea) {
    const transaction = editor.state.tr.setNodeMarkup(position, undefined, insertion.attrs);
    transaction.setSelection(NodeSelection.create(transaction.doc, position)); editor.view.dispatch(transaction); return true;
  }
  const transaction = editor.state.tr;
  if (source.parent.type.name === 'signingArea' && source.parent.childCount === 1) transaction.delete(source.before(source.depth), source.after(source.depth));
  else transaction.delete(position, position + node.nodeSize);
  const insertAt = transaction.mapping.map(insertion.position);
  const moved = node.type.create(insertion.attrs);
  transaction.insert(insertAt, insertion.areaPosition !== undefined ? moved : editor.state.schema.nodes.signingArea.create({ areaId: createId('area') }, moved));
  transaction.setSelection(NodeSelection.create(transaction.doc, insertAt + (insertion.areaPosition === undefined ? 1 : 0)));
  editor.view.dispatch(transaction); return true;
}

export function insertNewField(
  editor: Editor,
  type: FieldType,
  requestedPosition?: number,
  dropPoint?: FieldDropPoint,
): boolean {
  const fields = getFieldDefinitions(editor);
  const field: FieldDefinition = {
    id: createId('field'),
    type,
    name: createDefaultFieldName(type, fields),
  };
  const reference = createReferenceAttrs(field);
  const overlay = reference.nodeName === 'pageOverlay'
    ? resolveOverlayInsertion(editor, reference.attrs, requestedPosition, dropPoint)
    : null;
  const position = reference.nodeName === 'pageOverlay'
    ? overlay?.position ?? null
    : resolveInlinePosition(editor, requestedPosition);
  if (position === null) return false;
  const nodeType = editor.state.schema.nodes[reference.nodeName];
  const node = nodeType.create(overlay?.attrs || reference.attrs);
  const transaction = editor.state.tr
    .setDocAttribute('fieldDefinitions', [...fields, field])
    .insert(position, overlay && overlay.areaPosition === undefined
      ? editor.state.schema.nodes.signingArea.create({ areaId: createId('area') }, node) : node);
  transaction.setSelection(NodeSelection.create(transaction.doc, position + (overlay && overlay.areaPosition === undefined ? 1 : 0)));

  editor.view.dispatch(transaction);
  return true;
}

export function insertExistingField(
  editor: Editor,
  fieldId: string,
  requestedPosition?: number,
  dropPoint?: FieldDropPoint,
): boolean {
  const field = getFieldDefinitions(editor).find((item) => item.id === fieldId);
  if (!field) return false;
  const reference = createReferenceAttrs(field);
  const overlay = reference.nodeName === 'pageOverlay'
    ? resolveOverlayInsertion(editor, reference.attrs, requestedPosition, dropPoint)
    : null;
  const position = reference.nodeName === 'pageOverlay'
    ? overlay?.position ?? null
    : resolveInlinePosition(editor, requestedPosition);
  if (position === null) return false;
  const node = editor.state.schema.nodes[reference.nodeName]
    .create(overlay?.attrs || reference.attrs);
  const transaction = editor.state.tr.insert(position, overlay && overlay.areaPosition === undefined
      ? editor.state.schema.nodes.signingArea.create({ areaId: createId('area') }, node) : node);
  transaction.setSelection(NodeSelection.create(transaction.doc, position + (overlay && overlay.areaPosition === undefined ? 1 : 0)));
  editor.view.dispatch(transaction);
  return true;
}

export function getSelectedFieldReference(editor: Editor): SelectedFieldReference | null {
  const { selection } = editor.state;
  if (!(selection instanceof NodeSelection)) {
    return null;
  }

  const node = selection.node;
  if (
    node.type.name !== 'inlineField'
    && node.type.name !== 'floatingField'
    && node.type.name !== 'pageOverlay'
  ) {
    return null;
  }

  const field = getFieldDefinitions(editor).find((item) => item.id === node.attrs.fieldId);
  if (!field) {
    return null;
  }

  return { position: selection.from, node, field };
}

export function renameField(editor: Editor, fieldId: string, name: string): boolean {
  const nextName = name.trim().slice(0, 50);
  if (!nextName) {
    return false;
  }

  const selectedReference = getSelectedFieldReference(editor);
  const fields = getFieldDefinitions(editor);
  const nextFields = fields.map((field) =>
    field.id === fieldId ? { ...field, name: nextName } : field,
  );
  const transaction = editor.state.tr.setDocAttribute('fieldDefinitions', nextFields);

  editor.state.doc.descendants((node, position) => {
    if (
      (
        node.type.name === 'inlineField'
        || node.type.name === 'floatingField'
        || node.type.name === 'pageOverlay'
      ) &&
      node.attrs.fieldId === fieldId
    ) {
      transaction.setNodeMarkup(
        position,
        undefined,
        { ...node.attrs, fieldName: nextName },
        node.marks,
      );
    }
  });

  if (selectedReference) {
    transaction.setSelection(NodeSelection.create(transaction.doc, selectedReference.position));
  }

  editor.view.dispatch(transaction);
  return true;
}

export function updateSelectedReference(
  editor: Editor,
  attributes: Record<string, unknown>,
): boolean {
  const selected = getSelectedFieldReference(editor);
  if (!selected) {
    return false;
  }

  const nextAttrs = { ...selected.node.attrs, ...attributes };
  let transaction = editor.state.tr.setNodeMarkup(
    selected.position,
    undefined,
    nextAttrs,
    selected.node.marks,
  );
  transaction.setSelection(NodeSelection.create(transaction.doc, selected.position));
  editor.view.dispatch(transaction);
  return true;
}

export function duplicateSelectedReference(editor: Editor, independent: boolean): boolean {
  const selected = getSelectedFieldReference(editor);
  if (!selected) {
    return false;
  }

  const fields = getFieldDefinitions(editor);
  let field = selected.field;
  let transaction = editor.state.tr;

  if (independent) {
    field = {
      ...selected.field,
      id: createId('field'),
      name: `${selected.field.name} 副本`.slice(0, 50),
    };
    transaction = transaction.setDocAttribute('fieldDefinitions', [...fields, field]);
  }

  const attrs = {
    ...selected.node.attrs,
    refId: createId('ref'),
    fieldId: field.id,
    fieldName: field.name,
    ...(selected.node.type.name === 'floatingField'
      ? {
          offsetX: selected.node.attrs.offsetX + 16,
          offsetY: selected.node.attrs.offsetY + 16,
        }
      : selected.node.type.name === 'pageOverlay'
        ? {
            x: selected.node.attrs.x + 16,
            y: selected.node.attrs.y + 16,
          }
      : {}),
  };
  const insertionPosition = selected.position + selected.node.nodeSize;
  const duplicate = selected.node.type.create(attrs);
  transaction = transaction
    .insert(insertionPosition, duplicate)
    .setSelection(NodeSelection.create(transaction.doc, insertionPosition));
  editor.view.dispatch(transaction.scrollIntoView());
  return true;
}

export function deleteSelectedReference(editor: Editor): boolean {
  const selected = getSelectedFieldReference(editor);
  if (!selected) {
    return false;
  }

  const resolved = editor.state.doc.resolve(selected.position);
  const removeArea = resolved.parent.type.name === 'signingArea' && resolved.parent.childCount === 1;
  editor.view.dispatch(editor.state.tr.delete(
    removeArea ? resolved.before(resolved.depth) : selected.position,
    removeArea ? resolved.after(resolved.depth) : selected.position + selected.node.nodeSize,
  ));
  return true;
}

export function resetSelectedReferenceSize(editor: Editor): boolean {
  const selected = getSelectedFieldReference(editor);
  if (!selected) {
    return false;
  }

  if (selected.node.type.name === 'inlineField') {
    return updateSelectedReference(editor, { width: 120 });
  }

  return updateSelectedReference(
    editor,
    selected.field.type === 'signature'
      ? { width: 160, height: 80 }
      : { width: 120, height: 120 },
  );
}

export function getFields(editor: Editor): FieldDefinition[] {
  return getFieldDefinitions(editor);
}

export function getPageMargins(editor: Editor): PageMargins {
  return normalizePageMargins(editor.state.doc.attrs.pageMargins);
}

function clampIntegerOffset(value: number, minimum: number, maximum: number): number {
  const minimumInteger = Math.ceil(minimum);
  const maximumInteger = Math.floor(maximum);
  if (minimumInteger > maximumInteger) return Math.round((minimum + maximum) / 2);
  return Math.min(maximumInteger, Math.max(minimumInteger, Math.round(value)));
}

export function updatePageMargins(editor: Editor, margins: PageMargins): boolean {
  const normalized = normalizePageMargins(margins);
  const transaction = editor.state.tr.setDocAttribute('pageMargins', normalized);

  editor.state.doc.descendants((node, position) => {
    if (node.type.name !== 'floatingField' && node.type.name !== 'pageOverlay') return;
    const wrapper = Array.from(document.querySelectorAll<HTMLElement>('[data-ref-id]'))
      .find((element) => element.dataset.refId === node.attrs.refId);
    const element = wrapper?.querySelector<HTMLElement>(
      node.type.name === 'pageOverlay' ? '.page-overlay__box' : '.floating-field__box',
    );
    const page = element?.closest<HTMLElement>('.contract-page');
    if (!element || !page) return;

    const pageRect = page.getBoundingClientRect();
    const pageStyle = window.getComputedStyle(page);
    const borderLeft = Number.parseFloat(pageStyle.borderLeftWidth) || 0;
    const borderRight = Number.parseFloat(pageStyle.borderRightWidth) || 0;
    const borderTop = Number.parseFloat(pageStyle.borderTopWidth) || 0;
    const borderBottom = Number.parseFloat(pageStyle.borderBottomWidth) || 0;
    const pixelsPerMmX = (pageRect.width - borderLeft - borderRight) / 210;
    const pixelsPerMmY = (pageRect.height - borderTop - borderBottom) / 297;
    const safeLeft = pageRect.left + borderLeft + normalized.left * pixelsPerMmX;
    const safeRight = pageRect.right - borderRight - normalized.right * pixelsPerMmX;
    const safeTop = pageRect.top + borderTop + normalized.top * pixelsPerMmY;
    const safeBottom = pageRect.bottom - borderBottom - normalized.bottom * pixelsPerMmY;
    const minimumWidth = node.attrs.fieldType === 'signature' ? 80 : 60;
    const minimumHeight = node.attrs.fieldType === 'signature' ? 40 : 60;
    const width = Math.floor(Math.max(
      minimumWidth,
      Math.min(node.attrs.width, safeRight - safeLeft),
    ));
    const height = Math.floor(Math.max(
      minimumHeight,
      Math.min(node.attrs.height, safeBottom - safeTop),
    ));
    if (node.type.name === 'pageOverlay') {
      transaction.setNodeMarkup(position, undefined, {
        ...node.attrs,
        width,
        height,
        x: clampIntegerOffset(Number(node.attrs.x) || 0, 0, safeRight - safeLeft - width),
        y: clampIntegerOffset(Number(node.attrs.y) || 0, 0, safeBottom - safeTop - height),
      }, node.marks);
      return;
    }
    const elementRect = element.getBoundingClientRect();
    const currentX = Number(node.attrs.offsetX) || 0;
    const currentY = Number(node.attrs.offsetY) || 0;
    const anchorLeft = elementRect.left - currentX;
    const anchorTop = elementRect.top - currentY;
    const offsetX = clampIntegerOffset(
      currentX,
      safeLeft - anchorLeft,
      safeRight - width - anchorLeft,
    );
    const offsetY = clampIntegerOffset(
      currentY,
      safeTop - anchorTop,
      safeBottom - height - anchorTop,
    );

    transaction.setNodeMarkup(position, undefined, {
      ...node.attrs,
      width,
      height,
      offsetX,
      offsetY,
    }, node.marks);
  });

  editor.view.dispatch(transaction);
  return true;
}

function getSelectedTableId(editor: Editor): string | null {
  const resolved = editor.state.selection.$from;
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    const node = resolved.node(depth);
    if (node.type.name === 'table' && typeof node.attrs.tableId === 'string') {
      return node.attrs.tableId;
    }
  }
  return null;
}

export type LogicalTableCommand =
  | 'addRowBefore'
  | 'addRowAfter'
  | 'deleteRow'
  | 'addColumnBefore'
  | 'addColumnAfter'
  | 'deleteColumn'
  | 'toggleHeaderRow';

interface TableCellLocation {
  rowId: string;
  columnIndex: number;
}

interface TableSelectionSnapshot {
  anchor: TableCellLocation | null;
  head: TableCellLocation | null;
  isCellSelection: boolean;
}

function getCellLocation(resolved: Selection['$from']): TableCellLocation | null {
  let rowDepth = -1;
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    if (resolved.node(depth).type.name === 'tableRow') {
      rowDepth = depth;
      break;
    }
  }
  if (rowDepth < 0) return null;

  const row = resolved.node(rowDepth);
  const rowId = row.attrs.repeatedHeader
    ? row.attrs.sourceRowId || row.attrs.rowId
    : row.attrs.rowId;
  if (typeof rowId !== 'string' || !rowId) return null;
  return { rowId, columnIndex: resolved.index(rowDepth) };
}

function captureTableSelection(editor: Editor): TableSelectionSnapshot {
  const selection = editor.state.selection;
  if (selection instanceof CellSelection) {
    return {
      anchor: getCellLocation(selection.$anchorCell),
      head: getCellLocation(selection.$headCell),
      isCellSelection: true,
    };
  }
  const location = getCellLocation(selection.$from);
  return { anchor: location, head: location, isCellSelection: false };
}

function findCellPosition(
  documentNode: ProseMirrorNode,
  location: TableCellLocation | null,
): number | null {
  if (!location) return null;
  let result: number | null = null;
  documentNode.descendants((node, position) => {
    if (node.type.name !== 'tableRow' || node.attrs.rowId !== location.rowId) {
      return result === null;
    }
    let cellPosition = position + 1;
    for (let index = 0; index < node.childCount; index += 1) {
      if (index === location.columnIndex) {
        result = cellPosition;
        return false;
      }
      cellPosition += node.child(index).nodeSize;
    }
    return false;
  });
  return result;
}

function isHeaderRow(row: ProseMirrorNode): boolean {
  return row.childCount > 0 && row.child(0).type.name === 'tableHeader';
}

function mergeSelectedTableFragments(editor: Editor, tableId: string): boolean {
  const fragments: ProseMirrorNode[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'table' && node.attrs.tableId === tableId) fragments.push(node);
  });
  if (fragments.length <= 1) return false;

  const snapshot = captureTableSelection(editor);
  const source = fragments.find((fragment) => !fragment.attrs.continuation) || fragments[0];
  const rows: ProseMirrorNode[] = [];
  fragments.forEach((fragment) => {
    fragment.forEach((row) => {
      if (!row.attrs.repeatedHeader) rows.push(row);
    });
  });
  const headerRows = rows.filter(isHeaderRow);
  const bodyRows = rows.filter((row) => !isHeaderRow(row));
  const mergedTable = source.type.create(
    { ...source.attrs, continuation: false },
    Fragment.fromArray([...headerRows, ...bodyRows]),
  );

  let inserted = false;
  const pages: ProseMirrorNode[] = [];
  editor.state.doc.forEach((page) => {
    const children: ProseMirrorNode[] = [];
    page.forEach((child) => {
      if (child.type.name !== 'table' || child.attrs.tableId !== tableId) {
        children.push(child);
      } else if (!inserted) {
        children.push(mergedTable);
        inserted = true;
      }
    });
    if (!children.length && page.attrs.breakType === 'auto') return;
    const hasFlowContent = children.some((child) => child.type.name !== 'pageOverlay');
    const pageChildren = hasFlowContent
      ? children
      : [editor.schema.nodes.paragraph.create(), ...children];
    pages.push(page.type.create(
      { ...page.attrs, breakType: pages.length === 0 ? 'root' : page.attrs.breakType },
      Fragment.fromArray(pageChildren.length
        ? pageChildren
        : [editor.schema.nodes.paragraph.create()]),
    ));
  });

  const transaction = editor.state.tr.replaceWith(
    0,
    editor.state.doc.content.size,
    Fragment.fromArray(pages),
  );
  const anchor = findCellPosition(transaction.doc, snapshot.anchor);
  const head = findCellPosition(transaction.doc, snapshot.head);
  if (snapshot.isCellSelection && anchor !== null && head !== null) {
    transaction.setSelection(CellSelection.create(transaction.doc, anchor, head));
  } else if (anchor !== null) {
    transaction.setSelection(Selection.near(transaction.doc.resolve(anchor + 1)));
  }
  transaction.setMeta(PAGINATION_META, true);
  transaction.setMeta('addToHistory', false);
  editor.view.dispatch(transaction);
  return true;
}

function executeTableCommand(editor: Editor, command: LogicalTableCommand): boolean {
  switch (command) {
    case 'addRowBefore': return editor.chain().focus().addRowBefore().run();
    case 'addRowAfter': return editor.chain().focus().addRowAfter().run();
    case 'deleteRow': return editor.chain().focus().deleteRow().run();
    case 'addColumnBefore': return editor.chain().focus().addColumnBefore().run();
    case 'addColumnAfter': return editor.chain().focus().addColumnAfter().run();
    case 'deleteColumn': return editor.chain().focus().deleteColumn().run();
    case 'toggleHeaderRow': return editor.chain().focus().toggleHeaderRow().run();
    default: return false;
  }
}

export function runLogicalTableCommand(
  editor: Editor,
  command: LogicalTableCommand,
): boolean {
  if (selectedFieldTable(editor)) return false;
  const tableId = getSelectedTableId(editor);
  if (!tableId) return false;
  mergeSelectedTableFragments(editor, tableId);
  return executeTableCommand(editor, command);
}

export function hasSelectedTableContinuation(editor: Editor): boolean {
  const tableId = getSelectedTableId(editor);
  if (!tableId) return false;
  let fragments = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'table' && node.attrs.tableId === tableId) fragments += 1;
  });
  return fragments > 1;
}

export function deleteLogicalTable(editor: Editor): boolean {
  const tableId = getSelectedTableId(editor);
  if (!tableId) return false;
  const pages: ProseMirrorNode[] = [];

  editor.state.doc.forEach((page) => {
    const children: ProseMirrorNode[] = [];
    page.forEach((child) => {
      if (child.type.name !== 'table' || child.attrs.tableId !== tableId) children.push(child);
    });
    if (!children.length && page.attrs.breakType === 'auto') return;
    const hasFlowContent = children.some((child) => child.type.name !== 'pageOverlay');
    const pageChildren = hasFlowContent
      ? children
      : [editor.schema.nodes.paragraph.create(), ...children];
    pages.push(page.type.create(
      { ...page.attrs, breakType: pages.length === 0 ? 'root' : page.attrs.breakType },
      Fragment.fromArray(pageChildren.length
        ? pageChildren
        : [editor.schema.nodes.paragraph.create()]),
    ));
  });

  if (!pages.length) {
    pages.push(editor.schema.nodes.page.create(
      { pageId: createId('page'), breakType: 'root' },
      editor.schema.nodes.paragraph.create(),
    ));
  }
  const transaction = editor.state.tr.replaceWith(
    0,
    editor.state.doc.content.size,
    Fragment.fromArray(pages),
  );
  transaction.setSelection(Selection.near(transaction.doc.resolve(1)));
  editor.view.dispatch(transaction.scrollIntoView());
  return true;
}
