import { Node } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { FieldDefinition } from '../types';
import { PAGE_SETTINGS, DEFAULT_ROLES } from '../types';
import { createId } from '../id';

function fieldsEqual(left: FieldDefinition[], right: FieldDefinition[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export const ContractDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: 'page+',

  addAttributes() {
    return {
      pageFurniture: { default: null, rendered: false },
      roles: { default: DEFAULT_ROLES, rendered: false },
      fieldDefinitions: {
        default: [],
        rendered: false,
      },
      pageMargins: {
        default: { ...PAGE_SETTINGS.marginsMm },
        rendered: false,
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((transaction) => transaction.docChanged)) {
            return null;
          }

          const seenRefIds = new Set<string>();
          const usedFieldIds = new Set<string>();
          const duplicateRefs: Array<{ position: number; attrs: Record<string, unknown> }> = [];
          const anchorIds = new Set<string>();

          newState.doc.descendants((node, position) => {
            if (node.type.name === 'layoutAnchor' && typeof node.attrs.anchorId === 'string') {
              anchorIds.add(node.attrs.anchorId);
              return;
            }
            if (
              node.type.name !== 'inlineField'
              && node.type.name !== 'floatingField'
              && node.type.name !== 'pageOverlay'
            ) {
              return;
            }

            usedFieldIds.add(node.attrs.fieldId);
            if (seenRefIds.has(node.attrs.refId)) {
              duplicateRefs.push({
                position,
                attrs: { ...node.attrs, refId: createId('ref') },
              });
            } else {
              seenRefIds.add(node.attrs.refId);
            }
          });

          const currentFields = (newState.doc.attrs.fieldDefinitions || []) as FieldDefinition[];
          const nextFields = currentFields.filter((field) => usedFieldIds.has(field.id));
          const transaction = newState.tr;

          newState.doc.descendants((node, position) => {
            if (node.type.name === 'pageOverlay' && node.attrs.positionMode === 'anchor'
              && !anchorIds.has(String(node.attrs.anchorId || ''))) {
              transaction.setNodeMarkup(position, undefined, {
                ...node.attrs,
                positionMode: 'page',
                anchorId: null,
              }, node.marks);
            }
          });

          duplicateRefs.forEach(({ position, attrs }) => {
            const node = transaction.doc.nodeAt(position);
            if (node) {
              transaction.setNodeMarkup(position, undefined, attrs, node.marks);
            }
          });

          if (!fieldsEqual(currentFields, nextFields)) {
            transaction.setDocAttribute('fieldDefinitions', nextFields);
          }

          return transaction.steps.length ? transaction : null;
        },
      }),
    ];
  },
});
