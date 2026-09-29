import { Extension } from '@tiptap/core';
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type EditorState,
  type Transaction,
} from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { createId } from '../id';
import { isFieldTableConfig } from '../fieldTableTypes';

export const PAGINATION_META = 'contractPagination';
const PaginationPluginKey = new PluginKey<{ rootTransaction: Transaction | null }>('contractPagination');
const PAGE_TOLERANCE = 2;
const BLOCK_ID_TYPES = new Set(['paragraph', 'heading', 'bulletList', 'orderedList']);

interface PageInfo {
  node: ProseMirrorNode;
  position: number;
}

interface StablePoint {
  blockId: string | null;
  relative: number;
  fallback: number;
}

interface SelectionSnapshot {
  anchor: StablePoint;
  head: StablePoint;
  nodeRefId: string | null;
}

function getPages(documentNode: ProseMirrorNode): PageInfo[] {
  const pages: PageInfo[] = [];
  documentNode.forEach((node, position) => {
    if (node.type.name === 'page') pages.push({ node, position });
  });
  return pages;
}

function getChildren(node: ProseMirrorNode): ProseMirrorNode[] {
  const children: ProseMirrorNode[] = [];
  node.forEach((child) => children.push(child));
  return children;
}

function getPageFlowChildren(page: ProseMirrorNode): ProseMirrorNode[] {
  return getChildren(page).filter((child) => child.type.name !== 'pageOverlay');
}

function getPageOverlays(page: ProseMirrorNode): ProseMirrorNode[] {
  return getChildren(page).filter((child) => child.type.name === 'pageOverlay');
}

function createEmptyParagraph(page: ProseMirrorNode): ProseMirrorNode {
  return page.type.schema.nodes.paragraph.create();
}

function getPageContentElement(view: EditorView, pagePosition: number): HTMLElement | null {
  const dom = view.nodeDOM(pagePosition);
  if (!(dom instanceof HTMLElement)) return null;
  const page = dom.matches('.contract-page') ? dom : dom.querySelector<HTMLElement>('.contract-page');
  return page?.querySelector<HTMLElement>('.contract-page__content') || null;
}

function getNodeElement(view: EditorView, position: number): HTMLElement | null {
  const dom = view.nodeDOM(position);
  return dom instanceof HTMLElement ? dom : dom?.parentElement || null;
}

function getBlockPosition(page: PageInfo, childIndex: number): number {
  let position = page.position + 1;
  for (let index = 0; index < childIndex; index += 1) {
    position += page.node.child(index).nodeSize;
  }
  return position;
}

function getOuterHeight(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.height + (Number.parseFloat(style.marginTop) || 0) + (Number.parseFloat(style.marginBottom) || 0);
}

function getPoint(documentNode: ProseMirrorNode, position: number): StablePoint {
  const resolved = documentNode.resolve(Math.max(0, Math.min(position, documentNode.content.size)));
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    const node = resolved.node(depth);
    if (typeof node.attrs.blockId === 'string' && node.attrs.blockId) {
      const before = resolved.before(depth);
      return {
        blockId: node.attrs.blockId,
        relative: position - before,
        fallback: position,
      };
    }
  }
  return { blockId: null, relative: 0, fallback: position };
}

function captureSelection(view: EditorView): SelectionSnapshot {
  const { selection, doc } = view.state;
  return {
    anchor: getPoint(doc, selection.anchor),
    head: getPoint(doc, selection.head),
    nodeRefId: selection instanceof NodeSelection && typeof selection.node.attrs.refId === 'string'
      ? selection.node.attrs.refId
      : null,
  };
}

function findNodePositionByAttribute(
  documentNode: ProseMirrorNode,
  attribute: 'blockId' | 'refId',
  value: string,
): { node: ProseMirrorNode; position: number } | null {
  let result: { node: ProseMirrorNode; position: number } | null = null;
  documentNode.descendants((node, position) => {
    if (node.attrs[attribute] === value) {
      result = { node, position };
      return false;
    }
    return result === null;
  });
  return result;
}

function resolvePoint(documentNode: ProseMirrorNode, point: StablePoint): number {
  if (point.blockId) {
    const match = findNodePositionByAttribute(documentNode, 'blockId', point.blockId);
    if (match) {
      return Math.max(
        match.position + 1,
        Math.min(match.position + match.node.nodeSize - 1, match.position + point.relative),
      );
    }
  }
  return Math.max(0, Math.min(point.fallback, documentNode.content.size));
}

function restoreSelection(transaction: Transaction, snapshot: SelectionSnapshot): void {
  if (snapshot.nodeRefId) {
    const match = findNodePositionByAttribute(transaction.doc, 'refId', snapshot.nodeRefId);
    if (match) {
      transaction.setSelection(NodeSelection.create(transaction.doc, match.position));
      return;
    }
  }

  const anchor = resolvePoint(transaction.doc, snapshot.anchor);
  const head = resolvePoint(transaction.doc, snapshot.head);
  const anchorResolved = transaction.doc.resolve(anchor);
  const headResolved = transaction.doc.resolve(head);
  if (anchorResolved.parent.inlineContent && headResolved.parent.inlineContent) {
    transaction.setSelection(TextSelection.create(transaction.doc, anchor, head));
    return;
  }
  transaction.setSelection(Selection.near(anchorResolved));
}

function dispatchPaginationTransaction(
  view: EditorView,
  startPageIndex: number,
  replaceCount: number,
  replacementPages: ProseMirrorNode[],
  snapshot: SelectionSnapshot,
): boolean {
  const pages = getPages(view.state.doc);
  const first = pages[startPageIndex];
  const last = pages[startPageIndex + replaceCount - 1];
  if (!first || !last) return false;

  const transaction = view.state.tr.replaceWith(
    first.position,
    last.position + last.node.nodeSize,
    Fragment.fromArray(replacementPages),
  );
  restoreSelection(transaction, snapshot);
  markPaginationTransaction(view, transaction);
  view.dispatch(transaction);
  return true;
}

