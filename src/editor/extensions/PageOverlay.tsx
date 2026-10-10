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
import { SignatureChooser } from '../../components/SignatureChooser';
import { SealPicker } from '../../components/SealPicker';
import { useSigningContext } from '../../signing/context';
import { PAGINATION_META } from './Pagination';
import { moveSigningField } from '../commands';
import { migrateSigningAreas } from '../signingAreas';

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

function overlayContainer(element: HTMLElement | null): HTMLElement | null {
  return element?.closest<HTMLElement>('.signing-area__content, .contract-page__content') || null;
}

function overlayBounds(content: HTMLElement): DOMRect {
  const rect = content.getBoundingClientRect();
  const page = content.closest<HTMLElement>('.contract-page__content');
  return page && content !== page
    ? new DOMRect(rect.x, rect.y, rect.width, page.getBoundingClientRect().height - 32)
    : rect;
}

function migratePageOverlays(view: EditorView): boolean {
  let needed = false;
  view.state.doc.forEach(page => page.forEach(child => {
    if (['pageOverlay', 'layoutAnchor', 'signingArea'].includes(child.type.name)) needed = true;
  }));
  if (!needed) return false;
  const content = view.dom.querySelector<HTMLElement>('.contract-page__content');
  if (!content) return false;
  const migrated = migrateSigningAreas(view.state.doc.toJSON(), content.getBoundingClientRect().width);
  const doc = view.state.schema.nodeFromJSON(migrated);
  const transaction = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content);
  transaction.setMeta('addToHistory', false).setMeta(PAGINATION_META, true);
  view.dispatch(transaction); return true;
}

export function SigningFieldNodeView({ node }: Pick<NodeViewProps, 'node'>) {
  const signing = useSigningContext();
  const anchorRef = useRef<HTMLElement | null>(null);
  const inline = node.type.name === 'floatingField';
  const [offset, setOffset] = useState({ x: node.attrs.offsetX, y: node.attrs.offsetY });
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const content = anchor?.closest<HTMLElement>('.contract-page__content');
    if (!inline || !anchor || !content) return;
    const rect = anchor.getBoundingClientRect();
    const bounds = content.getBoundingClientRect();
    const x = Math.round(Math.max(bounds.left - rect.left, Math.min(node.attrs.offsetX, bounds.right - node.attrs.width - rect.left)));
    const y = Math.round(Math.max(bounds.top - rect.top, Math.min(node.attrs.offsetY, bounds.bottom - node.attrs.height - rect.top)));
    if (x !== offset.x || y !== offset.y) setOffset({ x, y });
  });
  if (!signing) return null;
  const field = signing.fields[node.attrs.fieldId];
  const editable = field?.roleId === signing.roleId && (field.type === 'signature' || field.type === 'companySeal');
  const BoxTag = inline ? 'span' : 'div';
  const completedSignature = signing.signatures[node.attrs.fieldId];
  const completedSeal = signing.seals[node.attrs.fieldId];
  return (
    <NodeViewWrapper
      as={inline ? 'span' : 'div'}
      className={inline ? 'floating-field__anchor signing-floating-field' : 'page-overlay signing-page-overlay'}
      ref={anchorRef}
      data-page-overlay={!inline || undefined}
      data-ref-id={node.attrs.refId}
      data-field-id={node.attrs.fieldId}
      contentEditable={false}
    >
      <BoxTag
        className={`page-overlay__box signing-page-overlay__box${signing.invalidFieldIds.has(node.attrs.fieldId) ? ' is-invalid' : ''}`}
        style={{ left: `${inline ? offset.x : node.attrs.x}px`, top: `${inline ? offset.y : node.attrs.y}px`, width: `${node.attrs.width}px`, height: `${node.attrs.height}px` }}
        role="group"
        aria-label={node.attrs.fieldName}
      >
        {editable && field?.type === 'signature' ? (
          <SignatureChooser
            userId={signing.userId}
            value={signing.signatures[field.id]}
            invalid={signing.invalidFieldIds.has(field.id)}
            onChange={value => signing.setSignature(field.id, value)}
          />
        ) : editable && field?.type === 'companySeal' ? (
          <SealPicker contractId={signing.contractId} userId={signing.userId} value={signing.seals[field.id]} invalid={signing.invalidFieldIds.has(field.id)} onChange={value => signing.setSeal(field.id, value)} />
        ) : completedSignature
          ? <img className="signing-page-overlay__signature" src={completedSignature} alt={`${node.attrs.fieldName}已签署`} />
          : completedSeal
            ? <img className="signing-page-overlay__signature" src={completedSeal} alt={`${node.attrs.fieldName}已盖章`} />
          : <span className="page-overlay__label">{node.attrs.fieldName}</span>}
      </BoxTag>
    </NodeViewWrapper>
  );
}

