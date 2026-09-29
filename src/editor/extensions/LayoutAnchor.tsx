import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';

export const MIN_ANCHOR_HEIGHT = 40;
export const MAX_ANCHOR_HEIGHT = 900;

function normalizeHeight(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 140;
  return Math.min(MAX_ANCHOR_HEIGHT, Math.max(MIN_ANCHOR_HEIGHT, Math.round(parsed)));
}

function LayoutAnchorNodeView({ node, selected, editor }: NodeViewProps) {
  const height = normalizeHeight(node.attrs.reservedHeight);
  return (
    <NodeViewWrapper
      as="div"
      className={`layout-anchor${selected ? ' is-selected' : ''}${editor.isEditable ? '' : ' is-runtime'}`}
      data-contract-anchor
      data-anchor-id={node.attrs.anchorId}
      data-anchor-name={node.attrs.anchorName}
      data-reserved-height={height}
      style={{ height: `${height}px` }}
      contentEditable={false}
    >
      {editor.isEditable ? <span>锚点：{node.attrs.anchorName}</span> : null}
    </NodeViewWrapper>
  );
}

export const LayoutAnchor = Node.create({
  name: 'layoutAnchor',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      anchorId: {
        default: null,
        parseHTML: element => element.getAttribute('data-anchor-id'),
        renderHTML: attributes => ({ 'data-anchor-id': attributes.anchorId }),
      },
      anchorName: {
        default: '签署区域',
        parseHTML: element => element.getAttribute('data-anchor-name') || '签署区域',
        renderHTML: attributes => ({ 'data-anchor-name': attributes.anchorName }),
      },
      reservedHeight: {
        default: 140,
        parseHTML: element => normalizeHeight(element.getAttribute('data-reserved-height')),
        renderHTML: attributes => ({ 'data-reserved-height': normalizeHeight(attributes.reservedHeight) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-contract-anchor]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const height = normalizeHeight(node.attrs.reservedHeight);
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        class: 'pdf-layout-anchor',
        'data-contract-anchor': 'true',
        'data-anchor-id': node.attrs.anchorId,
        'data-anchor-name': node.attrs.anchorName,
        'data-reserved-height': height,
        style: `height: ${height}px`,
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LayoutAnchorNodeView);
  },
});
