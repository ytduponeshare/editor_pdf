import { mergeAttributes, Node } from '@tiptap/core';
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, NodeSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FieldType } from '../types';
import { PAGINATION_META } from './Pagination';

type ResizeDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DIRECTIONS: ResizeDirection[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

function getMinimumSize(type: FieldType): { width: number; height: number } {
  return type === 'signature' ? { width: 80, height: 40 } : { width: 60, height: 60 };
}

function clampBox(
  box: Box,
  bounds: DOMRect,
  minimum: { width: number; height: number },
): Box {
  const width = Math.min(bounds.width, Math.max(minimum.width, box.width));
  const height = Math.min(bounds.height, Math.max(minimum.height, box.height));
  return {
    width,
    height,
    x: Math.min(bounds.width - width, Math.max(0, box.x)),
    y: Math.min(bounds.height - height, Math.max(0, box.y)),
  };
}

function getPageContentAtPoint(x: number, y: number): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>('.contract-page__content'))
    .find((content) => {
      const rect = content.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }) || null;
}

function findPagePositionById(
  editor: NodeViewProps['editor'],
  pageId: string,
): { position: number; nodeSize: number } | null {
  let result: { position: number; nodeSize: number } | null = null;
  editor.state.doc.forEach((page, position) => {
    if (page.type.name === 'page' && page.attrs.pageId === pageId) {
      result = { position, nodeSize: page.nodeSize };
    }
  });
  return result;
}

function findPageInDocument(
  documentNode: ProseMirrorNode,
  pageId: string,
): { position: number; node: ProseMirrorNode } | null {
  let result: { position: number; node: ProseMirrorNode } | null = null;
  documentNode.forEach((node, position) => {
    if (node.type.name === 'page' && node.attrs.pageId === pageId) {
      result = { position, node };
    }
  });
  return result;
}

function owningPageId(documentNode: ProseMirrorNode, position: number): string | null {
  const resolved = documentNode.resolve(position);
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    const node = resolved.node(depth);
    if (node.type.name === 'page') return String(node.attrs.pageId || '');
  }
  return null;
}

function syncAnchoredOverlay(view: EditorView): boolean {
  const anchors = new Map<string, { position: number; pageId: string }>();
  const overlays: Array<{ position: number; node: ProseMirrorNode; pageId: string }> = [];
  view.state.doc.descendants((node, position) => {
    const pageId = owningPageId(view.state.doc, position) || '';
    if (node.type.name === 'layoutAnchor' && typeof node.attrs.anchorId === 'string') {
      anchors.set(node.attrs.anchorId, { position, pageId });
    }
    if (node.type.name === 'pageOverlay' && node.attrs.positionMode === 'anchor') {
      overlays.push({ position, node, pageId });
    }
  });

  for (const overlay of overlays) {
    const anchor = anchors.get(String(overlay.node.attrs.anchorId || ''));
    if (!anchor) continue;
    const anchorDom = view.nodeDOM(anchor.position);
    const anchorElement = anchorDom instanceof HTMLElement
      ? (anchorDom.matches('[data-contract-anchor]') ? anchorDom : anchorDom.querySelector<HTMLElement>('[data-contract-anchor]'))
      : null;
    const targetContent = anchorElement?.closest<HTMLElement>('.contract-page__content');
    if (!anchorElement || !targetContent) continue;
    const contentRect = targetContent.getBoundingClientRect();
    const anchorRect = anchorElement.getBoundingClientRect();
    const width = Number(overlay.node.attrs.width) || 160;
    const align = String(overlay.node.attrs.anchorAlign || 'left');
    const baseX = align === 'center'
      ? (contentRect.width - width) / 2
      : align === 'right' ? contentRect.width - width : 0;
    const nextX = Math.round(Math.max(0, Math.min(contentRect.width - width, baseX + (Number(overlay.node.attrs.anchorOffsetX) || 0))));
    const nextY = Math.round(Math.max(0, Math.min(contentRect.height - Number(overlay.node.attrs.height), anchorRect.top - contentRect.top + (Number(overlay.node.attrs.anchorOffsetY) || 0))));
    const nextAttrs = { ...overlay.node.attrs, x: nextX, y: nextY };

    if (overlay.pageId !== anchor.pageId) {
      let transaction = view.state.tr.delete(overlay.position, overlay.position + overlay.node.nodeSize);
      const target = findPageInDocument(transaction.doc, anchor.pageId);
      if (!target) continue;
      const insertionPosition = target.position + target.node.nodeSize - 1;
      transaction = transaction.insert(insertionPosition, overlay.node.type.create(nextAttrs));
      if (view.state.selection instanceof NodeSelection && view.state.selection.node.attrs.refId === overlay.node.attrs.refId) {
        transaction.setSelection(NodeSelection.create(transaction.doc, insertionPosition));
      }
      transaction.setMeta('addToHistory', false);
      transaction.setMeta(PAGINATION_META, true);
      view.dispatch(transaction);
      return true;
    }

    if (overlay.node.attrs.x !== nextX || overlay.node.attrs.y !== nextY) {
      const transaction = view.state.tr.setNodeMarkup(overlay.position, undefined, nextAttrs, overlay.node.marks);
      transaction.setMeta('addToHistory', false);
      transaction.setMeta(PAGINATION_META, true);
      view.dispatch(transaction);
      return true;
    }
  }
  return false;
}

