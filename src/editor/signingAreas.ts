import type { JSONContent } from '@tiptap/core';
import { createId } from './id';

// Restore legacy signing regions as zero-size inline anchors.
export function migrateSigningAreas(document: JSONContent, safeWidth: number): JSONContent {
  return {
    ...document,
    content: document.content?.map(page => {
      if (page.type !== 'page') return page;
      const children = page.content || [];
      const anchored = new Map<string, JSONContent[]>();
      const free: JSONContent[] = [];
      children.forEach(child => {
        if (child.type !== 'pageOverlay') return;
        if (child.attrs?.positionMode === 'anchor' && child.attrs.anchorId) {
          const key = String(child.attrs.anchorId);
          anchored.set(key, [...(anchored.get(key) || []), child]);
        } else free.push(child);
      });
      const flow = children.filter(child => child.type !== 'pageOverlay').map(child => {
        if (child.type !== 'layoutAnchor') return child;
        const fields = anchored.get(String(child.attrs?.anchorId)) || [];
        anchored.delete(String(child.attrs?.anchorId));
        return {
          type: 'signingArea', attrs: { areaId: child.attrs?.anchorId || createId('area'), minHeight: child.attrs?.reservedHeight || 140 },
          content: fields.map(field => {
            const align = field.attrs?.anchorAlign;
            const width = Number(field.attrs?.width);
            const baseX = align === 'center' ? (safeWidth - width) / 2 : align === 'right' ? safeWidth - width : 0;
            return { ...field, attrs: { ...field.attrs, positionMode: 'page', anchorId: null, x: Math.round(baseX + Number(field.attrs?.anchorOffsetX || 0)), y: Number(field.attrs?.anchorOffsetY) || 0 } };
          }),
        };
      });
      // Keep unresolvable references visible instead of silently dropping fields.
      anchored.forEach(fields => free.push(...fields));
      const firstY = Math.min(...free.map(field => Number(field.attrs?.y) || 0));
      if (free.length) flow.push({
        type: 'signingArea', attrs: { areaId: createId('area'), minHeight: 40 },
        content: free.map(field => ({ ...field, attrs: { ...field.attrs, positionMode: 'page', anchorId: null, y: 12 + (Number(field.attrs?.y) || 0) - firstY } })),
      });
      return { ...page, content: flow.map(child => child.type !== 'signingArea' ? child : {
        type: 'paragraph',
        content: (child.content || []).map(field => ({
          type: 'floatingField',
          attrs: {
            refId: field.attrs?.refId,
            fieldId: field.attrs?.fieldId,
            fieldType: field.attrs?.fieldType,
            fieldName: field.attrs?.fieldName,
            width: field.attrs?.width,
            height: field.attrs?.height,
            offsetX: Number(field.attrs?.x) || 0,
            offsetY: Number(field.attrs?.y) || 0,
          },
        })),
      }) };
    }),
  };
}
