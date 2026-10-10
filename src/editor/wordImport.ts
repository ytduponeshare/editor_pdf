import DOMPurify from 'dompurify';
import { readWordSections } from './wordSections';
import { generateJSON, type JSONContent } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import { createEditorExtensions } from './extensions';
import { FONT_FAMILY_OPTIONS } from './extensions/FontFamily';
import { FONT_SIZE_OPTIONS } from './extensions/FontSize';
import { isDocumentImageSource } from './extensions/DocumentImage';
import { createId } from './id';
import { convertJsonTemplateToHtml, validateTemplate, validateHtmlTemplate } from './template';
import { DEFAULT_ROLES, PAGE_SETTINGS, TEMPLATE_SCHEMA_VERSION, type HtmlContractTemplateV1 } from './types';

interface WordElement {
  type: string;
  children?: WordElement[];
  styleId?: string;
  styleName?: string;
  alignment?: string;
  font?: string;
  fontSize?: number;
  numbering?: { isOrdered?: boolean; level?: string };
}

export interface WordImportResult {
  template: HtmlContractTemplateV1;
  warnings: string[];
}

async function normalizeImage(source: string): Promise<string> {
  const image = new Image();
  image.src = source;
  await image.decode();
  const scale = Math.min(1, 1600 / image.naturalWidth, 1200 / image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法读取 Word 图片');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/png');
  if (!isDocumentImageSource(dataUrl)) throw new Error('Word 图片超过 2MB，未导入');
  return dataUrl;
}

