import { Mark, mergeAttributes } from '@tiptap/core';

export const FONT_SIZE_OPTIONS = [12, 14, 16, 18, 20, 24, 28, 32] as const;

export function isAllowedFontSize(value: unknown): value is number {
  const size = Number(value);
  return FONT_SIZE_OPTIONS.some((option) => option === size);
}

export const FontSize = Mark.create({
  name: 'fontSize',

  addAttributes() {
    return {
      size: {
        default: null,
        parseHTML: (element) => {
          const parsed = Number.parseInt(element.style.fontSize, 10);
          return isAllowedFontSize(parsed) ? parsed : null;
        },
        renderHTML: (attributes) => (
          isAllowedFontSize(attributes.size)
            ? { style: `font-size: ${attributes.size}px` }
            : {}
        ),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[style*="font-size"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },
});
