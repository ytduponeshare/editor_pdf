import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TableCell, TableHeader } from '@tiptap/extension-table';
import { ContractDocument } from './ContractDocument';
import { ContractTable, ContractTableRow } from './ContractTable';
import { FloatingField } from './FloatingField';
import { FontFamily } from './FontFamily';
import { FontSize } from './FontSize';
import { InlineField } from './InlineField';
import { LineHeight } from './LineHeight';
import { LayoutAnchor } from './LayoutAnchor';
import { Page } from './Page';
import { SigningArea } from './SigningArea';
import { PageOverlay } from './PageOverlay';
import { Pagination } from './Pagination';
import { TableBoundary } from './TableBoundary';
import { TextColor } from './TextColor';
import { DocumentImage } from './DocumentImage';

export function createEditorExtensions() {
  return [
    StarterKit.configure({
      document: false,
      blockquote: false,
      code: false,
      codeBlock: false,
      horizontalRule: false,
      link: false,
      heading: { levels: [1, 2, 3] },
    }),
    ContractDocument,
    Page,
    LayoutAnchor,
    SigningArea,
    PageOverlay,
    Pagination,
    InlineField,
    LineHeight,
    FloatingField,
    FontFamily,
    FontSize,
    TextColor,
    DocumentImage,
    ContractTable,
    ContractTableRow,
    TableHeader,
    TableCell,
    TableBoundary,
    TextAlign.configure({
      types: ['heading', 'paragraph'],
      alignments: ['left', 'center', 'right', 'justify'],
    }),
  ];
}

export {
  ContractDocument,
  ContractTable,
  ContractTableRow,
  FloatingField,
  FontFamily,
  FontSize,
  InlineField,
  LineHeight,
  LayoutAnchor,
  Page,
  PageOverlay,
  Pagination,
  TableBoundary,
  TextColor,
};