function markPaginationTransaction(view: EditorView, transaction: Transaction): void {
  transaction.setMeta(PAGINATION_META, true);
  const rootTransaction = PaginationPluginKey.getState(view.state)?.rootTransaction;
  if (rootTransaction) {
    transaction.setMeta('appendedTransaction', rootTransaction);
  } else {
    transaction.setMeta('addToHistory', false);
  }
}

function createPage(
  node: ProseMirrorNode,
  children: ProseMirrorNode[],
  attrs = node.attrs,
  overlays = getPageOverlays(node),
): ProseMirrorNode {
  return node.type.create(attrs, Fragment.fromArray([...children, ...overlays]));
}

function createAutoPage(referencePage: ProseMirrorNode, children: ProseMirrorNode[]): ProseMirrorNode {
  return referencePage.type.create(
    { pageId: createId('page'), breakType: 'auto' },
    Fragment.fromArray(children),
  );
}

function isEmptyAutomaticPage(page: ProseMirrorNode): boolean {
  const children = getPageFlowChildren(page);
  return page.attrs.breakType === 'auto'
    && children.length === 1
    && children[0].type.name === 'paragraph'
    && children[0].content.size === 0;
}

function getSelectionPageId(state: EditorState): string | null {
  const resolved = state.selection.$from;
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    const node = resolved.node(depth);
    if (node.type.name === 'page' && typeof node.attrs.pageId === 'string') {
      return node.attrs.pageId;
    }
  }
  return null;
}

function removeEmptyAutomaticPage(
  state: EditorState,
  preferredPageId: string | null = getSelectionPageId(state),
): Transaction | null {
  const pages = getPages(state.doc);
  if (pages.length <= 1) return null;
  const selectedPageIndex = preferredPageId
    ? pages.findIndex(({ node }) => node.attrs.pageId === preferredPageId)
    : pages.findIndex(({ node, position }) => (
      state.selection.from > position && state.selection.from < position + node.nodeSize
    ));
  if (selectedPageIndex <= 0) return null;
  const selectedPage = pages[selectedPageIndex];
  if (!isEmptyAutomaticPage(selectedPage.node)) return null;

  const previousPage = pages[selectedPageIndex - 1];
  const movedOverlays = getPageOverlays(selectedPage.node);
  const selectedRefId = state.selection instanceof NodeSelection
    ? state.selection.node.attrs.refId
    : null;
  const replacement = createPage(
    previousPage.node,
    getPageFlowChildren(previousPage.node),
    previousPage.node.attrs,
    [...getPageOverlays(previousPage.node), ...movedOverlays],
  );
  const transaction = state.tr.replaceWith(
    previousPage.position,
    selectedPage.position + selectedPage.node.nodeSize,
    replacement,
  );
  const selectedOverlay = typeof selectedRefId === 'string'
    ? findNodePositionByAttribute(transaction.doc, 'refId', selectedRefId)
    : null;
  if (selectedOverlay) {
    transaction.setSelection(NodeSelection.create(transaction.doc, selectedOverlay.position));
  } else {
    const previousPageEnd = previousPage.position + replacement.nodeSize - 1;
    transaction.setSelection(Selection.near(transaction.doc.resolve(previousPageEnd), -1));
  }
  transaction.setMeta(PAGINATION_META, true);
  return transaction.scrollIntoView();
}

function getEdgeCharacterSize(node: ProseMirrorNode, edge: 'start' | 'end'): number {
  const child = edge === 'start' ? node.firstChild : node.lastChild;
  if (!child?.isText || !child.text) return node.content.size > 0 ? 1 : 0;
  const characters = Array.from(child.text);
  const character = edge === 'start' ? characters[0] : characters[characters.length - 1];
  return character?.length || 0;
}

function joinTextblocksAcrossAutomaticPage(
  state: EditorState,
  leftPageIndex: number,
  deleteDirection: 'backward' | 'forward',
): Transaction | null {
  const pages = getPages(state.doc);
  const leftPage = pages[leftPageIndex];
  const rightPage = pages[leftPageIndex + 1];
  if (!leftPage || !rightPage || rightPage.node.attrs.breakType !== 'auto') return null;

  const leftChildren = getPageFlowChildren(leftPage.node);
  const rightChildren = getPageFlowChildren(rightPage.node);
  const left = leftChildren[leftChildren.length - 1];
  const right = rightChildren[0];
  if (!left?.isTextblock || !right?.isTextblock) return null;

  const isParagraphContinuation = left.type.name === 'paragraph'
    && right.type.name === 'paragraph'
    && right.attrs.continuation
    && left.attrs.flowId
    && left.attrs.flowId === right.attrs.flowId;
  let leftContent = left.content;
  let rightContent = right.content;
  if (isParagraphContinuation && deleteDirection === 'backward') {
    const deleteSize = getEdgeCharacterSize(left, 'end');
    leftContent = left.content.cut(0, Math.max(0, left.content.size - deleteSize));
  }
  if (isParagraphContinuation && deleteDirection === 'forward') {
    const deleteSize = getEdgeCharacterSize(right, 'start');
    rightContent = right.content.cut(Math.min(right.content.size, deleteSize));
  }

  const mergedContent = leftContent.append(rightContent);
  if (!left.type.validContent(mergedContent)) return null;
  const merged = left.type.create(
    { ...left.attrs, continuation: false },
    mergedContent,
    left.marks,
  );
  const updatedLeftChildren = [
    ...leftChildren.slice(0, -1),
    merged,
  ];
  const updatedLeftPage = createPage(leftPage.node, updatedLeftChildren);
  const remainingRightChildren = rightChildren.slice(1);
  const replacementPages = [updatedLeftPage];
  if (remainingRightChildren.length) {
    replacementPages.push(createPage(
      rightPage.node,
      remainingRightChildren,
    ));
  } else if (getPageOverlays(rightPage.node).length) {
    replacementPages.push(createPage(
      rightPage.node,
      [createEmptyParagraph(rightPage.node)],
    ));
  }

  const transaction = state.tr.replaceWith(
    leftPage.position,
    rightPage.position + rightPage.node.nodeSize,
    Fragment.fromArray(replacementPages),
  );
  const mergedPosition = leftPage.position + 1
    + leftChildren.slice(0, -1).reduce((size, child) => size + child.nodeSize, 0);
  transaction.setSelection(TextSelection.create(transaction.doc, mergedPosition + 1 + leftContent.size));
  return transaction.scrollIntoView();
}