async function convertWordHtml(arrayBuffer: ArrayBuffer): Promise<{ html: string; warnings: string[] }> {
  const mammoth = (await import('mammoth')).default;
  const styleMap = ['u => u', 'strike => s'];
  const styles = new Map<string, { fontFamily?: string; fontSize?: string; textAlign?: string }>();
  const warnings = new Set<string>();
  // Mammoth exposes direct font/alignment properties through transformDocument.
  // Map them to generated classes, then to the editor's existing supported styles.
  const transform = (element: WordElement): WordElement => {
    element.children = element.children?.map(transform);
    if (element.type !== 'run' && element.type !== 'paragraph') return element;
    const style: { fontFamily?: string; fontSize?: string; textAlign?: string } = {};
    if (element.type === 'run') {
      if (element.font) {
        const name = element.font.toLowerCase();
        const font = FONT_FAMILY_OPTIONS.find(option => option.css.toLowerCase().split(',').some(family => family.trim().replace(/"/g, '') === name));
        if (font) style.fontFamily = font.css;
        else warnings.add('部分字体不受编辑器支持，已使用默认字体');
      }
      if (element.fontSize) {
        const pixels = element.fontSize * 96 / 72;
        const size = FONT_SIZE_OPTIONS.reduce((best, option) => Math.abs(option - pixels) < Math.abs(best - pixels) ? option : best);
        style.fontSize = `${size}px`;
        if (Math.abs(size - pixels) > 0.1) warnings.add('部分字号已映射为编辑器支持的字号');
      }
    } else if (element.alignment) {
      const alignment = element.alignment === 'both' ? 'justify' : element.alignment;
      if (['left', 'center', 'right', 'justify'].includes(alignment)) style.textAlign = alignment;
    }
    if (!Object.keys(style).length) return element;
    const id = `word-style-${styles.size}`;
    styles.set(id, style);
    let tag = 'span';
    if (element.type === 'paragraph') {
      const heading = /^(?:heading|标题)\s*([1-3])$/i.exec(element.styleName || '')
        || /^Heading([1-3])$/i.exec(element.styleId || '');
      tag = heading ? `h${heading[1]}` : 'p';
    }
    let path = `${tag}.${id}${element.type === 'paragraph' ? ':fresh' : ''}`;
    if (element.type === 'paragraph' && element.numbering) {
      const list = element.numbering.isOrdered ? 'ol' : 'ul';
      const depth = Math.min(5, Math.max(1, Number(element.numbering.level || 0) + 1));
      path = `${'ul|ol > li > '.repeat(depth - 1)}${list} > li:fresh > p.${id}:fresh`;
    }
    styleMap.push(`${element.type === 'run' ? 'r' : 'p'}.${id} => ${path}`);
    return { ...element, styleId: id, styleName: id };
  };
  const result = await mammoth.convertToHtml({ arrayBuffer }, {
    styleMap,
    includeEmbeddedStyleMap: false,
    ignoreEmptyParagraphs: false,
    transformDocument: transform,
    convertImage: mammoth.images.imgElement(async image => {
      if (!/^image\/(png|jpeg|gif|webp|bmp)$/.test(image.contentType)) {
        throw new Error('Word 中包含不支持的图片格式，未导入');
      }
      return { src: await normalizeImage(`data:${image.contentType};base64,${await image.readAsBase64String()}`) };
    }),
  });
  result.messages.forEach(item => warnings.add(item.message));
  const clean = DOMPurify.sanitize(result.value, {
    ALLOW_DATA_ATTR: false,
    ALLOWED_TAGS: ['p', 'h1', 'h2', 'h3', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'br', 'span', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img'],
    ALLOWED_ATTR: ['class', 'src', 'alt', 'colspan', 'rowspan'],
  });
  const parsed = new DOMParser().parseFromString(clean, 'text/html');
  parsed.querySelectorAll<HTMLElement>('[class]').forEach(element => {
    const style = styles.get(element.className);
    if (style && element.tagName === 'SPAN') {
      // Existing font marks parse separate spans; a single span with both
      // properties would be consumed by the first matching mark rule.
      if (style.fontFamily) {
        const span = document.createElement('span');
        span.style.fontFamily = style.fontFamily;
        span.append(...Array.from(element.childNodes));
        element.append(span);
      }
      if (style.fontSize) {
        const span = document.createElement('span');
        span.style.fontSize = style.fontSize;
        span.append(...Array.from(element.childNodes));
        element.append(span);
      }
    } else if (style) Object.assign(element.style, style);
    element.removeAttribute('class');
  });
  parsed.querySelectorAll('img').forEach(image => {
    if (!isDocumentImageSource(image.getAttribute('src'))) image.remove();
  });
  return { html: parsed.body.innerHTML, warnings: [...warnings] };
}

export async function readWordFile(file: File, schema: Schema): Promise<WordImportResult> {
  if (!/\.docx$/i.test(file.name)) throw new Error('仅支持 .docx，请先将旧版 .doc 转换为 .docx');
  if (file.size > 5 * 1024 * 1024) throw new Error('Word 文件不能超过 5MB');
  const imported = await readWordSections(await file.arrayBuffer(), convertWordHtml);
  if (!imported.parts.some(part => new DOMParser().parseFromString(part.html, 'text/html').body.textContent?.trim() || /<img\b/.test(part.html))) throw new Error('Word 中没有可导入的内容');
  const runtime: JSONContent = { type: 'doc', content: imported.parts.map((part, index) => {
    const page = document.createElement('section');
    page.setAttribute('data-contract-page', 'true');
    page.setAttribute('data-page-id', createId('page'));
    page.setAttribute('data-section-id', part.sectionId);
    page.setAttribute('data-break-type', index === 0 ? 'root' : 'manual');
    page.innerHTML = part.html || '<p></p>';
    const node = generateJSON(page.outerHTML, createEditorExtensions()).content?.[0];
    if (!node) throw new Error('无法转换 Word 正文');
    return node;
  }) };
  const visit = (node: JSONContent) => {
    if (node.type === 'table') node.attrs = { ...node.attrs, tableId: createId('table'), fragmentId: createId('fragment') };
    if (node.type === 'tableRow') node.attrs = { ...node.attrs, rowId: createId('row') };
    node.content?.forEach(visit);
  };
  visit(runtime);
  const template = convertJsonTemplateToHtml(validateTemplate({
    schemaVersion: TEMPLATE_SCHEMA_VERSION, pageSettings: PAGE_SETTINGS,
    roles: DEFAULT_ROLES, fields: [], document: runtime, pageFurniture: imported.furniture,
  }, schema));
  if (new Blob([template.html]).size > 5 * 1024 * 1024) throw new Error('导入后的内容超过 5MB，请减少图片后重试');
  return { template: validateHtmlTemplate(template, schema), warnings: imported.warnings };
}
