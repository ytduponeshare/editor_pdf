import DOMPurify from 'dompurify';
import type { PageMargins } from './types';
import { isDocumentImageSource } from './extensions/DocumentImage';

export type FurnitureKind = 'header' | 'footer';
export type FurnitureVariant = 'default' | 'first' | 'even';
export interface FurnitureSlots { default: string; first: string; even: string }
export interface DocumentSection {
  id: string;
  name: string;
  differentFirstPage: boolean;
  differentOddEven: boolean;
  headerEnabled: boolean;
  footerEnabled: boolean;
  headerHeightMm: number;
  footerHeightMm: number;
  header: FurnitureSlots;
  footer: FurnitureSlots;
}
export interface PageFurniture { sections: DocumentSection[] }

export function createDocumentSection(id = 'default', name = '第 1 节'): DocumentSection {
  return {
    id, name, differentFirstPage: false, differentOddEven: false,
    headerEnabled: false, footerEnabled: false, headerHeightMm: 12, footerHeightMm: 12,
    header: { default: '', first: '', even: '' }, footer: { default: '', first: '', even: '' },
  };
}

export function sanitizeFurnitureHtml(html: string): string {
  if (!html) return '';
  const dom = new DOMParser().parseFromString(html, 'text/html');
  if (dom.querySelector('script,iframe,object,embed,style,link')) throw new Error('页眉页脚包含不支持的内容');
  dom.querySelectorAll('img').forEach(image => {
    if (!isDocumentImageSource(image.getAttribute('src'))) throw new Error('页眉页脚包含不支持的图片');
  });
  dom.querySelectorAll('[style]').forEach(element => {
    if (/url\s*\(|expression\s*\(|javascript\s*:|@import|\\/i.test(element.getAttribute('style') || '')) throw new Error('页眉页脚样式不受支持');
  });
  return DOMPurify.sanitize(html, {
    ALLOW_DATA_ATTR: false,
    ALLOWED_TAGS: ['p', 'h1', 'h2', 'h3', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'br', 'span', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'colgroup', 'col', 'img'],
    ALLOWED_ATTR: ['style', 'class', 'src', 'alt', 'colspan', 'rowspan', 'colwidth'],
  });
}

export function validatePageFurniture(value: unknown): PageFurniture {
  if (value === undefined || value === null) return { sections: [createDocumentSection()] };
  if (typeof value !== 'object' || !('sections' in value)) throw new Error('页眉页脚配置无效');
  const sections = (value as { sections: unknown }).sections;
  if (!Array.isArray(sections) || !sections.length || sections.length > 100) throw new Error('文档必须包含 1～100 节');
  const ids = new Set<string>();
  let total = 0;
  const result = { sections: sections.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('分节配置无效');
    const section = item as DocumentSection;
    if (typeof section.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(section.id) || ids.has(section.id)) throw new Error('节标识无效或重复');
    ids.add(section.id);
    if (typeof section.name !== 'string' || !section.name.trim() || section.name.length > 50) throw new Error('节名称无效');
    for (const key of ['differentFirstPage', 'differentOddEven', 'headerEnabled', 'footerEnabled'] as const) {
      if (typeof section[key] !== 'boolean') throw new Error('页眉页脚开关无效');
    }
    for (const key of ['headerHeightMm', 'footerHeightMm'] as const) {
      if (!Number.isFinite(section[key]) || section[key] < 5 || section[key] > 40) throw new Error('页眉页脚高度必须在 5～40mm 之间');
    }
    const slots = (value: FurnitureSlots): FurnitureSlots => {
      if (!value || typeof value !== 'object') throw new Error('页眉页脚内容无效');
      const result: FurnitureSlots = { default: '', first: '', even: '' };
      for (const variant of ['default', 'first', 'even'] as const) {
        if (typeof value[variant] !== 'string' || value[variant].length > 1_000_000) throw new Error('页眉页脚内容无效或过大');
        total += new TextEncoder().encode(value[variant]).length;
        result[variant] = sanitizeFurnitureHtml(value[variant]);
      }
      return result;
    };
    return { ...section, header: slots(section.header), footer: slots(section.footer) };
  }) };
  if (total > 5 * 1024 * 1024) throw new Error('页眉页脚内容不能超过 5MB');
  return result;
}

export function getSection(value: PageFurniture | null | undefined, id: string): DocumentSection {
  return value?.sections.find(section => section.id === id) || value?.sections[0] || createDocumentSection();
}

export function furnitureReserve(section: DocumentSection): { header: number; footer: number } {
  return {
    header: section.headerEnabled ? section.headerHeightMm + 3 : 0,
    footer: section.footerEnabled ? section.footerHeightMm + 3 : 0,
  };
}

export function furnitureVariant(section: DocumentSection, first: boolean, page: number): FurnitureVariant {
  return first && section.differentFirstPage ? 'first' : section.differentOddEven && page % 2 === 0 ? 'even' : 'default';
}

export function furnitureWithCounters(html: string, page: number, pages: number): string {
  const dom = new DOMParser().parseFromString(html, 'text/html');
  const walker = dom.createTreeWalker(dom.body, 4);
  const texts: Node[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  texts.forEach(node => {
    const value = node.textContent || '';
    if (!/\{page(?:s)?\}/.test(value)) return;
    const fragment = dom.createDocumentFragment();
    value.split(/(\{page\}|\{pages\})/).forEach(part => {
      if (part === '{page}' || part === '{pages}') {
        const span = dom.createElement('span');
        span.setAttribute('data-page-counter', part === '{page}' ? 'page' : 'pages');
        span.textContent = String(part === '{page}' ? page : pages);
        fragment.append(span);
      } else fragment.append(dom.createTextNode(part));
    });
    node.parentNode?.replaceChild(fragment, node);
  });
  return dom.body.innerHTML;
}

export function decoratePrintPages(dom: Document, furniture: PageFurniture, margins: PageMargins): void {
  const pages = Array.from(dom.querySelectorAll<HTMLElement>('section[data-contract-page]'));
  const seen = new Set<string>();
  pages.forEach((page, index) => {
    const section = getSection(furniture, page.dataset.sectionId || 'default');
    const first = !seen.has(section.id);
    seen.add(section.id);
    page.dataset.sectionId = section.id;
    page.dataset.differentFirst = String(section.differentFirstPage);
    page.dataset.differentEven = String(section.differentOddEven);
    page.dataset.headerHeight = String(section.headerEnabled ? section.headerHeightMm : 0);
    page.dataset.footerHeight = String(section.footerEnabled ? section.footerHeightMm : 0);
    const reserve = furnitureReserve(section);
    page.style.paddingTop = `${margins.top + reserve.header}mm`;
    page.style.paddingBottom = `${margins.bottom + reserve.footer}mm`;
    for (const kind of ['header', 'footer'] as const) {
      if (!section[`${kind}Enabled`]) continue;
      for (const variant of ['default', 'first', 'even'] as const) {
        const element = dom.createElement('div');
        element.className = `page-furniture page-furniture--${kind}`;
        element.dataset.pageFurniture = kind;
        element.dataset.furnitureVariant = variant;
        element.style.cssText = `position:absolute;left:${margins.left}mm;right:${margins.right}mm;${kind === 'header' ? 'top' : 'bottom'}:${kind === 'header' ? margins.top : margins.bottom}mm;height:${section[`${kind}HeightMm`]}mm;display:${variant === furnitureVariant(section, first, index + 1) ? 'block' : 'none'}`;
        element.innerHTML = furnitureWithCounters(section[kind][variant], index + 1, pages.length);
        page.append(element);
      }
    }
  });
}
