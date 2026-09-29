import { mergeAttributes, Node } from '@tiptap/core';
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FieldType } from '../types';

type ResizeDirection =
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'nw';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Guides {
  x?: number;
  y?: number;
  page?: DOMRect;
}

const DIRECTIONS: ResizeDirection[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
const SNAP_DISTANCE = 6;

function getMinimumSize(type: FieldType): { width: number; height: number } {
  return type === 'signature' ? { width: 80, height: 40 } : { width: 60, height: 60 };
}

function getPageAtPoint(x: number, y: number): HTMLElement | null {
  const pages = Array.from(document.querySelectorAll<HTMLElement>('.contract-page'));
  return pages.find((page) => {
    const rect = page.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }) || null;
}

function getSafeAreaRect(page: HTMLElement): DOMRect {
  return page.querySelector<HTMLElement>('.contract-page__content')?.getBoundingClientRect()
    || page.getBoundingClientRect();
}

function snapValue(
  value: number,
  size: number,
  targets: number[],
): { value: number; guide?: number } {
  const points = [value, value + size / 2, value + size];
  let bestDistance = SNAP_DISTANCE + 1;
  let snapped = value;
  let guide: number | undefined;

  targets.forEach((target) => {
    points.forEach((point, index) => {
      const distance = Math.abs(point - target);
      if (distance <= SNAP_DISTANCE && distance < bestDistance) {
        bestDistance = distance;
        snapped = target - (index === 0 ? 0 : index === 1 ? size / 2 : size);
        guide = target;
      }
    });
  });

  return { value: snapped, guide };
}

function clampBox(box: Box, pageRect: DOMRect): Box {
  return {
    ...box,
    x: Math.min(pageRect.right - box.width, Math.max(pageRect.left, box.x)),
    y: Math.min(pageRect.bottom - box.height, Math.max(pageRect.top, box.y)),
  };
}

function clampIntegerOffset(value: number, minimum: number, maximum: number): number {
  const minimumInteger = Math.ceil(minimum);
  const maximumInteger = Math.floor(maximum);
  if (minimumInteger > maximumInteger) return Math.round((minimum + maximum) / 2);
  return Math.min(maximumInteger, Math.max(minimumInteger, Math.round(value)));
}

function FloatingFieldNodeView({ node, selected, updateAttributes, editor, getPos }: NodeViewProps) {
  const elementRef = useRef<HTMLSpanElement | null>(null);
  const [box, setBox] = useState<Box>({
    x: node.attrs.offsetX || 0,
    y: node.attrs.offsetY || 0,
    width: node.attrs.width,
    height: node.attrs.height,
  });
  const [guides, setGuides] = useState<Guides>({});

  useEffect(() => {
    setBox({
      x: node.attrs.offsetX || 0,
      y: node.attrs.offsetY || 0,
      width: node.attrs.width,
      height: node.attrs.height,
    });
  }, [node.attrs.height, node.attrs.offsetX, node.attrs.offsetY, node.attrs.width]);

  useLayoutEffect(() => {
    const element = elementRef.current;
    const page = element?.closest<HTMLElement>('.contract-page');
    const position = getPos();
    if (!element || !page || typeof position !== 'number') return;

    const pageRect = getSafeAreaRect(page);
    const elementRect = element.getBoundingClientRect();
    const minimum = getMinimumSize(node.attrs.fieldType);
    const width = Math.floor(Math.min(pageRect.width, Math.max(minimum.width, node.attrs.width)));
    const height = Math.floor(Math.min(pageRect.height, Math.max(minimum.height, node.attrs.height)));
    // The React node view can render one frame behind the latest node attrs.
    // Derive the anchor from the box currently on screen to avoid applying the
    // same boundary correction twice during that transition.
    const anchorLeft = elementRect.left - box.x;
    const anchorTop = elementRect.top - box.y;
    const offsetX = clampIntegerOffset(
      node.attrs.offsetX,
      pageRect.left - anchorLeft,
      pageRect.right - width - anchorLeft,
    );
    const offsetY = clampIntegerOffset(
      node.attrs.offsetY,
      pageRect.top - anchorTop,
      pageRect.bottom - height - anchorTop,
    );

    if (
      width === node.attrs.width &&
      height === node.attrs.height &&
      offsetX === node.attrs.offsetX &&
      offsetY === node.attrs.offsetY
    ) return;

    const currentNode = editor.state.doc.nodeAt(position);
    if (currentNode?.type.name !== 'floatingField') return;
    const transaction = editor.state.tr
      .setNodeMarkup(position, undefined, {
        ...currentNode.attrs,
        width,
        height,
        offsetX,
        offsetY,
      }, currentNode.marks)
      .setMeta('addToHistory', false);
    editor.view.dispatch(transaction);
  }, [editor, getPos, node.attrs.fieldType, node.attrs.height, node.attrs.offsetX, node.attrs.offsetY, node.attrs.width]);

  const selectNode = () => {
    const position = getPos();
    if (typeof position === 'number') {
      editor.commands.setNodeSelection(position);
    }
  };

  const startDrag = (event: React.PointerEvent<HTMLSpanElement>) => {
    if ((event.target as HTMLElement).dataset.resizeHandle) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    selectNode();

    const element = elementRef.current;
    const initialPage = element?.closest<HTMLElement>('.contract-page');
    if (!element || !initialPage) {
      return;
    }

    const startPointer = { x: event.clientX, y: event.clientY };
    const startRect = element.getBoundingClientRect();
    const startBox = { ...box };
    let latestAbsolute: Box = {
      x: startRect.left,
      y: startRect.top,
      width: startRect.width,
      height: startRect.height,
    };
    let latestLocal = startBox;
    let latestPage = initialPage;
    let hasMoved = false;

    const onMove = (moveEvent: PointerEvent) => {
      if (
        Math.abs(moveEvent.clientX - startPointer.x) < 2 &&
        Math.abs(moveEvent.clientY - startPointer.y) < 2
      ) {
        return;
      }
      hasMoved = true;
      const raw: Box = {
        ...latestAbsolute,
        x: startRect.left + moveEvent.clientX - startPointer.x,
        y: startRect.top + moveEvent.clientY - startPointer.y,
      };
      const centerX = raw.x + raw.width / 2;
      const centerY = raw.y + raw.height / 2;
      latestPage = getPageAtPoint(centerX, centerY) || latestPage;
      const pageRect = getSafeAreaRect(latestPage);
      const otherRects = Array.from(
        latestPage.querySelectorAll<HTMLElement>('.floating-field__box'),
      )
        .filter((item) => item !== element)
        .map((item) => item.getBoundingClientRect());
      const xTargets = [pageRect.left, pageRect.left + pageRect.width / 2, pageRect.right];
      const yTargets = [pageRect.top, pageRect.top + pageRect.height / 2, pageRect.bottom];
      otherRects.forEach((rect) => {
        xTargets.push(rect.left, rect.left + rect.width / 2, rect.right);
        yTargets.push(rect.top, rect.top + rect.height / 2, rect.bottom);
      });
      const snappedX = snapValue(raw.x, raw.width, xTargets);
      const snappedY = snapValue(raw.y, raw.height, yTargets);
      latestAbsolute = clampBox({ ...raw, x: snappedX.value, y: snappedY.value }, pageRect);

      latestLocal = {
        ...startBox,
        x: startBox.x + latestAbsolute.x - startRect.left,
        y: startBox.y + latestAbsolute.y - startRect.top,
      };
      setBox(latestLocal);
      setGuides({ x: snappedX.guide, y: snappedY.guide, page: pageRect });
    };

    const onEnd = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      setGuides({});

      if (!hasMoved) {
        return;
      }

      if (latestPage === initialPage) {
        updateAttributes({
          offsetX: Math.round(latestLocal.x),
          offsetY: Math.round(latestLocal.y),
        });
        return;
      }

      const oldPosition = getPos();
      if (typeof oldPosition !== 'number') {
        return;
      }

      const center = {
        left: latestAbsolute.x + latestAbsolute.width / 2,
        top: latestAbsolute.y + latestAbsolute.height / 2,
      };
      const targetPageId = latestPage.dataset.pageId;
      const coordinatePosition = editor.view.posAtCoords(center)?.pos;
      let targetPosition: number | null = null;

      if (typeof coordinatePosition === 'number') {
        const resolved = editor.state.doc.resolve(coordinatePosition);
        let resolvedPageId: string | null = null;
        for (let depth = resolved.depth; depth >= 0; depth -= 1) {
          if (resolved.node(depth).type.name === 'page') {
            resolvedPageId = resolved.node(depth).attrs.pageId;
            break;
          }
        }
        if (resolved.parent.inlineContent && resolvedPageId === targetPageId) {
          targetPosition = coordinatePosition;
        }
      }

      if (targetPosition === null && targetPageId) {
        editor.state.doc.descendants((candidate, candidatePosition) => {
          if (targetPosition !== null || candidate.type.name !== 'page' || candidate.attrs.pageId !== targetPageId) {
            return targetPosition === null;
          }
          candidate.descendants((child, relativePosition) => {
            if (targetPosition === null && child.inlineContent) {
              targetPosition = candidatePosition + relativePosition + 2;
              return false;
            }
            return targetPosition === null;
          });
          return false;
        });
      }

      if (targetPosition !== null) {
        const anchorRect = editor.view.coordsAtPos(targetPosition);
        const attrs = {
          ...node.attrs,
          offsetX: Math.round(latestAbsolute.x - anchorRect.left),
          offsetY: Math.round(latestAbsolute.y - anchorRect.top),
        };
        const transaction = editor.state.tr;
        transaction.delete(oldPosition, oldPosition + node.nodeSize);
        const mappedPosition = transaction.mapping.map(targetPosition);
        transaction.insert(mappedPosition, node.type.create(attrs));
        transaction.setSelection(NodeSelection.create(transaction.doc, mappedPosition));
        editor.view.dispatch(transaction.scrollIntoView());
        return;
      }

      updateAttributes({ offsetX: Math.round(latestLocal.x), offsetY: Math.round(latestLocal.y) });
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

    const startPointer = { x: event.clientX, y: event.clientY };
    const start = { ...box };
    const minimum = getMinimumSize(node.attrs.fieldType);
    const elementRect = elementRef.current?.getBoundingClientRect();
    const page = elementRef.current?.closest<HTMLElement>('.contract-page');
    const pageRect = page ? getSafeAreaRect(page) : null;
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

      if (elementRect && pageRect) {
        const absoluteLeft = elementRect.left + next.x - start.x;
        const absoluteTop = elementRect.top + next.y - start.y;
        if (absoluteLeft < pageRect.left) {
          next.width -= pageRect.left - absoluteLeft;
          next.x += pageRect.left - absoluteLeft;
        }
        if (absoluteTop < pageRect.top) {
          next.height -= pageRect.top - absoluteTop;
          next.y += pageRect.top - absoluteTop;
        }
        next.width = Math.max(
          minimum.width,
          Math.min(next.width, pageRect.right - Math.max(pageRect.left, absoluteLeft)),
        );
        next.height = Math.max(
          minimum.height,
          Math.min(next.height, pageRect.bottom - Math.max(pageRect.top, absoluteTop)),
        );
      }

      latest = next;
      setBox(next);
    };

    const onEnd = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      updateAttributes({
        width: Math.round(latest.width),
        height: Math.round(latest.height),
        offsetX: Math.round(latest.x),
        offsetY: Math.round(latest.y),
      });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>) => {
    const directions: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const direction = directions[event.key];
    if (!direction) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 10 : 1;
    const elementRect = elementRef.current?.getBoundingClientRect();
    const page = elementRef.current?.closest<HTMLElement>('.contract-page');
    const pageRect = page ? getSafeAreaRect(page) : null;
    let deltaX = direction.x * step;
    let deltaY = direction.y * step;
    if (elementRect && pageRect) {
      deltaX = Math.max(pageRect.left - elementRect.left, Math.min(deltaX, pageRect.right - elementRect.right));
      deltaY = Math.max(pageRect.top - elementRect.top, Math.min(deltaY, pageRect.bottom - elementRect.bottom));
    }
    updateAttributes({ offsetX: Math.round(box.x + deltaX), offsetY: Math.round(box.y + deltaY) });
  };

  return (
    <NodeViewWrapper
      as="span"
      className="floating-field__anchor"
      data-ref-id={node.attrs.refId}
      data-field-id={node.attrs.fieldId}
      contentEditable={false}
    >
      <span
        ref={elementRef}
        className={`floating-field__box${selected ? ' is-selected' : ''}`}
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
        <span className="floating-field__label">{node.attrs.fieldName}</span>
        {selected
          ? DIRECTIONS.map((direction) => (
              <span
                key={direction}
                className={`floating-field__handle floating-field__handle--${direction}`}
                data-resize-handle={direction}
                onPointerDown={(event) => startResize(direction, event)}
              />
            ))
          : null}
      </span>
      {typeof guides.x === 'number' && guides.page ? (
        <span
          className="snap-guide snap-guide--vertical"
          style={{ left: `${guides.x}px`, top: `${guides.page.top}px`, height: `${guides.page.height}px` }}
        />
      ) : null}
      {typeof guides.y === 'number' && guides.page ? (
        <span
          className="snap-guide snap-guide--horizontal"
          style={{ left: `${guides.page.left}px`, top: `${guides.y}px`, width: `${guides.page.width}px` }}
        />
      ) : null}
    </NodeViewWrapper>
  );
}

export const FloatingField = Node.create({
  name: 'floatingField',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      refId: { default: null },
      fieldId: { default: null },
      fieldType: { default: 'signature' },
      fieldName: { default: '签署区' },
      width: { default: 160 },
      height: { default: 80 },
      offsetX: { default: 12 },
      offsetY: { default: 12 },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-floating-field]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-floating-field': 'true',
        'data-ref-id': node.attrs.refId,
        'data-field-id': node.attrs.fieldId,
        'data-field-type': node.attrs.fieldType,
        'data-field-name': node.attrs.fieldName,
        'data-width': node.attrs.width,
        'data-height': node.attrs.height,
        'data-offset-x': node.attrs.offsetX,
        'data-offset-y': node.attrs.offsetY,
      }),
      node.attrs.fieldName,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FloatingFieldNodeView);
  },
});
