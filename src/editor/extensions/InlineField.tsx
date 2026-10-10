import { mergeAttributes, Node } from '@tiptap/core';
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react';
import { useEffect, useState } from 'react';
import { useSigningContext } from '../../signing/context';
import { InlineTextInput } from '../../signing/InlineTextInput';

function SigningInlineField({ node }: Pick<NodeViewProps, 'node'>) {
  const signing = useSigningContext();
  if (!signing) return null;
  const field = signing.fields[node.attrs.fieldId];
  const tableKey = node.attrs.tableId && node.attrs.rowId && node.attrs.boundColumn
    ? `${node.attrs.tableId}:${node.attrs.rowId}:${node.attrs.boundColumn}` : '';
  const tableValue = tableKey ? signing.tableValues[tableKey] : undefined;
  const flowText = (field?.type || node.attrs.fieldType) === 'text' && !node.attrs.boundColumn;
  const width = node.attrs.width || DEFAULT_WIDTH;
  const editable = field?.roleId === signing.roleId && (field.type === 'text' && field.binding?.sourceId === 'system' || !!tableKey && field?.roleId === signing.roleId);
  if (!editable) {
    return <NodeViewWrapper as="span" className={`signing-field signing-field--readonly${flowText ? ' signing-field--flow' : ''}`} contentEditable={false}>{tableValue || signing.values[node.attrs.fieldId] || node.attrs.fieldName}</NodeViewWrapper>;
  }
  const binding = field.binding;
  const common = {
    value: tableKey ? tableValue || '' : signing.values[field.id] || '',
    'aria-label': binding?.fieldName || field.name,
    'aria-invalid': signing.invalidFieldIds.has(field.id),
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => tableKey
      ? signing.setTableValue(tableKey, event.target.value)
      : signing.setValue(field.id, event.target.value),
  };
  if (flowText && (!binding?.inputType || binding.inputType === 'text')) {
    return <NodeViewWrapper as="span" className={`signing-field signing-field--flow${signing.invalidFieldIds.has(field.id) ? ' is-invalid' : ''}`} contentEditable={false}>
      <InlineTextInput value={common.value} label={common['aria-label']} invalid={common['aria-invalid']} width={width} onChange={value => signing.setValue(field.id, value)} />
    </NodeViewWrapper>;
  }
  return (
    <NodeViewWrapper as="span" className={`signing-field${signing.invalidFieldIds.has(field.id) ? ' is-invalid' : ''}`} style={{ width: `${width}px` }} contentEditable={false}>
      {binding?.inputType === 'select' ? (
        <select {...common}><option value="">请选择</option>{binding.options?.map(option => <option key={option} value={option}>{option}</option>)}</select>
      ) : (
        <input {...common} type={binding?.inputType === 'date' || field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'} placeholder={binding?.fieldName || field.name} />
      )}
    </NodeViewWrapper>
  );
}

const DEFAULT_WIDTH = 120;
const MIN_WIDTH = 60;
const MAX_WIDTH = 400;

function InlineFieldNodeView(props: NodeViewProps) {
  const signing = useSigningContext();
  if (signing) return <SigningInlineField node={props.node} />;
  return <DesignInlineFieldNodeView {...props} />;
}

function DesignInlineFieldNodeView({ node, selected, updateAttributes, editor, getPos }: NodeViewProps) {
  const [width, setWidth] = useState<number>(node.attrs.width || DEFAULT_WIDTH);

  useEffect(() => {
    setWidth(node.attrs.width || DEFAULT_WIDTH);
  }, [node.attrs.width]);

  const selectNode = (event: React.MouseEvent) => {
    event.stopPropagation();
    const position = getPos();
    if (typeof position === 'number') {
      editor.commands.setNodeSelection(position);
    }
  };

  const startResize = (event: React.PointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = width;
    let latestWidth = startWidth;

    const onMove = (moveEvent: PointerEvent) => {
      latestWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + moveEvent.clientX - startX));
      setWidth(latestWidth);
    };

    const onEnd = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      if (latestWidth !== startWidth) {
        updateAttributes({ width: Math.round(latestWidth) });
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  };

  return (
    <NodeViewWrapper
      as="span"
      className={`inline-field${selected ? ' is-selected' : ''}`}
      style={{ width: `${width}px`, maxWidth: node.attrs.boundColumn ? 'calc(100% - 4px)' : undefined }}
      data-ref-id={node.attrs.refId}
      data-field-id={node.attrs.fieldId}
      data-drag-handle
      onClick={selectNode}
      contentEditable={false}
      draggable="true"
    >
      <span className="inline-field__label">{node.attrs.displayValue || node.attrs.fieldName}</span>
      {selected ? (
        <span
          className="inline-field__resize"
          role="separator"
          aria-label="调整字段宽度"
          onPointerDown={startResize}
        />
      ) : null}
    </NodeViewWrapper>
  );
}

export const InlineField = Node.create({
  name: 'inlineField',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      refId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-ref-id'),
        renderHTML: (attributes) => ({ 'data-ref-id': attributes.refId }),
      },
      boundColumn: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-bound-column'),
        renderHTML: (attributes) => attributes.boundColumn ? { 'data-bound-column': attributes.boundColumn } : {},
      },
      tableId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-table-id'),
        renderHTML: (attributes) => attributes.tableId ? { 'data-table-id': attributes.tableId } : {},
      },
      rowId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-row-id'),
        renderHTML: (attributes) => attributes.rowId ? { 'data-row-id': attributes.rowId } : {},
      },
      fieldId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-field-id'),
        renderHTML: (attributes) => ({ 'data-field-id': attributes.fieldId }),
      },
      fieldType: {
        default: 'text',
        parseHTML: (element) => element.getAttribute('data-field-type') || 'text',
        renderHTML: (attributes) => ({ 'data-field-type': attributes.fieldType }),
      },
      fieldName: {
        default: '单行文本',
        parseHTML: (element) => element.getAttribute('data-field-name') || '单行文本',
        renderHTML: (attributes) => ({ 'data-field-name': attributes.fieldName }),
      },
      displayValue: { default: '', rendered: false },
      width: {
        default: DEFAULT_WIDTH,
        parseHTML: (element) => Number(element.getAttribute('data-width')) || DEFAULT_WIDTH,
        renderHTML: (attributes) => ({ 'data-width': attributes.width }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-inline-field]' }, { tag: 'span[data-contract-field]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-inline-field': 'true',
        'data-ref-id': node.attrs.refId,
        'data-field-id': node.attrs.fieldId,
        'data-field-type': node.attrs.fieldType,
        'data-field-name': node.attrs.fieldName,
        'data-width': node.attrs.width,
        ...(node.attrs.boundColumn ? { 'data-bound-column': node.attrs.boundColumn } : {}),
        ...(node.attrs.tableId ? { 'data-table-id': node.attrs.tableId } : {}),
        ...(node.attrs.rowId ? { 'data-row-id': node.attrs.rowId } : {}),
      }),
      node.attrs.fieldName,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(InlineFieldNodeView);
  },
});