function DesignPageOverlayNodeView({
  node,
  selected,
  updateAttributes,
  editor,
  getPos,
}: NodeViewProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<Box>({
    x: node.attrs.x,
    y: node.attrs.y,
    width: node.attrs.width,
    height: node.attrs.height,
  });

  useEffect(() => {
    setBox({
      x: node.attrs.x,
      y: node.attrs.y,
      width: node.attrs.width,
      height: node.attrs.height,
    });
  }, [node.attrs.height, node.attrs.width, node.attrs.x, node.attrs.y]);

  useLayoutEffect(() => {
    const content = elementRef.current?.closest<HTMLElement>('.contract-page__content');
    if (!content) return;
    const next = clampBox(
      {
        x: node.attrs.x,
        y: node.attrs.y,
        width: node.attrs.width,
        height: node.attrs.height,
      },
      content.getBoundingClientRect(),
      getMinimumSize(node.attrs.fieldType),
    );
    if (
      Math.round(next.x) === node.attrs.x
      && Math.round(next.y) === node.attrs.y
      && Math.round(next.width) === node.attrs.width
      && Math.round(next.height) === node.attrs.height
    ) return;
    updateAttributes({
      x: Math.round(next.x),
      y: Math.round(next.y),
      width: Math.round(next.width),
      height: Math.round(next.height),
    });
  }, [
    node.attrs.fieldType,
    node.attrs.height,
    node.attrs.width,
    node.attrs.x,
    node.attrs.y,
    updateAttributes,
  ]);

  const selectNode = () => {
    const position = getPos();
    if (typeof position === 'number') editor.commands.setNodeSelection(position);
  };

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).dataset.resizeHandle) return;
    event.preventDefault();
    event.stopPropagation();
    selectNode();

    const element = elementRef.current;
    const initialContent = element?.closest<HTMLElement>('.contract-page__content');
    if (!element || !initialContent) return;

    const startPointer = { x: event.clientX, y: event.clientY };
    const startRect = element.getBoundingClientRect();
    const initialPageId = initialContent.closest<HTMLElement>('.contract-page')?.dataset.pageId;
    let targetContent = initialContent;
    let latestAbsolute = { x: startRect.left, y: startRect.top };
    let moved = false;

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startPointer.x;
      const dy = moveEvent.clientY - startPointer.y;
      if (!moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
      moved = true;

      latestAbsolute = { x: startRect.left + dx, y: startRect.top + dy };
      const centerX = latestAbsolute.x + box.width / 2;
      const centerY = latestAbsolute.y + box.height / 2;
      targetContent = getPageContentAtPoint(centerX, centerY) || targetContent;
      const targetRect = targetContent.getBoundingClientRect();
      const preview = clampBox({
        ...box,
        x: latestAbsolute.x - initialContent.getBoundingClientRect().left,
        y: latestAbsolute.y - initialContent.getBoundingClientRect().top,
      }, initialContent.getBoundingClientRect(), getMinimumSize(node.attrs.fieldType));

      if (targetContent === initialContent) {
        setBox(preview);
      } else {
        setBox({
          ...box,
          x: latestAbsolute.x - initialContent.getBoundingClientRect().left,
          y: latestAbsolute.y - initialContent.getBoundingClientRect().top,
        });
      }

      if (targetRect.width === 0 || targetRect.height === 0) targetContent = initialContent;
    };

    const onEnd = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      if (!moved) return;

      const targetPage = targetContent.closest<HTMLElement>('.contract-page');
      const targetPageId = targetPage?.dataset.pageId;
      const targetRect = targetContent.getBoundingClientRect();
      const next = clampBox({
        ...box,
        x: latestAbsolute.x - targetRect.left,
        y: latestAbsolute.y - targetRect.top,
      }, targetRect, getMinimumSize(node.attrs.fieldType));

      if (node.attrs.positionMode === 'anchor' && node.attrs.anchorId) {
        const anchorElement = document.querySelector<HTMLElement>(`[data-contract-anchor][data-anchor-id="${CSS.escape(String(node.attrs.anchorId))}"]`);
        const anchorContent = anchorElement?.closest<HTMLElement>('.contract-page__content');
        if (anchorElement && anchorContent) {
          const contentRect = anchorContent.getBoundingClientRect();
          const anchorRect = anchorElement.getBoundingClientRect();
          const localX = latestAbsolute.x - contentRect.left;
          const localY = latestAbsolute.y - contentRect.top;
          const baseX = node.attrs.anchorAlign === 'center'
            ? (contentRect.width - box.width) / 2
            : node.attrs.anchorAlign === 'right' ? contentRect.width - box.width : 0;
          updateAttributes({
            anchorOffsetX: Math.round(localX - baseX),
            anchorOffsetY: Math.max(0, Math.round(localY - (anchorRect.top - contentRect.top))),
          });
          return;
        }
      }

      if (!targetPageId || targetPageId === initialPageId) {
        updateAttributes({
          x: Math.round(next.x),
          y: Math.round(next.y),
        });
        return;
      }

      const oldPosition = getPos();
      const target = findPagePositionById(editor, targetPageId);
      if (typeof oldPosition !== 'number' || !target) return;

      const transaction = editor.state.tr.delete(oldPosition, oldPosition + node.nodeSize);
      const mappedPagePosition = transaction.mapping.map(target.position);
      const targetPageNode = transaction.doc.nodeAt(mappedPagePosition);
      if (!targetPageNode || targetPageNode.type.name !== 'page') return;
      const insertionPosition = mappedPagePosition + targetPageNode.nodeSize - 1;
      const movedNode = node.type.create({
        ...node.attrs,
        x: Math.round(next.x),
        y: Math.round(next.y),
      });
      transaction.insert(insertionPosition, movedNode);
      transaction.setSelection(NodeSelection.create(transaction.doc, insertionPosition));
      editor.view.dispatch(transaction);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  };

  const startResize = (
    direction: ResizeDirection,
    event: React.PointerEvent<HTMLSpanElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    selectNode();

    const element = elementRef.current;
    const content = element?.closest<HTMLElement>('.contract-page__content');
    if (!element || !content) return;
    const bounds = content.getBoundingClientRect();
    const startPointer = { x: event.clientX, y: event.clientY };
    const start = { ...box };
    const minimum = getMinimumSize(node.attrs.fieldType);
    let latest = start;

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startPointer.x;
      const dy = moveEvent.clientY - startPointer.y;
      let next = { ...start };
      if (direction.includes('e')) next.width = Math.max(minimum.width, start.width + dx);
      if (direction.includes('s')) next.height = Math.max(minimum.height, start.height + dy);
      if (direction.includes('w')) {
        next.width = Math.max(minimum.width, start.width - dx);
        next.x = start.x + start.width - next.width;
      }
      if (direction.includes('n')) {
        next.height = Math.max(minimum.height, start.height - dy);
        next.y = start.y + start.height - next.height;
      }
      latest = clampBox(next, bounds, minimum);
      setBox(latest);
    };

    const onEnd = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      updateAttributes({
        x: Math.round(latest.x),
        y: Math.round(latest.y),
        width: Math.round(latest.width),
        height: Math.round(latest.height),
      });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const directions: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    const content = elementRef.current?.closest<HTMLElement>('.contract-page__content');
    if (!content) return;
    const step = event.shiftKey ? 10 : 1;
    const next = clampBox({
      ...box,
      x: box.x + direction.x * step,
      y: box.y + direction.y * step,
    }, content.getBoundingClientRect(), getMinimumSize(node.attrs.fieldType));
    if (node.attrs.positionMode === 'anchor') {
      updateAttributes({
        anchorOffsetX: Math.round((Number(node.attrs.anchorOffsetX) || 0) + direction.x * step),
        anchorOffsetY: Math.max(0, Math.round((Number(node.attrs.anchorOffsetY) || 0) + direction.y * step)),
      });
    } else {
      updateAttributes({ x: Math.round(next.x), y: Math.round(next.y) });
    }
  };

  return (
    <NodeViewWrapper
      as="div"
      className="page-overlay"
      data-page-overlay
      data-ref-id={node.attrs.refId}
      data-field-id={node.attrs.fieldId}
      contentEditable={false}
    >
      <div
        ref={elementRef}
        className={`page-overlay__box${selected ? ' is-selected' : ''}`}
        style={{
          left: `${box.x}px`,
          top: `${box.y}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
        }}
        tabIndex={0}
        role="button"
        aria-label={node.attrs.fieldName}
        onPointerDown={startDrag}
        onKeyDown={onKeyDown}
      >
        <span className="page-overlay__label">{node.attrs.fieldName}</span>
        {selected
          ? DIRECTIONS.map((direction) => (
              <span
                key={direction}
                className={`page-overlay__handle page-overlay__handle--${direction}`}
                data-resize-handle={direction}
                onPointerDown={(event) => startResize(direction, event)}
              />
            ))
          : null}
      </div>
    </NodeViewWrapper>
  );
}

function migrateLegacyFloatingFields(view: EditorView): boolean {
  const legacy: Array<{
    position: number;
    node: ProseMirrorNode;
    pageId: string;
    x: number;
    y: number;
  }> = [];

  view.state.doc.descendants((node, position) => {
    if (node.type.name !== 'floatingField') return;
    const resolved = view.state.doc.resolve(position);
    let pageId = '';
    for (let depth = resolved.depth; depth > 0; depth -= 1) {
      if (resolved.node(depth).type.name === 'page') {
        pageId = resolved.node(depth).attrs.pageId;
        break;
      }
    }
    const dom = view.nodeDOM(position);
    const wrapper = dom instanceof HTMLElement ? dom : dom?.parentElement;
    const box = wrapper?.querySelector<HTMLElement>('.floating-field__box');
    const content = wrapper?.closest<HTMLElement>('.contract-page__content');
    if (!pageId || !box || !content) return;
    const boxRect = box.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    legacy.push({
      position,
      node,
      pageId,
      x: boxRect.left - contentRect.left,
      y: boxRect.top - contentRect.top,
    });
  });
  if (!legacy.length) return false;

  const transaction = view.state.tr;
  legacy.slice().sort((left, right) => right.position - left.position)
    .forEach(({ position, node }) => transaction.delete(position, position + node.nodeSize));

  let selectedPosition: number | null = null;
  legacy.forEach(({ node, pageId, x, y }) => {
    const page = findPageInDocument(transaction.doc, pageId);
    if (!page) return;
    const overlayType = transaction.doc.type.schema.nodes.pageOverlay;
    const overlay = overlayType.create({
      ...node.attrs,
      x: Math.round(x),
      y: Math.round(y),
    });
    const insertionPosition = page.position + page.node.nodeSize - 1;
    transaction.insert(insertionPosition, overlay);
    selectedPosition = insertionPosition;
  });

  if (selectedPosition !== null) {
    transaction.setSelection(NodeSelection.create(transaction.doc, selectedPosition));
  }
  transaction.setMeta('addToHistory', false);
  view.dispatch(transaction);
  return true;
}

export const PageOverlay = Node.create({
  name: 'pageOverlay',
  group: 'pageOverlay',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      refId: { default: null, parseHTML: element => element.getAttribute('data-ref-id'), renderHTML: attributes => ({ 'data-ref-id': attributes.refId }) },
      fieldId: { default: null, parseHTML: element => element.getAttribute('data-field-id'), renderHTML: attributes => ({ 'data-field-id': attributes.fieldId }) },
      fieldType: { default: 'signature', parseHTML: element => element.getAttribute('data-field-type') || 'signature', renderHTML: attributes => ({ 'data-field-type': attributes.fieldType }) },
      fieldName: { default: '签署区', parseHTML: element => element.getAttribute('data-field-name') || '签署区', renderHTML: attributes => ({ 'data-field-name': attributes.fieldName }) },
      width: { default: 160, parseHTML: element => Number(element.getAttribute('data-width')) || 160, renderHTML: attributes => ({ 'data-width': attributes.width }) },
      height: { default: 80, parseHTML: element => Number(element.getAttribute('data-height')) || 80, renderHTML: attributes => ({ 'data-height': attributes.height }) },
      x: { default: 12, parseHTML: element => Number(element.getAttribute('data-x')) || 0, renderHTML: attributes => ({ 'data-x': attributes.x }) },
      y: { default: 12, parseHTML: element => Number(element.getAttribute('data-y')) || 0, renderHTML: attributes => ({ 'data-y': attributes.y }) },
      positionMode: { default: 'page', parseHTML: element => element.getAttribute('data-position-mode') || 'page', renderHTML: attributes => ({ 'data-position-mode': attributes.positionMode }) },
      anchorId: { default: null, parseHTML: element => element.getAttribute('data-anchor-id'), renderHTML: attributes => attributes.anchorId ? ({ 'data-anchor-id': attributes.anchorId }) : {} },
      anchorAlign: { default: 'left', parseHTML: element => element.getAttribute('data-anchor-align') || 'left', renderHTML: attributes => ({ 'data-anchor-align': attributes.anchorAlign }) },
      anchorOffsetX: { default: 0, parseHTML: element => Number(element.getAttribute('data-anchor-offset-x')) || 0, renderHTML: attributes => ({ 'data-anchor-offset-x': attributes.anchorOffsetX }) },
      anchorOffsetY: { default: 0, parseHTML: element => Number(element.getAttribute('data-anchor-offset-y')) || 0, renderHTML: attributes => ({ 'data-anchor-offset-y': attributes.anchorOffsetY }) },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-page-overlay]' }, { tag: 'div[data-contract-overlay]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-page-overlay': 'true',
        'data-ref-id': node.attrs.refId,
        'data-field-id': node.attrs.fieldId,
        'data-field-type': node.attrs.fieldType,
        'data-field-name': node.attrs.fieldName,
        'data-width': node.attrs.width,
        'data-height': node.attrs.height,
        'data-x': node.attrs.x,
        'data-y': node.attrs.y,
        'data-position-mode': node.attrs.positionMode,
        ...(node.attrs.anchorId ? { 'data-anchor-id': node.attrs.anchorId } : {}),
        'data-anchor-align': node.attrs.anchorAlign,
        'data-anchor-offset-x': node.attrs.anchorOffsetX,
        'data-anchor-offset-y': node.attrs.anchorOffsetY,
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DesignPageOverlayNodeView);
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        view: (view) => {
          const run = () => {
            if (!migrateLegacyFloatingFields(view)) syncAnchoredOverlay(view);
          };
          let frame = window.requestAnimationFrame(run);
          return {
            update: () => {
              window.cancelAnimationFrame(frame);
              frame = window.requestAnimationFrame(run);
            },
            destroy: () => window.cancelAnimationFrame(frame),
          };
        },
      }),
    ];
  },
});