function deleteAcrossAutomaticPageBoundary(
  state: EditorState,
  direction: 'backward' | 'forward',
): Transaction | null {
  if (!state.selection.empty || !(state.selection instanceof TextSelection)) return null;
  const pages = getPages(state.doc);
  const pageIndex = pages.findIndex(({ node, position }) => (
    state.selection.from > position && state.selection.from < position + node.nodeSize
  ));
  if (pageIndex < 0) return null;

  if (direction === 'backward') {
    const page = pages[pageIndex];
    const first = page ? getPageFlowChildren(page.node)[0] : undefined;
    const firstContentStart = page ? getBlockPosition(page, 0) + 1 : -1;
    if (
      pageIndex <= 0
      || page.node.attrs.breakType !== 'auto'
      || !first?.isTextblock
      || state.selection.from !== firstContentStart
    ) return null;
    return joinTextblocksAcrossAutomaticPage(state, pageIndex - 1, direction);
  }

  const page = pages[pageIndex];
  const nextPage = pages[pageIndex + 1];
  const pageChildren = getPageFlowChildren(page.node);
  const lastChildIndex = pageChildren.length - 1;
  const last = pageChildren[lastChildIndex];
  const lastContentEnd = last
    ? getBlockPosition(page, lastChildIndex) + last.nodeSize - 1
    : -1;
  if (
    !nextPage
    || nextPage.node.attrs.breakType !== 'auto'
    || !last?.isTextblock
    || state.selection.from !== lastContentEnd
  ) return null;
  return joinTextblocksAcrossAutomaticPage(state, pageIndex, direction);
}

function moveBlocksForward(
  view: EditorView,
  pageIndex: number,
  moveIndex: number,
  currentChildren: ProseMirrorNode[],
  snapshot: SelectionSnapshot,
): boolean {
  if (moveIndex <= 0 || moveIndex >= currentChildren.length) return false;
  const pages = getPages(view.state.doc);
  const current = pages[pageIndex];
  const next = pages[pageIndex + 1];
  const kept = currentChildren.slice(0, moveIndex);
  const moved = currentChildren.slice(moveIndex);
  const nextIsAutomatic = next?.node.attrs.breakType === 'auto';
  const nextPage = nextIsAutomatic
    ? createPage(next.node, [...moved, ...getPageFlowChildren(next.node)])
    : createAutoPage(current.node, moved);
  return dispatchPaginationTransaction(
    view,
    pageIndex,
    nextIsAutomatic ? 2 : 1,
    [createPage(current.node, kept), nextPage],
    snapshot,
  );
}

function isHeaderRow(row: ProseMirrorNode): boolean {
  return row.childCount > 0 && Array.from({ length: row.childCount })
    .every((_, index) => row.child(index).type.name === 'tableHeader');
}

function getHeaderRowCount(rows: ProseMirrorNode[]): number {
  const firstBodyRow = rows.findIndex((row) => !isHeaderRow(row));
  return firstBodyRow === -1 ? rows.length : firstBodyRow;
}

function mergeTableFragments(
  leading: ProseMirrorNode,
  trailing: ProseMirrorNode,
): ProseMirrorNode {
  const leadingRows = getChildren(leading);
  const trailingRows = getChildren(trailing);
  const trailingHeaderCount = getHeaderRowCount(trailingRows);
  return leading.type.create(
    leading.attrs,
    Fragment.fromArray([...leadingRows, ...trailingRows.slice(trailingHeaderCount)]),
  );
}

function refreshGeneratedIds(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const item = value as { attrs?: Record<string, unknown>; content?: unknown[] };
  if (item.attrs) {
    if ('blockId' in item.attrs) item.attrs.blockId = createId('block');
    if ('refId' in item.attrs) item.attrs.refId = createId('ref');
    if ('rowId' in item.attrs) item.attrs.rowId = createId('row');
  }
  item.content?.forEach(refreshGeneratedIds);
}

function createRepeatedHeaderRow(row: ProseMirrorNode, existingRowId?: string): ProseMirrorNode {
  const json = row.toJSON() as { attrs?: Record<string, unknown>; content?: unknown[] };
  refreshGeneratedIds(json);
  json.attrs = {
    ...(json.attrs || {}),
    rowId: existingRowId || createId('row'),
    repeatedHeader: true,
    sourceRowId: row.attrs.sourceRowId || row.attrs.rowId,
  };
  return row.type.schema.nodeFromJSON(json);
}

function plainTextParagraph(cell: ProseMirrorNode): ProseMirrorNode | null {
  if (cell.childCount !== 1) return null;
  const paragraph = cell.firstChild;
  if (!paragraph || paragraph.type.name !== 'paragraph') return null;
  let plainTextOnly = true;
  paragraph.forEach((child) => {
    if (!child.isText) plainTextOnly = false;
  });
  return plainTextOnly ? paragraph : null;
}

