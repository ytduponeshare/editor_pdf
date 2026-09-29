import { Mark, mergeAttributes } from '@tiptap/core';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SHORT_HEX_COLOR = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const RGB_COLOR = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i;

export function normalizeTextColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const color = value.trim().toLowerCase();
  if (HEX_COLOR.test(color)) return color;
  const shortHex = color.match(SHORT_HEX_COLOR);
  if (shortHex) return `#${shortHex[1]}${shortHex[1]}${shortHex[2]}${shortHex[2]}${shortHex[3]}${shortHex[3]}`;
  const rgb = color.match(RGB_COLOR);
  if (!rgb) return null;
  const channels = rgb.slice(1, 4).map(Number);
  if (channels.some((channel) => channel > 255)) return null;
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export const TextColor = Mark.create({
  name: 'textColor',

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => normalizeTextColor(element.style.color),
        renderHTML: (attributes) => {
          const color = normalizeTextColor(attributes.color);
          return color ? { style: `color: ${color}` } : {};
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[style*="color"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },
});
