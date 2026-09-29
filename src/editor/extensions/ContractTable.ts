import { Table, TableRow } from '@tiptap/extension-table';
import { Plugin, type Transaction } from '@tiptap/pm/state';
import { validFieldTables } from '../fieldTables';
import { PAGINATION_META } from './Pagination';

function isPaginationTransaction(transaction: Transaction): boolean {
  if (transaction.getMeta(PAGINATION_META)) return true;
  const root = transaction.getMeta('appendedTransaction');
  return !!root?.getMeta?.(PAGINATION_META);
}

export const ContractTable = Table.extend({
  addProseMirrorPlugins() {
    return [...(this.parent?.() || []), new Plugin({
      // Design-time edits must keep a field table identical to its configured
      // sample-row shape. Signing snapshots intentionally expand that sample
      // row and pagination then splits it into fragments, so only trusted
      // internal pagination transactions may bypass the design-time invariant.
      filterTransaction: (tr) => !tr.docChanged || isPaginationTransaction(tr) || validFieldTables(tr.doc),
    })];
  },
  addAttributes() {
    return {
      ...(this.parent?.() || {}),
      fieldTable: { default: null, rendered: false },
      tableId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-table-id'),
        renderHTML: (attributes) => ({ 'data-table-id': attributes.tableId }),
      },
      fragmentId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-fragment-id'),
        renderHTML: (attributes) => ({ 'data-fragment-id': attributes.fragmentId }),
      },
      continuation: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-continuation') === 'true',
        renderHTML: (attributes) => (
          attributes.continuation ? { 'data-continuation': 'true' } : {}
        ),
      },
    };
  },
}).configure({
  resizable: true,
  allowTableNodeSelection: true,
  lastColumnResizable: true,
});

export const ContractTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...(this.parent?.() || {}),
      rowId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-row-id'),
        renderHTML: (attributes) => ({ 'data-row-id': attributes.rowId }),
      },
      repeatedHeader: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-repeated-header') === 'true',
        renderHTML: (attributes) => (
          attributes.repeatedHeader
            ? { 'data-repeated-header': 'true', contenteditable: 'false' }
            : {}
        ),
      },
      sourceRowId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-source-row-id'),
        renderHTML: (attributes) => (
          attributes.sourceRowId ? { 'data-source-row-id': attributes.sourceRowId } : {}
        ),
      },
    };
  },
});