function measureOversizedRowCuts(
  table: HTMLTableElement,
  row: HTMLTableRowElement,
  headerCount: number,
  maximumRowHeight: number,
): number[] | null {
  const sourceCells = Array.from(row.cells);
  if (!sourceCells.length || maximumRowHeight <= 0) return null;

  const measurementContainer = document.createElement('div');
  measurementContainer.className = 'contract-page__content';
  measurementContainer.style.position = 'fixed';
  measurementContainer.style.left = '-100000px';
  measurementContainer.style.top = '0';
  measurementContainer.style.width = `${table.getBoundingClientRect().width}px`;
  measurementContainer.style.height = 'auto';
  measurementContainer.style.visibility = 'hidden';
  measurementContainer.style.pointerEvents = 'none';
  const measurementTable = table.cloneNode(false) as HTMLTableElement;
  measurementTable.style.width = `${table.getBoundingClientRect().width}px`;
  measurementTable.style.margin = '0';
  Array.from(table.children)
    .filter((child) => child.tagName === 'COLGROUP')
    .forEach((colgroup) => measurementTable.appendChild(colgroup.cloneNode(true)));

  if (headerCount > 0) {
    const head = document.createElement('thead');
    Array.from(table.rows).slice(0, headerCount)
      .forEach((header) => head.appendChild(header.cloneNode(true)));
    measurementTable.appendChild(head);
  }
  const body = document.createElement('tbody');
  const measurementRow = row.cloneNode(true) as HTMLTableRowElement;
  body.appendChild(measurementRow);
  measurementTable.appendChild(body);
  measurementContainer.appendChild(measurementTable);
  document.body.appendChild(measurementContainer);

  try {
    const cells = Array.from(measurementRow.cells);
    cells.forEach((cell) => { cell.textContent = ''; });
    if (measurementRow.getBoundingClientRect().height > maximumRowHeight) return null;

    const cuts = sourceCells.map((sourceCell, cellIndex) => {
      const text = sourceCell.textContent || '';
      let low = 0;
      let high = text.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        cells[cellIndex].textContent = text.slice(0, middle);
        if (measurementRow.getBoundingClientRect().height <= maximumRowHeight) low = middle;
        else high = middle - 1;
      }
      cells[cellIndex].textContent = text.slice(0, low);
      return low;
    });
    const progressed = cuts.some((cut) => cut > 0);
    const hasRemainder = cuts.some((cut, index) => cut < (sourceCells[index].textContent || '').length);
    return progressed && hasRemainder ? cuts : null;
  } finally {
    measurementContainer.remove();
  }
}

function splitPlainTextTableRow(
  row: ProseMirrorNode,
  cuts: number[],
): { leading: ProseMirrorNode; trailing: ProseMirrorNode } | null {
  const cells = getChildren(row);
  if (cells.length !== cuts.length) return null;
  const paragraphs = cells.map(plainTextParagraph);
  if (paragraphs.some((paragraph) => !paragraph)) return null;

  const leadingCells: ProseMirrorNode[] = [];
  const trailingCells: ProseMirrorNode[] = [];
  cells.forEach((cell, index) => {
    const paragraph = paragraphs[index]!;
    const cut = Math.max(0, Math.min(cuts[index], paragraph.content.size));
    const leadingParagraph = paragraph.type.create(
      paragraph.attrs,
      paragraph.content.cut(0, cut),
      paragraph.marks,
    );
    const trailingParagraph = paragraph.type.create(
      paragraph.attrs,
      paragraph.content.cut(cut),
      paragraph.marks,
    );
    leadingCells.push(cell.type.create(cell.attrs, leadingParagraph, cell.marks));
    trailingCells.push(cell.type.create(cell.attrs, trailingParagraph, cell.marks));
  });

  const sourceRowId = row.attrs.sourceRowId || row.attrs.rowId;
  return {
    leading: row.type.create({ ...row.attrs, sourceRowId }, Fragment.fromArray(leadingCells), row.marks),
    trailing: row.type.create({
      ...row.attrs,
      rowId: createId('row'),
      sourceRowId,
    }, Fragment.fromArray(trailingCells), row.marks),
  };
}

function splitRenderedTextTableRow(
  row: ProseMirrorNode,
  renderedRow: HTMLTableRowElement,
  cuts: number[],
): { leading: ProseMirrorNode; trailing: ProseMirrorNode } | null {
  const cells = getChildren(row);
  const renderedCells = Array.from(renderedRow.cells);
  if (cells.length !== cuts.length || renderedCells.length !== cells.length) return null;
  const leadingCells: ProseMirrorNode[] = [];
  const trailingCells: ProseMirrorNode[] = [];
  cells.forEach((cell, index) => {
    const paragraph = cell.firstChild;
    if (!paragraph || paragraph.type.name !== 'paragraph') return;
    const text = renderedCells[index].textContent || '';
    const cut = Math.max(0, Math.min(cuts[index], text.length));
    const makeParagraph = (value: string) => paragraph.type.create(
      paragraph.attrs,
      value ? paragraph.type.schema.text(value) : undefined,
      paragraph.marks,
    );
    leadingCells.push(cell.type.create(cell.attrs, makeParagraph(text.slice(0, cut)), cell.marks));
    trailingCells.push(cell.type.create(cell.attrs, makeParagraph(text.slice(cut)), cell.marks));
  });
  if (leadingCells.length !== cells.length || trailingCells.length !== cells.length) return null;
  const sourceRowId = row.attrs.sourceRowId || row.attrs.rowId;
  return {
    leading: row.type.create({ ...row.attrs, sourceRowId }, Fragment.fromArray(leadingCells), row.marks),
    trailing: row.type.create({ ...row.attrs, rowId: createId('row'), sourceRowId }, Fragment.fromArray(trailingCells), row.marks),
  };
}