function PageOverlayNodeView(props: NodeViewProps) {
  const signing = useSigningContext();
  return signing ? <SigningFieldNodeView node={props.node} /> : <DesignPageOverlayNodeView {...props} />;
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
    const content = overlayContainer(elementRef.current);
    if (!content) return;
    const next = clampBox(
      {
        x: node.attrs.x,
        y: node.attrs.y,
        width: node.attrs.width,
        height: node.attrs.height,
      },
      overlayBounds(content),
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
    const initialContent = overlayContainer(element);
    if (!element || !initialContent) return;

    const startPointer = { x: event.clientX, y: event.clientY };
    const startRect = element.getBoundingClientRect();
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
      const initialBounds = initialContent.getBoundingClientRect();
      targetContent = centerX >= initialBounds.left && centerX <= initialBounds.right && centerY >= initialBounds.top && centerY <= initialBounds.bottom
        ? initialContent : getPageContentAtPoint(centerX, centerY) || targetContent;
      const targetRect = targetContent.getBoundingClientRect();
      const preview = clampBox({
        ...box,
        x: latestAbsolute.x - initialContent.getBoundingClientRect().left,
        y: latestAbsolute.y - initialContent.getBoundingClientRect().top,
      }, overlayBounds(initialContent), getMinimumSize(node.attrs.fieldType));

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

      const position = getPos();
      if (typeof position !== 'number') return;
      // Resolve the flow position underneath the preview, rather than the dragged node itself.
      const pointerEvents = element.style.pointerEvents;
      element.style.pointerEvents = 'none';
      try {
        moveSigningField(editor, position, { ...node.attrs, width: box.width, height: box.height }, {
          clientX: latestAbsolute.x, clientY: latestAbsolute.y,
        });
      } finally {
        element.style.pointerEvents = pointerEvents;
      }
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
    const content = overlayContainer(element);
    if (!element || !content) return;
    const bounds = overlayBounds(content);
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
    const content = overlayContainer(elementRef.current);
    if (!content) return;
    const step = event.shiftKey ? 10 : 1;
    const next = clampBox({
      ...box,
      x: box.x + direction.x * step,
      y: box.y + direction.y * step,
    }, content.getBoundingClientRect(), getMinimumSize(node.attrs.fieldType));
    updateAttributes({ x: Math.round(next.x), y: Math.round(next.y) });
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
      positionMode: { default: 'page', parseHTML: element => element.getAttribute('data-position-mode') || 'page', renderHTML: attributes => attributes.positionMode === 'anchor' ? { 'data-position-mode': 'anchor' } : {} },
      anchorId: { default: null, parseHTML: element => element.getAttribute('data-anchor-id'), renderHTML: attributes => attributes.positionMode === 'anchor' && attributes.anchorId ? { 'data-anchor-id': attributes.anchorId } : {} },
      anchorAlign: { default: 'left', parseHTML: element => element.getAttribute('data-anchor-align') || 'left', renderHTML: attributes => attributes.positionMode === 'anchor' ? { 'data-anchor-align': attributes.anchorAlign } : {} },
      anchorOffsetX: { default: 0, parseHTML: element => Number(element.getAttribute('data-anchor-offset-x')) || 0, renderHTML: attributes => attributes.positionMode === 'anchor' ? { 'data-anchor-offset-x': attributes.anchorOffsetX } : {} },
      anchorOffsetY: { default: 0, parseHTML: element => Number(element.getAttribute('data-anchor-offset-y')) || 0, renderHTML: attributes => attributes.positionMode === 'anchor' ? { 'data-anchor-offset-y': attributes.anchorOffsetY } : {} },
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
        ...(node.attrs.positionMode === 'anchor' ? {
          'data-position-mode': 'anchor', 'data-anchor-id': node.attrs.anchorId,
          'data-anchor-align': node.attrs.anchorAlign, 'data-anchor-offset-x': node.attrs.anchorOffsetX,
          'data-anchor-offset-y': node.attrs.anchorOffsetY,
        } : {}),
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PageOverlayNodeView);
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        view: (view) => {
          const run = () => {
            migratePageOverlays(view);
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
