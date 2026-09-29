import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  Plugin,
  Selection,
  TextSelection,
  type EditorState,
  type Transaction,
} from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { createId } from '../id';

interface TableLocation {
  node: ProseMirrorNode;
  position: number;
}

interface TableSelectionContext extends TableLocation {
  rowIndex: number;
}

function getLogicalTableLocations(documentNode: ProseMirrorNode, tableId: string): TableLocation[] {
  const locations: TableLocation[] = [];
  documentNode.descendants((node, position) => {
    if (node.type.name === 'table' && node.attrs.tableId === tableId) {
      locations.push({ node, position });
      return false;
    }
    return true;
  });
  return locations;
}

function getTableSelectionContext(state: EditorState): TableSelectionContext | null {
  const resolved = state.selection.$from;
  let tableDepth = -1;
  let rowDepth = -1;
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    const node = resolved.node(depth);
    if (rowDepth < 0 && node.type.name === 'tableRow') rowDepth = depth;
    if (node.type.name === 'table') {
      tableDepth = depth;
      break;
    }
  }
  if (tableDepth < 0 || rowDepth < 0) return null;
  return {
    node: resolved.node(tableDepth),
    position: resolved.before(tableDepth),
    rowIndex: resolved.index(tableDepth),
  };
}

function createParagraph(state: EditorState): ProseMirrorNode {
  return state.schema.nodes.paragraph.create({
    blockId: createId('block'),
    flowId: createId('flow'),
    continuation: false,
  });
}

function placeCursorAtBoundary(
  state: EditorState,
  position: number,
  side: 'before' | 'after',
): Transaction {
  const resolved = state.doc.resolve(position);
  const adjacent = side === 'before' ? resolved.nodeBefore : resolved.nodeAfter;
  if (adjacent?.isTextblock) {
    const cursorPosition = side === 'before' ? position - 1 : position + 1;
    return state.tr.setSelection(TextSelection.create(state.doc, cursorPosition)).scrollIntoView();
  }

  const transaction = state.tr.insert(position, createParagraph(state));
  transaction.setSelection(TextSelection.create(transaction.doc, position + 1));
  return transaction.scrollIntoView();
}

function insertParagraphFromWidget(view: EditorView, position: number): void {
  if (position < 0 || position > view.state.doc.content.size) return;
  view.dispatch(placeCursorAtBoundary(view.state, position, 'after'));
  view.focus();
}

function ensureClickedCellHasCursor(view: EditorView, event: MouseEvent): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const cell = target.closest('td, th');
  if (!(cell instanceof HTMLElement) || !view.dom.contains(cell)) return;
  if (cell.closest('[contenteditable="false"]')) return;

  queueMicrotask(() => {
    if (view.isDestroyed) return;
    const domSelection = window.getSelection();
    if (domSelection?.anchorNode && cell.contains(domSelection.anchorNode)) return;

    try {
      const position = view.posAtDOM(cell, 0);
      const selection = Selection.near(view.state.doc.resolve(position), 1);
      view.dispatch(view.state.tr.setSelection(selection));
      view.focus();
    } catch {
      // The table may have been repaginated between the click and this callback.
    }
  });
}

function createBoundaryWidget(side: 'before' | 'after') {
  return (view: EditorView, getPosition: () => number | undefined): HTMLElement => {
    const wrapper = document.createElement('span');
    wrapper.className = `table-boundary-cursor table-boundary-cursor--${side}`;
    wrapper.contentEditable = 'false';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'table-boundary-cursor__button';
    button.title = `在表格${side === 'before' ? '前' : '后'}插入段落`;
    button.setAttribute('aria-label', button.title);
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const position = getPosition();
      if (typeof position === 'number') insertParagraphFromWidget(view, position);
    });
    wrapper.appendChild(button);
    return wrapper;
  };
}

function createTableBoundaryDecorations(state: EditorState): DecorationSet {
  const tablesById = new Map<string, TableLocation[]>();
  state.doc.descendants((node, position) => {
    if (node.type.name !== 'table' || typeof node.attrs.tableId !== 'string') return true;
    const locations = tablesById.get(node.attrs.tableId) || [];
    locations.push({ node, position });
    tablesById.set(node.attrs.tableId, locations);
    return false;
  });

  const decorations: Decoration[] = [];
  tablesById.forEach((locations) => {
    const first = locations[0];
    const last = locations[locations.length - 1];
    const before = state.doc.resolve(first.position);
    if (!before.nodeBefore?.isTextblock) {
      decorations.push(Decoration.widget(first.position, createBoundaryWidget('before'), { side: -1 }));
    }
    const afterPosition = last.position + last.node.nodeSize;
    const after = state.doc.resolve(afterPosition);
    if (!after.nodeAfter?.isTextblock) {
      decorations.push(Decoration.widget(afterPosition, createBoundaryWidget('after'), { side: 1 }));
    }
  });
  return DecorationSet.create(state.doc, decorations);
}

export const TableBoundary = Extension.create({
  name: 'tableBoundary',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations: createTableBoundaryDecorations,
          handleDOMEvents: {
            click: (view, event) => {
              ensureClickedCellHasCursor(view, event);
              return false;
            },
          },
          handleKeyDown: (view, event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return false;
            const context = getTableSelectionContext(view.state);
            if (!context) return false;
            const locations = getLogicalTableLocations(view.state.doc, context.node.attrs.tableId);
            if (!locations.length) return false;

            if (
              event.key === 'ArrowUp'
              && context.position === locations[0].position
              && context.rowIndex === 0
              && view.endOfTextblock('up')
            ) {
              view.dispatch(placeCursorAtBoundary(view.state, locations[0].position, 'before'));
              return true;
            }

            const last = locations[locations.length - 1];
            if (
              event.key === 'ArrowDown'
              && context.position === last.position
              && context.rowIndex === context.node.childCount - 1
              && view.endOfTextblock('down')
            ) {
              view.dispatch(placeCursorAtBoundary(
                view.state,
                last.position + last.node.nodeSize,
                'after',
              ));
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});