function splitTableForward(
  view: EditorView,
  pageIndex: number,
  tableIndex: number,
  tableElement: HTMLElement,
  pageTop: number,
  pageBottom: number,
  currentChildren: ProseMirrorNode[],
  snapshot: SelectionSnapshot,
): boolean {
  const table = currentChildren[tableIndex];
  const rows = getChildren(table);
  const normalizedHeaderCount = getHeaderRowCount(rows);
  let bodyRows = rows.slice(normalizedHeaderCount);
  if (!bodyRows.length) return false;

  const htmlTable = tableElement.matches('table')
    ? tableElement as HTMLTableElement
    : tableElement.querySelector<HTMLTableElement>('table');
  if (!htmlTable) return false;
  const renderedRows = Array.from(htmlTable.rows);
  let fittingBodyRows = 0;
  for (let index = 0; index < bodyRows.length; index += 1) {
    const renderedRow = renderedRows[normalizedHeaderCount + index];
    if (!renderedRow || renderedRow.getBoundingClientRect().bottom > pageBottom - PAGE_TOLERANCE) break;
    fittingBodyRows += 1;
  }
  if (fittingBodyRows <= 0) {
    const firstRenderedBodyRow = renderedRows[normalizedHeaderCount];
    const tableTop = htmlTable.getBoundingClientRect().top;
    if (
      !firstRenderedBodyRow
      || tableTop > pageTop + PAGE_TOLERANCE
    ) return false;
    const cuts = measureOversizedRowCuts(
      htmlTable,
      firstRenderedBodyRow,
      normalizedHeaderCount,
      pageBottom - firstRenderedBodyRow.getBoundingClientRect().top - PAGE_TOLERANCE,
    );
    const config = table.attrs.fieldTable;
    const readonlyDynamicRow = isFieldTableConfig(config)
      && config.columns.every(column => column.binding.kind !== 'control' && column.binding.kind !== 'system');
    const split = cuts
      ? splitPlainTextTableRow(bodyRows[0], cuts)
        || (readonlyDynamicRow ? splitRenderedTextTableRow(bodyRows[0], firstRenderedBodyRow, cuts) : null)
      : null;
    if (!split) return false;
    bodyRows = [split.leading, split.trailing, ...bodyRows.slice(1)];
    fittingBodyRows = 1;
  }
  if (fittingBodyRows >= bodyRows.length) return false;

  const headers = rows.slice(0, normalizedHeaderCount);
  const leftTable = table.type.create(
    table.attrs,
    Fragment.fromArray([...headers, ...bodyRows.slice(0, fittingBodyRows)]),
  );
  const repeatedHeaders = headers.map((row) => createRepeatedHeaderRow(row));
  const rightTable = table.type.create(
    {
      ...table.attrs,
      fragmentId: createId('fragment'),
      continuation: true,
    },
    Fragment.fromArray([...repeatedHeaders, ...bodyRows.slice(fittingBodyRows)]),
  );

  const pages = getPages(view.state.doc);
  const current = pages[pageIndex];
  const next = pages[pageIndex + 1];
  const nextIsAutomatic = next?.node.attrs.breakType === 'auto';
  const currentPage = createPage(current.node, [
    ...currentChildren.slice(0, tableIndex),
    leftTable,
  ]);
  const movedBlocks = [rightTable, ...currentChildren.slice(tableIndex + 1)];
  let nextPage: ProseMirrorNode;
  if (nextIsAutomatic) {
    const existingNextChildren = getPageFlowChildren(next.node);
    const existingFirst = existingNextChildren[0];
    if (
      existingFirst?.type.name === 'table' &&
      existingFirst.attrs.tableId === rightTable.attrs.tableId
    ) {
      nextPage = createPage(next.node, [
        mergeTableFragments(rightTable, existingFirst),
        ...currentChildren.slice(tableIndex + 1),
        ...existingNextChildren.slice(1),
      ]);
    } else {
      nextPage = createPage(next.node, [...movedBlocks, ...existingNextChildren]);
    }
  } else {
    nextPage = createAutoPage(current.node, movedBlocks);
  }
  return dispatchPaginationTransaction(
    view,
    pageIndex,
    nextIsAutomatic ? 2 : 1,
    [currentPage, nextPage],
    snapshot,
  );
}

function remapSplitPoint(point: StablePoint, sourceBlockId: string, rightBlockId: string, cut: number): StablePoint {
  if (point.blockId !== sourceBlockId || point.relative <= cut + 1) return point;
  return { ...point, blockId: rightBlockId, relative: point.relative - cut };
}

function splitParagraphForward(
  view: EditorView,
  pageIndex: number,
  paragraphIndex: number,
  paragraphPosition: number,
  pageBottom: number,
  currentChildren: ProseMirrorNode[],
  snapshot: SelectionSnapshot,
): boolean {
  const paragraph = currentChildren[paragraphIndex];
  if (paragraph.type.name !== 'paragraph' || paragraph.content.size < 2) return false;

  let low = 1;
  let high = paragraph.content.size - 1;
  let cut = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const coordinates = view.coordsAtPos(paragraphPosition + 1 + middle);
    if (coordinates.bottom <= pageBottom - PAGE_TOLERANCE) {
      cut = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (cut <= 0 || cut >= paragraph.content.size) return false;

  const sourceBlockId = paragraph.attrs.blockId as string;
  const rightBlockId = createId('block');
  const flowId = paragraph.attrs.flowId || createId('flow');
  const leftParagraph = paragraph.type.create(
    { ...paragraph.attrs, flowId },
    paragraph.content.cut(0, cut),
    paragraph.marks,
  );
  const rightParagraph = paragraph.type.create(
    {
      ...paragraph.attrs,
      blockId: rightBlockId,
      flowId,
      continuation: true,
    },
    paragraph.content.cut(cut),
    paragraph.marks,
  );
  const nextSnapshot: SelectionSnapshot = {
    ...snapshot,
    anchor: remapSplitPoint(snapshot.anchor, sourceBlockId, rightBlockId, cut),
    head: remapSplitPoint(snapshot.head, sourceBlockId, rightBlockId, cut),
  };

  const pages = getPages(view.state.doc);
  const current = pages[pageIndex];
  const next = pages[pageIndex + 1];
  const nextIsAutomatic = next?.node.attrs.breakType === 'auto';
  const currentPage = createPage(current.node, [
    ...currentChildren.slice(0, paragraphIndex),
    leftParagraph,
  ]);
  const movedBlocks = [rightParagraph, ...currentChildren.slice(paragraphIndex + 1)];
  const nextPage = nextIsAutomatic
    ? createPage(next.node, [...movedBlocks, ...getPageFlowChildren(next.node)])
    : createAutoPage(current.node, movedBlocks);
  return dispatchPaginationTransaction(
    view,
    pageIndex,
    nextIsAutomatic ? 2 : 1,
    [currentPage, nextPage],
    nextSnapshot,
  );
}

function paginateOverflowOnce(view: EditorView): boolean {
  const pages = getPages(view.state.doc);
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex];
    const contentElement = getPageContentElement(view, page.position);
    if (!contentElement) continue;
    const pageBounds = contentElement.getBoundingClientRect();
    const pageTop = pageBounds.top;
    const pageBottom = pageBounds.bottom;
    const children = getPageFlowChildren(page.node);
    let overflowIndex = -1;
    let overflowElement: HTMLElement | null = null;

    for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
      const element = getNodeElement(view, getBlockPosition(page, childIndex));
      if (element && element.getBoundingClientRect().bottom > pageBottom + PAGE_TOLERANCE) {
        overflowIndex = childIndex;
        overflowElement = element;
        break;
      }
    }
    if (overflowIndex < 0 || !overflowElement) continue;

    const snapshot = captureSelection(view);
    const overflowNode = children[overflowIndex];
    const overflowPosition = getBlockPosition(page, overflowIndex);
    if (
      overflowNode.type.name === 'table' &&
      splitTableForward(
        view,
        pageIndex,
        overflowIndex,
        overflowElement,
        pageTop,
        pageBottom,
        children,
        snapshot,
      )
    ) return true;

    const overflowTop = overflowElement.getBoundingClientRect().top;
    if (
      overflowNode.type.name === 'paragraph' &&
      overflowTop < pageBottom - PAGE_TOLERANCE &&
      splitParagraphForward(
        view,
        pageIndex,
        overflowIndex,
        overflowPosition,
        pageBottom,
        children,
        snapshot,
      )
    ) return true;

    let moveIndex = overflowIndex;
    if (moveIndex > 0 && children[moveIndex - 1].type.name === 'heading') moveIndex -= 1;
    if (moveBlocksForward(view, pageIndex, moveIndex, children, snapshot)) return true;
  }
  return false;
}

