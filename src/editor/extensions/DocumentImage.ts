import { Node, mergeAttributes } from '@tiptap/core';

// Word images are embedded assets; remote URLs are never part of a template.
export function isDocumentImageSource(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 2_800_000
    && /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

export const DocumentImage = Node.create({
  name: 'documentImage',
  inline: true,
  group: 'inline',
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: null }, alt: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'img[src]', getAttrs: element => (
      isDocumentImageSource(element.getAttribute('src')) ? {} : false
    ) }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes, { class: 'contract-document-image' })];
  },
});
