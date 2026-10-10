import { Node } from '@tiptap/core';
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FieldType } from '../types';
import { useSigningContext } from '../../signing/context';
import { SigningFieldNodeView } from './PageOverlay';

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

function FloatingFieldNodeView(props: NodeViewProps) {
  const signing = useSigningContext();
  return signing ? <SigningFieldNodeView node={props.node} /> : <DesignFloatingFieldNodeView {...props} />;
}

function DesignFloatingFieldNodeView({ node, selected, updateAttributes, editor, getPos }: NodeViewProps) {
  const elementRef = useRef<HTMLSpanElement | null>(null);
  const [box, setBox] = useState<Box>({
    x: node.attrs.offsetX || 0,
    y: node.attrs.offsetY || 0,
    width: node.attrs.width,
    height: node.attrs.height,
  });
  const [guides, setGuides] = useState<Guides>({});
  const [anchorDrop, setAnchorDrop] = useState<{ left: number; top: number; height: number } | null>(null);
  const [draggingAnchor, setDraggingAnchor] = useState(false);
  const stopAnchorDrag = useRef<(() => void) | null>(null);

  useEffect(() => () => stopAnchorDrag.current?.(), []);

  const startAnchorDrag = (event: React.PointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const element = elementRef.current;
    if (!element) return;
    const originalRect = element.getBoundingClientRect();
    let targetPosition: number | null = null;
    editor.view.dom.classList.add('is-dragging-signing-anchor');
    setDraggingAnchor(true);

    const onMove = (moveEvent: PointerEvent) => {
      const page = getPageAtPoint(moveEvent.clientX, moveEvent.clientY);
      const position = page ? editor.view.posAtCoords({ left: moveEvent.clientX, top: moveEvent.clientY })?.pos : undefined;
      targetPosition = null;
      if (typeof position === 'number') {
        const resolved = editor.state.doc.resolve(position);
        // Signing anchors are accepted by paragraphs and headings in exported templates.
        if (resolved.parent.type.name === 'paragraph' || resolved.parent.type.name === 'heading') {
          targetPosition = position;
          const coords = editor.view.coordsAtPos(position);
          setAnchorDrop({ left: coords.left, top: coords.top, height: coords.bottom - coords.top });
          return;
        }
      }
      setAnchorDrop(null);
    };
    const cleanup = () => {
      editor.view.dom.classList.remove('is-dragging-signing-anchor');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onEscape);
      stopAnchorDrag.current = null;
    };
    const onCancel = () => {
      cleanup();
      setDraggingAnchor(false);
      setAnchorDrop(null);
    };
    const onEscape = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault();
        onCancel();
      }
    };
    const onEnd = () => {
      onCancel();
      const oldPosition = getPos();
      if (targetPosition === null || typeof oldPosition !== 'number'
        || targetPosition === oldPosition || targetPosition === oldPosition + node.nodeSize) return;
      const currentNode = editor.state.doc.nodeAt(oldPosition);
      if (currentNode?.type.name !== 'floatingField') return;
      const coords = editor.view.coordsAtPos(targetPosition);
      const transaction = closeHistory(editor.state.tr);
      transaction.delete(oldPosition, oldPosition + currentNode.nodeSize);
      const mappedPosition = transaction.mapping.map(targetPosition);
      transaction.insert(mappedPosition, currentNode.type.create({
        ...currentNode.attrs,
        offsetX: Math.round(originalRect.left - coords.left),
        offsetY: Math.round(originalRect.top - coords.bottom),
      }, null, currentNode.marks));
      transaction.setSelection(NodeSelection.create(transaction.doc, mappedPosition));
      editor.view.dispatch(transaction);
    };
    stopAnchorDrag.current = cleanup;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onEscape);
  };

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
    if (selected) return;
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
      latestPage = initialPage;
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

      updateAttributes({
        offsetX: Math.round(latestLocal.x),
        offsetY: Math.round(latestLocal.y),
      });
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
      className={`floating-field__anchor${selected ? ' is-selected' : ''}${draggingAnchor ? ' is-dragging-anchor' : ''}`}
      data-ref-id={node.attrs.refId}
      data-field-id={node.attrs.fieldId}
      contentEditable={false}
    >
      {selected ? (
        <>
          <svg className="floating-field__anchor-line" aria-hidden="true">
            <line x1="0" y1="0" x2={box.x + box.width / 2} y2={box.y + box.height / 2} />
          </svg>
          <span
            className="floating-field__anchor-handle"
            role="button"
            aria-label={`移动 ${node.attrs.fieldName} 的正文锚点`}
            title="拖动锚点以重新绑定正文；控件尽量保持原位"
            onPointerDown={startAnchorDrag}
          >⚓</span>
        </>
      ) : null}
      {anchorDrop ? <span className="floating-field__anchor-drop" style={{ left: anchorDrop.left, top: anchorDrop.top, height: anchorDrop.height }} /> : null}
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
      refId: { default: null, parseHTML: element => element.getAttribute('data-ref-id') },
      fieldId: { default: null, parseHTML: element => element.getAttribute('data-field-id') },
      fieldType: { default: 'signature', parseHTML: element => element.getAttribute('data-field-type') },
      fieldName: { default: '签署区', parseHTML: element => element.getAttribute('data-field-name') },
      width: { default: 160, parseHTML: element => Number(element.getAttribute('data-width')) || 160 },
      height: { default: 80, parseHTML: element => Number(element.getAttribute('data-height')) || 80 },
      offsetX: { default: 12, parseHTML: element => Number(element.getAttribute('data-x') ?? element.getAttribute('data-offset-x')) || 0 },
      offsetY: { default: 12, parseHTML: element => Number(element.getAttribute('data-y') ?? element.getAttribute('data-offset-y')) || 0 },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-contract-overlay][data-position-mode="inline"]' }, { tag: 'span[data-floating-field]' }];
  },

  renderHTML({ node }) {
    return ['span', {
      'data-contract-overlay': 'true',
      'data-position-mode': 'inline',
      'data-ref-id': node.attrs.refId,
      'data-field-id': node.attrs.fieldId,
      'data-field-type': node.attrs.fieldType,
      'data-field-name': node.attrs.fieldName,
      'data-width': node.attrs.width,
      'data-height': node.attrs.height,
      'data-x': node.attrs.offsetX,
      'data-y': node.attrs.offsetY,
    }, node.attrs.fieldName];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FloatingFieldNodeView);
  },
});