function removeFirstBlockFromNextPage(
  view: EditorView,
  pageIndex: number,
  currentChildren: ProseMirrorNode[],
  nextChildren: ProseMirrorNode[],
  nextFirstReplacement?: ProseMirrorNode,
): boolean {
  const pages = getPages(view.state.doc);
  const current = pages[pageIndex];
  const next = pages[pageIndex + 1];
  if (!current || !next) return false;
  const moved = nextFirstReplacement || nextChildren[0];
  const remaining = nextChildren.slice(1);
  const expandedCurrentChildren = [...currentChildren, moved];
  const replacementPages = [createPage(current.node, expandedCurrentChildren)];
  if (remaining.length) {
    replacementPages.push(createPage(next.node, remaining));
  } else if (getPageOverlays(next.node).length) {
    replacementPages.push(createPage(next.node, [createEmptyParagraph(next.node)]));
  }
  return dispatchPaginationTransaction(
    view,
    pageIndex,
    2,
    replacementPages,
    captureSelection(view),
  );
}

function mergeParagraphContinuations(
  view: EditorView,
  pageIndex: number,
  currentChildren: ProseMirrorNode[],
  nextChildren: ProseMirrorNode[],
): boolean {
  const left = currentChildren[currentChildren.length - 1];
  const right = nextChildren[0];
  if (
    left.type.name !== 'paragraph' ||
    right.type.name !== 'paragraph' ||
    !left.attrs.flowId ||
    left.attrs.flowId !== right.attrs.flowId
  ) return false;

  const pages = getPages(view.state.doc);
  const current = pages[pageIndex];
  const next = pages[pageIndex + 1];
  if (!current || !next) return false;
  const merged = left.type.create(
    { ...left.attrs, continuation: false },
    left.content.append(right.content),
    left.marks,
  );
  const mergedCurrentChildren = [
    ...currentChildren.slice(0, -1),
    merged,
  ];
  const remaining = nextChildren.slice(1);
  const currentPage = createPage(current.node, mergedCurrentChildren);
  const replacementPages = [currentPage];
  if (remaining.length) {
    replacementPages.push(createPage(next.node, remaining));
  } else if (getPageOverlays(next.node).length) {
    replacementPages.push(createPage(next.node, [createEmptyParagraph(next.node)]));
  }
  return dispatchPaginationTransaction(
    view,
    pageIndex,
    2,
    replacementPages,
    captureSelection(view),
  );
}

function backfillTableRow(
  view: EditorView,
  pageIndex: number,
  currentChildren: ProseMirrorNode[],
  nextChildren: ProseMirrorNode[],
  availableHeight: number,
): boolean {
  const currentTable = currentChildren[currentChildren.length - 1];
  const nextTable = nextChildren[0];
  if (
    currentTable.type.name !== 'table' ||
    nextTable.type.name !== 'table' ||
    currentTable.attrs.tableId !== nextTable.attrs.tableId ||
    !nextTable.attrs.continuation
  ) return false;

  const pages = getPages(view.state.doc);
  const nextTablePosition = getBlockPosition(pages[pageIndex + 1], 0);
  const nextTableElement = getNodeElement(view, nextTablePosition);
  const htmlTable = nextTableElement?.matches('table')
    ? nextTableElement as HTMLTableElement
    : nextTableElement?.querySelector<HTMLTableElement>('table');
  if (!htmlTable) return false;

  const nextRows = getChildren(nextTable);
  const normalizedHeaderCount = getHeaderRowCount(nextRows);
  const firstBodyRow = nextRows[normalizedHeaderCount];
  const renderedBodyRow = htmlTable.rows[normalizedHeaderCount];
  if (!firstBodyRow || !renderedBodyRow || renderedBodyRow.getBoundingClientRect().height > availableHeight - 4) {
    return false;
  }

  const currentRows = getChildren(currentTable);
  const nextBodyRows = nextRows.slice(normalizedHeaderCount + 1);
  const expandedCurrentTable = currentTable.type.create(
    currentTable.attrs,
    Fragment.fromArray([...currentRows, firstBodyRow]),
  );
  const updatedCurrentChildren = [
    ...currentChildren.slice(0, -1),
    expandedCurrentTable,
  ];
  const updatedNextChildren = nextBodyRows.length
    ? [
        nextTable.type.create(
          nextTable.attrs,
          Fragment.fromArray([...nextRows.slice(0, normalizedHeaderCount), ...nextBodyRows]),
        ),
        ...nextChildren.slice(1),
      ]
    : nextChildren.slice(1);

  const current = pages[pageIndex];
  const next = pages[pageIndex + 1];
  const replacementPages = [createPage(current.node, updatedCurrentChildren)];
  if (updatedNextChildren.length) {
    replacementPages.push(createPage(next.node, updatedNextChildren));
  } else if (getPageOverlays(next.node).length) {
    replacementPages.push(createPage(next.node, [createEmptyParagraph(next.node)]));
  }
  return dispatchPaginationTransaction(
    view,
    pageIndex,
    2,
    replacementPages,
    captureSelection(view),
  );
}

