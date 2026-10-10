import JSZip from 'jszip';
import { createDocumentSection, type DocumentSection, type PageFurniture } from './pageFurniture';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8"?>';
type Convert = (buffer: ArrayBuffer) => Promise<{ html: string; warnings: string[] }>;

function elements(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagNameNS(W, localName));
}
function enabled(element: Element | undefined): boolean {
  return !!element && !['0', 'false', 'off'].includes(element.getAttributeNS(W, 'val') || '');
}
function parseXml(text: string): Document {
  const document = new DOMParser().parseFromString(text, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('Word 文档 XML 无效');
  return document;
}
function replacePageFields(root: Element): void {
  const token = (instruction: string) => /\bNUMPAGES\b/i.test(instruction) ? '{pages}' : /\bPAGE\b/i.test(instruction) ? '{page}' : null;
  const run = (text: string) => {
    const element = root.ownerDocument.createElementNS(W, 'w:r');
    const value = root.ownerDocument.createElementNS(W, 'w:t');
    value.textContent = text; element.append(value); return element;
  };
  elements(root, 'fldSimple').forEach(field => {
    const value = token(field.getAttributeNS(W, 'instr') || '');
    if (value) field.replaceWith(run(value));
  });
  elements(root, 'p').forEach(paragraph => {
    let field: Element[] | null = null;
    let instruction = '';
    for (const child of Array.from(paragraph.children)) {
      const markers = elements(child, 'fldChar');
      if (markers.some(marker => marker.getAttributeNS(W, 'fldCharType') === 'begin')) { field = []; instruction = ''; }
      if (field) {
        field.push(child);
        instruction += elements(child, 'instrText').map(element => element.textContent || '').join('');
        if (markers.some(marker => marker.getAttributeNS(W, 'fldCharType') === 'end')) {
          const value = token(instruction);
          if (value) { field[0].before(run(value)); field.forEach(element => element.remove()); }
          field = null;
        }
      }
    }
  });
}

export async function readWordSections(buffer: ArrayBuffer, convert: Convert): Promise<{
  parts: Array<{ sectionId: string; html: string }>;
  furniture: PageFurniture;
  warnings: string[];
}> {
  const zip = await JSZip.loadAsync(buffer);
  const main = zip.file('word/document.xml');
  if (!main) throw new Error('Word 文件缺少正文');
  const document = parseXml(await main.async('string'));
  const body = elements(document, 'body')[0];
  if (!body) throw new Error('Word 文件缺少正文');
  const relationships = zip.file('word/_rels/document.xml.rels');
  const relationXml = relationships ? await relationships.async('string') : '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>';
  const relations = parseXml(relationXml);
  const settings = zip.file('word/settings.xml');
  const oddEven = settings ? enabled(elements(parseXml(await settings.async('string')), 'evenAndOddHeaders')[0]) : false;
  const warnings = new Set<string>();
  const groups: Array<{ children: Element[]; properties: Element | undefined }> = [];
  let children: Element[] = [];
  for (const child of Array.from(body.children)) {
    if (child.namespaceURI === W && child.localName === 'sectPr') {
      groups.push({ children, properties: child }); children = [];
    } else {
      children.push(child);
      const properties = child.localName === 'p' ? elements(child, 'sectPr')[0] : undefined;
      if (properties) { groups.push({ children, properties }); children = []; }
    }
  }
  if (children.length || !groups.length) groups.push({ children, properties: undefined });
  if (groups.length > 100) throw new Error('Word 文档不能超过 100 节');
  const sections: DocumentSection[] = [];
  const parts: Array<{ sectionId: string; html: string }> = [];
  const serializer = new XMLSerializer();
  const convertPart = async (content: Element[], relationships: string): Promise<string> => {
    const cloned = await JSZip.loadAsync(buffer);
    const mainClone = document.cloneNode(true) as Document;
    const cloneBody = elements(mainClone, 'body')[0];
    cloneBody.replaceChildren(...content.map(element => mainClone.importNode(element, true)));
    elements(cloneBody, 'sectPr').forEach(element => element.remove());
    cloned.file('word/document.xml', XML + serializer.serializeToString(mainClone));
    cloned.file('word/_rels/document.xml.rels', relationships);
    const result = await convert(await cloned.generateAsync({ type: 'arraybuffer' }));
    result.warnings.forEach(warning => warnings.add(warning));
    return result.html;
  };
  const cached = new Map<string, string>();
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    const section = createDocumentSection(`word-section-${index + 1}`, `第 ${index + 1} 节`);
    if (index > 0) {
      section.header = { ...sections[index - 1].header };
      section.footer = { ...sections[index - 1].footer };
    }
    section.differentFirstPage = group.properties ? enabled(elements(group.properties, 'titlePg')[0]) : false;
    section.differentOddEven = oddEven;
    for (const kind of ['header', 'footer'] as const) {
      for (const reference of group.properties ? elements(group.properties, `${kind}Reference`) : []) {
        const id = reference.getAttributeNS(R, 'id');
        const relation = Array.from(relations.documentElement.children).find(element => element.getAttribute('Id') === id);
        const target = relation?.getAttribute('Target') || '';
        if (!target || relation?.getAttribute('TargetMode') === 'External') { warnings.add('无法读取部分页眉页脚引用'); continue; }
        const path = target.startsWith('/') ? target.slice(1) : `word/${target}`;
        const segments: string[] = [];
        for (const part of path.split('/')) { if (part === '..') segments.pop(); else if (part && part !== '.') segments.push(part); }
        const filePath = segments.join('/');
        if (!cached.has(filePath)) {
          const file = zip.file(filePath);
          if (!file) { warnings.add('Word 页眉页脚文件缺失'); continue; }
          const fragment = parseXml(await file.async('string'));
          replacePageFields(fragment.documentElement);
          const slash = filePath.lastIndexOf('/');
          const relPath = `${filePath.slice(0, slash)}/_rels/${filePath.slice(slash + 1)}.rels`;
          const relFile = zip.file(relPath);
          const fragmentRelations = parseXml(relFile ? await relFile.async('string') : '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
          // Keep style/numbering relationships for Mammoth, while images belong to this header/footer part.
          for (const relation of Array.from(relations.documentElement.children)) {
            if (/\/(?:styles|numbering)$/.test(relation.getAttribute('Type') || '')) {
              const clone = fragmentRelations.importNode(relation, true);
              clone.setAttribute('Id', `furniture-${clone.getAttribute('Id')}`);
              fragmentRelations.documentElement.append(clone);
            }
          }
          // Relationship targets are relative to their original part directory.
          for (const relation of Array.from(fragmentRelations.documentElement.children)) {
            if (/\/image$/.test(relation.getAttribute('Type') || '') && relation.getAttribute('TargetMode') !== 'External') {
              const target = relation.getAttribute('Target') || '';
              if (!target.startsWith('/')) relation.setAttribute('Target', `/${filePath.slice(0, slash)}/${target}`);
            }
          }
          cached.set(filePath, await convertPart(Array.from(fragment.documentElement.children), serializer.serializeToString(fragmentRelations)));
        }
        const variant = reference.getAttributeNS(W, 'type');
        if (variant === 'first' || variant === 'even' || variant === 'default') section[kind][variant] = cached.get(filePath) || '';
      }
      section[`${kind}Enabled`] = Object.values(section[kind]).some(html => !!new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() || /<img\b/.test(html));
    }
    if (index < groups.length - 1 && group.properties) {
      const type = elements(group.properties, 'type')[0]?.getAttributeNS(W, 'val');
      if (type && type !== 'nextPage') warnings.add('连续或奇偶分节已转换为另起一页');
    }
    sections.push(section);
    parts.push({ sectionId: section.id, html: await convertPart(group.children, relationXml) });
  }
  return { parts, furniture: { sections }, warnings: [...warnings] };
}
