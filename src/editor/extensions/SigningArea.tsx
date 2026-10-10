import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export function signingAreaHeight(node: ProseMirrorNode): number {
  let height = Math.max(40, Number(node.attrs.minHeight) || 0);
  node.forEach(child => { height = Math.max(height, Number(child.attrs.y) + Number(child.attrs.height) + 12); });
  return height;
}

function SigningAreaView({ node, editor, selected }: NodeViewProps) {
  return <NodeViewWrapper
    className={`signing-area${selected ? ' is-selected' : ''}${editor.isEditable ? '' : ' is-runtime'}`}
    data-signing-area="true"
    data-area-id={node.attrs.areaId}
    style={{ height: `${signingAreaHeight(node)}px` }}
  >
    {editor.isEditable ? <span className="signing-area__label" contentEditable={false}>签署区域 · 随正文移动</span> : null}
    <NodeViewContent className="signing-area__content" />
  </NodeViewWrapper>;
}

export const SigningArea = Node.create({
  name: 'signingArea',
  group: 'block',
  content: 'pageOverlay*',
  isolating: true,
  defining: true,
  addAttributes() {
    return {
      areaId: { default: null, parseHTML: element => element.getAttribute('data-area-id'), renderHTML: attributes => ({ 'data-area-id': attributes.areaId }) },
      minHeight: { default: 40, parseHTML: element => Number(element.getAttribute('data-min-height')) || 40, renderHTML: attributes => ({ 'data-min-height': attributes.minHeight }) },
    };
  },
  parseHTML() { return [{ tag: 'div[data-signing-area]' }]; },
  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-signing-area': 'true',
      class: 'pdf-signing-area',
      style: `height:${signingAreaHeight(node)}px`,
    }), 0];
  },
  addNodeView() { return ReactNodeViewRenderer(SigningAreaView); },
});