function backfillOnce(view: EditorView): boolean {
  const pages = getPages(view.state.doc);
  for (let pageIndex = 0; pageIndex < pages.length - 1; pageIndex += 1) {
    const current = pages[pageIndex];
    const next = pages[pageIndex + 1];
    if (next.node.attrs.breakType !== 'auto') continue;
    if (isEmptyAutomaticPage(next.node)) continue;
    const currentChildren = getPageFlowChildren(current.node);
    const nextChildren = getPageFlowChildren(next.node);
    if (!currentChildren.length || !nextChildren.length) continue;

    const currentContent = getPageContentElement(view, current.position);
    const currentLastPosition = getBlockPosition(current, currentChildren.length - 1);
    const currentLastElement = getNodeElement(view, currentLastPosition);
    if (!currentContent || !currentLastElement) continue;
    const availableHeight = currentContent.getBoundingClientRect().bottom
      - currentLastElement.getBoundingClientRect().bottom;

    const left = currentChildren[currentChildren.length - 1];
    const right = nextChildren[0];
    if (
      left.type.name === 'paragraph' &&
      right.type.name === 'paragraph' &&
      left.attrs.flowId &&
      left.attrs.flowId === right.attrs.flowId
    ) {
      const lineHeight = Number.parseFloat(window.getComputedStyle(currentLastElement).lineHeight) || 24;
      if (availableHeight >= lineHeight - PAGE_TOLERANCE) {
        return mergeParagraphContinuations(view, pageIndex, currentChildren, nextChildren);
      }
      continue;
    }

    if (backfillTableRow(view, pageIndex, currentChildren, nextChildren, availableHeight)) return true;
    if (
      left.type.name === 'table' &&
      right.type.name === 'table' &&
      left.attrs.tableId === right.attrs.tableId
    ) continue;

    const nextFirstPosition = getBlockPosition(next, 0);
    const nextFirstElement = getNodeElement(view, nextFirstPosition);
    if (!nextFirstElement || getOuterHeight(nextFirstElement) > availableHeight + PAGE_TOLERANCE) continue;
    return removeFirstBlockFromNextPage(view, pageIndex, currentChildren, nextChildren);
  }
  return false;
}

function removeStableEmptyAutomaticPageOnce(view: EditorView): boolean {
  const pages = getPages(view.state.doc);
  for (let pageIndex = 1; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex];
    if (!isEmptyAutomaticPage(page.node)) continue;
    const previous = pages[pageIndex - 1];
    const replacement = createPage(
      previous.node,
      getPageFlowChildren(previous.node),
      previous.node.attrs,
      [...getPageOverlays(previous.node), ...getPageOverlays(page.node)],
    );
    return dispatchPaginationTransaction(
      view,
      pageIndex - 1,
      2,
      [replacement],
      captureSelection(view),
    );
  }
  return false;
}

function stripGeneratedAttributes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripGeneratedAttributes);
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
    if (
      ['blockId', 'flowId', 'refId', 'rowId', 'repeatedHeader', 'sourceRowId'].includes(key)
    ) return;
    result[key] = stripGeneratedAttributes(child);
  });
  return result;
}

function syncRepeatedHeaderOnce(view: EditorView): boolean {
  const sources = new Map<string, ProseMirrorNode>();
  const repeated: Array<{ node: ProseMirrorNode; position: number }> = [];
  view.state.doc.descendants((node, position) => {
    if (node.type.name !== 'tableRow') return;
    if (node.attrs.repeatedHeader) {
      repeated.push({ node, position });
    } else if (isHeaderRow(node) && typeof node.attrs.rowId === 'string') {
      sources.set(node.attrs.rowId, node);
    }
  });

  const changed = repeated.find(({ node }) => {
    const source = sources.get(node.attrs.sourceRowId);
    if (!source) return false;
    return JSON.stringify(stripGeneratedAttributes(node.content.toJSON()))
      !== JSON.stringify(stripGeneratedAttributes(source.content.toJSON()));
  });
  if (!changed) return false;
  const source = sources.get(changed.node.attrs.sourceRowId);
  if (!source) return false;
  const replacement = createRepeatedHeaderRow(source, changed.node.attrs.rowId);
  const transaction = view.state.tr
    .replaceWith(changed.position, changed.position + changed.node.nodeSize, replacement);
  markPaginationTransaction(view, transaction);
  view.dispatch(transaction);
  return true;
}

function mergeAdjacentTableFragmentsOnce(view: EditorView): boolean {
  const pages = getPages(view.state.doc);
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const children = getPageFlowChildren(pages[pageIndex].node);
    for (let index = 0; index < children.length - 1; index += 1) {
      const leading = children[index];
      const trailing = children[index + 1];
      if (
        leading.type.name !== 'table' ||
        trailing.type.name !== 'table' ||
        leading.attrs.tableId !== trailing.attrs.tableId
      ) continue;
      const merged = mergeTableFragments(leading, trailing);
      const page = createPage(pages[pageIndex].node, [
        ...children.slice(0, index),
        merged,
        ...children.slice(index + 2),
      ]);
      return dispatchPaginationTransaction(
        view,
        pageIndex,
        1,
        [page],
        captureSelection(view),
      );
    }
  }
  return false;
}

