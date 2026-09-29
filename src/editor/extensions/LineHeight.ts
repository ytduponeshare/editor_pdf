import { Extension } from '@tiptap/core';

export const LINE_HEIGHT_PRESETS = [1, 1.5] as const;
export const MIN_LINE_HEIGHT = 0.8;
export const MAX_LINE_HEIGHT = 3;

export function normalizeLineHeight(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < MIN_LINE_HEIGHT || parsed > MAX_LINE_HEIGHT) return null;
  return Math.round(parsed * 100) / 100;
}

export const LineHeight = Extension.create({
  name: 'lineHeight',

  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        lineHeight: {
          default: null,
          parseHTML: (element) => normalizeLineHeight(element.style.lineHeight),
          renderHTML: (attributes) => {
            const lineHeight = normalizeLineHeight(attributes.lineHeight);
            return lineHeight ? { style: `line-height: ${lineHeight}` } : {};
          },
        },
      },
    }];
  },
});
