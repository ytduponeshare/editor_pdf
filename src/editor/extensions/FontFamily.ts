import { Mark, mergeAttributes } from '@tiptap/core';

export const FONT_FAMILY_OPTIONS = [
  { value: 'arial', label: 'Arial', css: 'Arial, sans-serif' },
  { value: 'pingfang', label: '苹方', css: '"PingFang SC", "Microsoft YaHei", sans-serif' },
  { value: 'yahei', label: '微软雅黑', css: '"Microsoft YaHei", "PingFang SC", sans-serif' },
  { value: 'simsun', label: '宋体', css: 'SimSun, "Songti SC", serif' },
  { value: 'simhei', label: '黑体', css: 'SimHei, "Heiti SC", sans-serif' },
  { value: 'kaiti', label: '楷体', css: 'KaiTi, "Kaiti SC", serif' },
] as const;

export type FontFamilyValue = typeof FONT_FAMILY_OPTIONS[number]['value'];

export function isAllowedFontFamily(value: unknown): value is FontFamilyValue {
  return FONT_FAMILY_OPTIONS.some((option) => option.value === value);
}

function parseFontFamily(value: string): FontFamilyValue | null {
  const primaryFamily = value.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '').toLowerCase();
  const aliases: Record<string, FontFamilyValue> = {
    arial: 'arial',
    'pingfang sc': 'pingfang',
    'microsoft yahei': 'yahei',
    simsun: 'simsun',
    'songti sc': 'simsun',
    simhei: 'simhei',
    'heiti sc': 'simhei',
    kaiti: 'kaiti',
    'kaiti sc': 'kaiti',
  };
  return aliases[primaryFamily] || null;
}

export function fontFamilyCss(value: unknown): string | null {
  return FONT_FAMILY_OPTIONS.find((option) => option.value === value)?.css || null;
}

export const FontFamily = Mark.create({
  name: 'fontFamily',

  addAttributes() {
    return {
      family: {
        default: null,
        parseHTML: (element) => parseFontFamily(element.style.fontFamily),
        renderHTML: (attributes) => {
          const css = fontFamilyCss(attributes.family);
          return css ? { style: `font-family: ${css}` } : {};
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[style*="font-family"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },
});