function ensureStructuralIdsOnce(view: EditorView): boolean {
  const seenBlockIds = new Set<string>();
  const seenPrimaryFlowIds = new Set<string>();
  const seenFragmentIds = new Set<string>();
  const seenRowIds = new Set<string>();
  const transaction = view.state.tr;
  let changed = false;

  view.state.doc.descendants((node, position) => {
    const attrs = { ...node.attrs };
    let nodeChanged = false;
    if (BLOCK_ID_TYPES.has(node.type.name)) {
      if (typeof attrs.blockId !== 'string' || !attrs.blockId || seenBlockIds.has(attrs.blockId)) {
        attrs.blockId = createId('block');
        nodeChanged = true;
      }
      seenBlockIds.add(attrs.blockId);
      if (node.type.name === 'paragraph') {
        let flowId = typeof attrs.flowId === 'string' ? attrs.flowId : '';
        if (!attrs.continuation) {
          if (!flowId || seenPrimaryFlowIds.has(flowId)) {
            flowId = createId('flow');
            attrs.flowId = flowId;
            nodeChanged = true;
          }
          seenPrimaryFlowIds.add(flowId);
        } else if (!flowId) {
          attrs.flowId = createId('flow');
          nodeChanged = true;
        }
      }
    }
    if (node.type.name === 'page') {
      const expected = position === 0 ? 'root' : attrs.breakType || 'manual';
      if (attrs.breakType !== expected) {
        attrs.breakType = expected;
        nodeChanged = true;
      }
    }
    if (node.type.name === 'table') {
      if (typeof attrs.tableId !== 'string' || !attrs.tableId) {
        attrs.tableId = createId('table');
        nodeChanged = true;
      }
      if (typeof attrs.fragmentId !== 'string' || !attrs.fragmentId || seenFragmentIds.has(attrs.fragmentId)) {
        attrs.fragmentId = createId('fragment');
        nodeChanged = true;
      }
      seenFragmentIds.add(attrs.fragmentId);
    }
    if (node.type.name === 'tableRow') {
      if (typeof attrs.rowId !== 'string' || !attrs.rowId || seenRowIds.has(attrs.rowId)) {
        attrs.rowId = createId('row');
        nodeChanged = true;
      }
      seenRowIds.add(attrs.rowId);
    }
    if (nodeChanged) {
      transaction.setNodeMarkup(position, undefined, attrs, node.marks);
      changed = true;
    }
  });

  if (!changed) return false;
  markPaginationTransaction(view, transaction);
  view.dispatch(transaction);
  return true;
}

function paginateOnce(view: EditorView): boolean {
  if (ensureStructuralIdsOnce(view)) return true;
  if (mergeAdjacentTableFragmentsOnce(view)) return true;
  if (syncRepeatedHeaderOnce(view)) return true;
  if (paginateOverflowOnce(view)) return true;
  return backfillOnce(view);
}

export const Pagination = Extension.create({
  name: 'contractPagination',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading', 'bulletList', 'orderedList'],
        attributes: {
          blockId: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-block-id'),
            renderHTML: (attributes) => ({ 'data-block-id': attributes.blockId }),
          },
        },
      },
      {
        types: ['paragraph'],
        attributes: {
          flowId: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-flow-id'),
            renderHTML: (attributes) => ({ 'data-flow-id': attributes.flowId }),
          },
          continuation: {
            default: false,
            parseHTML: (element) => element.getAttribute('data-flow-continuation') === 'true',
            renderHTML: (attributes) => (
              attributes.continuation ? { 'data-flow-continuation': 'true' } : {}
            ),
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: PaginationPluginKey,
        appendTransaction: (transactions, oldState, newState) => {
          const hasUserDeletion = newState.doc.content.size < oldState.doc.content.size
            && transactions.some((transaction) => (
              transaction.docChanged && !transaction.getMeta(PAGINATION_META)
            ));
          if (!hasUserDeletion) return null;
          return removeEmptyAutomaticPage(newState, getSelectionPageId(oldState))
            || removeEmptyAutomaticPage(newState);
        },
        props: {
          handleKeyDown: (view, event) => {
            if (event.key !== 'Backspace' && event.key !== 'Delete') return false;
            const direction = event.key === 'Backspace' ? 'backward' : 'forward';
            const transaction = deleteAcrossAutomaticPageBoundary(view.state, direction)
              || (event.key === 'Backspace' ? removeEmptyAutomaticPage(view.state) : null);
            if (!transaction) return false;
            view.dispatch(transaction);
            return true;
          },
        },
        state: {
          init: (): { rootTransaction: Transaction | null } => ({ rootTransaction: null }),
          apply: (transaction, pluginState) => {
            if (!transaction.getMeta(PAGINATION_META) && transaction.docChanged) {
              return { rootTransaction: transaction };
            }
            return pluginState;
          },
        },
        view: (view) => {
          let animationFrame = 0;
          let cleanupTimer = 0;
          let destroyed = false;
          const scheduleCleanup = () => {
            window.clearTimeout(cleanupTimer);
            cleanupTimer = window.setTimeout(() => {
              cleanupTimer = 0;
              if (destroyed) return;
              if (paginateOnce(view)) {
                schedule();
                return;
              }
              if (removeStableEmptyAutomaticPageOnce(view)) schedule();
            }, 100);
          };
          const schedule = () => {
            window.cancelAnimationFrame(animationFrame);
            window.clearTimeout(cleanupTimer);
            animationFrame = window.requestAnimationFrame(() => {
              if (destroyed) return;
              if (view.composing) {
                schedule();
                return;
              }
              if (paginateOnce(view)) {
                schedule();
              } else {
                scheduleCleanup();
              }
            });
          };
          const handleResize = () => schedule();
          // React node views (for example signing fields) can finish rendering
          // after ProseMirror's initial view update. Their text changes the
          // measured height without producing an editor transaction, so a
          // transaction-only pagination trigger would leave the signing view
          // as one overflowing page. Observe rendered-content mutations and
          // run the same idempotent pagination loop once the node views settle.
          const contentObserver = new MutationObserver(() => schedule());
          contentObserver.observe(view.dom, { childList: true, characterData: true, subtree: true });
          window.addEventListener('resize', handleResize);
          document.fonts?.ready.then(schedule).catch(() => undefined);
          schedule();

          return {
            update: () => schedule(),
            destroy: () => {
              destroyed = true;
              window.cancelAnimationFrame(animationFrame);
              window.clearTimeout(cleanupTimer);
              contentObserver.disconnect();
              window.removeEventListener('resize', handleResize);
            },
          };
        },
      }),
    ];
  },
});
