import { useEffect, useMemo, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import { type ContractTemplateSource, type ContractTemplateV3, type FieldDefinition, type TemplateRole } from '../editor/types';
import { createEditorExtensions } from '../editor/extensions';
import { asJsonRuntimeTemplate, hydrateTemplate } from '../editor/template';
import { pdfExportService } from '../services/pdfExport';
import { SigningContext } from '../signing/context';
import {
  continueSigningContract,
  createSigningContract,
  downloadSignedPdf,
  type SigningContract,
  type ContractTableValue,
} from '../services/signing';
import { fieldCatalogService } from '../services/fieldCatalog';
import { isFieldTableConfig, type FieldTableConfig } from '../editor/fieldTableTypes';
import { createId } from '../editor/id';

export interface SigningSession {
  template: ContractTemplateSource;
  signerName: string;
  roleId: string;
  contractId?: string;
  userId?: string;
  initialValues?: Record<string, string>;
  initialSignatures?: Record<string, string>;
  initialSeals?: Record<string, string>;
  initialTableValues?: ContractTableValue[];
}

export function getParticipatingRoles(roles: TemplateRole[], fields: FieldDefinition[]): TemplateRole[] {
  const used = new Set(fields
    .filter(field => field.roleId && (field.type === 'signature' || field.type === 'companySeal'
      || (field.type === 'text' && field.binding?.sourceId === 'system')))
    .map(field => field.roleId!));
  return roles.filter(role => used.has(role.id));
}

export function sessionFromContract(contract: SigningContract, signerName: string): SigningSession {
  if (contract.status !== 'pending' || !contract.currentRole) throw new Error('该合同当前不可继续签署');
  return {
    contractId: contract.contractId,
    template: contract.template,
    signerName,
    roleId: contract.currentRole.id,
    initialValues: Object.fromEntries(contract.fields.map(field => [field.fieldId, field.value])),
    initialSignatures: Object.fromEntries(contract.signatures.map(signature => [signature.fieldId, signature.dataUrl])),
    initialSeals: Object.fromEntries(contract.seals.map(seal => [seal.fieldId, seal.dataUrl])),
    initialTableValues: contract.tableValues,
  };
}

export async function prepareSigningTemplate(template: ContractTemplateV3, priorValues: ContractTableValue[] = []): Promise<{ template: ContractTemplateV3; tableValues: ContractTableValue[] }> {
  const fields = [...template.fields];
  const fieldIds = new Set(fields.map(field => field.id));
  const tableValues: ContractTableValue[] = [...priorValues];
  const priorMap = new Map(priorValues.map(cell => [`${cell.tableId}:${cell.rowId}:${cell.columnId}`, cell.value]));
  const visit = async (node: JSONContent): Promise<JSONContent> => {
    if (node.type === 'table' && typeof node.attrs?.tableId === 'string' && isFieldTableConfig(node.attrs?.fieldTable) && node.content && node.content.length > 1) {
      const config = node.attrs.fieldTable as FieldTableConfig;
      const records = priorValues.length ? [] : config.sourceId ? await fieldCatalogService.getRecords(config.sourceId) : [];
      const snapshotRowIds = priorValues.filter(cell => cell.tableId === node.attrs!.tableId)
        .map(cell => cell.rowId).filter((rowId, index, list) => list.indexOf(rowId) === index);
      const rowIds = snapshotRowIds.length
        ? snapshotRowIds
        : records.length
          ? records.map(record => record.id)
          : node.content!.slice(1).map((row, index) => String(row.attrs?.rowId || `row-${index + 1}`));
      const sourceRecordMap = new Map(records.map(record => [record.id, record]));
      const templateRow = node.content![1]!;
      const rows = await Promise.all(rowIds.map(async rowId => {
        const record = sourceRecordMap.get(rowId);
        const row = { ...templateRow, attrs: { ...templateRow.attrs, rowId }, content: [...(templateRow.content || [])] };
        const rewrite = (child: JSONContent, columnIndex: number): JSONContent => {
          const column = config.columns[columnIndex];
          if (!column) return child;
          if (child.type === 'inlineField' && child.attrs?.boundColumn === column.id) {
            const fieldId = `${node.attrs!.tableId}:${rowId}:${column.id}`;
            if (!fieldIds.has(fieldId)) {
              const original = fields.find(field => field.id === child.attrs?.fieldId);
              fields.push({ id: fieldId, type: column.type, name: column.title, roleId: column.binding.kind === 'control' || column.binding.kind === 'system' ? config.roleId : undefined,
                binding: column.binding.kind === 'system' ? { version: 1, sourceId: 'system', fieldId: column.binding.fieldId, type: 'text', sourceName: '系统字段', fieldName: column.binding.fieldName, kind: 'category', inputType: column.binding.inputType, options: column.binding.options } : original?.binding });
              fieldIds.add(fieldId);
            }
            const editable = column.binding.kind === 'control' || column.binding.kind === 'system';
            const sourceValue = record?.values[column.binding.kind === 'category' || column.binding.kind === 'current' || column.binding.kind === 'record' ? column.binding.fieldId : ''] || '';
            const value = priorMap.get(`${node.attrs!.tableId}:${rowId}:${column.id}`) ?? (editable ? '' : sourceValue);
            if (!tableValues.some(cell => cell.tableId === node.attrs!.tableId && cell.rowId === rowId && cell.columnId === column.id)) tableValues.push({ tableId: node.attrs!.tableId, rowId, columnId: column.id, value, editable, roleId: config.roleId, roleName: config.roleName, sourceId: config.sourceId });
            return { ...child, attrs: { ...child.attrs, fieldId, refId: `${child.attrs?.refId || fieldId}-${rowId}`, tableId: node.attrs!.tableId, rowId, fieldName: column.title } };
          }
          const attrs = { ...(child.attrs || {}) };
          if (typeof attrs.blockId === 'string') attrs.blockId = createId('block');
          if (typeof attrs.flowId === 'string') attrs.flowId = createId('flow');
          return { ...child, attrs, content: child.content?.map(grandChild => rewrite(grandChild, columnIndex)) };
        };
        row.content = row.content.map((cell, columnIndex) => ({ ...cell, content: cell.content?.map(child => rewrite(child, columnIndex)) }));
        return row;
      }));
      return { ...node, content: [node.content![0], ...rows] };
    }
    const children = node.content ? await Promise.all(node.content.map(visit)) : undefined;
    return { ...node, content: children };
  };
  return { template: { ...template, fields, document: await visit(template.document) }, tableValues };
}

export function StartSigningDialog({ roles, fields, onClose, onStart }: {
  roles: TemplateRole[];
  fields: FieldDefinition[];
  onClose: () => void;
  onStart: (signerName: string, roleId: string) => void;
}) {
  const participants = getParticipatingRoles(roles, fields);
  const [signerName, setSignerName] = useState('');
  const [error, setError] = useState('');
  const start = () => {
    const name = signerName.trim();
    if (!participants.length) { setError('模板中没有可签署角色'); return; }
    const missingCredential = participants.find(role => !fields.some(field => field.roleId === role.id && (field.type === 'signature' || field.type === 'companySeal')));
    if (missingCredential) { setError(`${missingCredential.name}没有企业章或签名区，请先完成模板配置`); return; }
    if (!name) { setError('请输入签署人姓名'); return; }
    onStart(name, participants[0].id);
  };
  return (
    <div className="signing-dialog-backdrop" role="presentation">
      <section className="signing-dialog" role="dialog" aria-modal="true" aria-labelledby="start-signing-title">
        <h2 id="start-signing-title">发起签署</h2>
        {participants.length ? <p>签署顺序：{participants.map(role => role.name).join(' → ')}</p> : <p>请先为字段和签名区配置角色。</p>}
        <label>{participants[0]?.name || '第一方'}签署人姓名<input autoFocus maxLength={50} value={signerName} onChange={event => setSignerName(event.target.value)} /></label>
        {error ? <p className="signing-error" role="alert">{error}</p> : null}
        <div className="signing-dialog__actions"><button type="button" onClick={onClose}>取消</button><button type="button" className="primary-action" onClick={start}>进入签署</button></div>
      </section>
    </div>
  );
}

function ReceiptView({ contract, onBack, onContinue, backLabel }: {
  contract: SigningContract;
  onBack: () => void;
  onContinue?: (session: SigningSession) => void;
  backLabel: string;
}) {
  const [nextName, setNextName] = useState('');
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const startNext = () => {
    if (!onContinue) return;
    const name = nextName.trim();
    if (!name) { setError(`请输入${contract.currentRole?.name || '下一方'}签署人姓名`); return; }
    try { onContinue(sessionFromContract(contract, name)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '合同无法继续签署'); }
  };
  const download = async () => {
    setDownloading(true); setError('');
    try { await downloadSignedPdf(contract); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '合同文件下载失败'); }
    finally { setDownloading(false); }
  };
  return (
    <main className="signing-receipt">
      <section>
        <div className="signing-receipt__success">✓</div>
        <h1>{contract.status === 'completed' ? '合同签署完成' : '本方签署完成'}</h1>
        <p>{contract.status === 'completed' ? '所有参与方已完成签署，最终文件已生成。' : `合同当前等待${contract.currentRole?.name}签署。`}</p>
        <dl>
          <div><dt>合同编号</dt><dd>{contract.contractId}</dd></div>
          <div><dt>签署进度</dt><dd>{contract.signers.length} / {contract.roleOrder.length}</dd></div>
          {contract.signers.map(signer => <div key={signer.roleId}><dt>{signer.roleName}</dt><dd>{signer.signerName} · {new Date(signer.signedAt).toLocaleString()}</dd></div>)}
        </dl>
        {contract.status === 'pending' && onContinue ? (
          <label className="signing-receipt__next">{contract.currentRole?.name}签署人姓名<input maxLength={50} value={nextName} onChange={event => setNextName(event.target.value)} /></label>
        ) : null}
        {error ? <p className="signing-error" role="alert">{error}</p> : null}
        <div className="signing-receipt__actions">
          <button type="button" className="secondary-action" onClick={onBack}>{backLabel}</button>
          <a className="secondary-action" href={contract.pdfUrl} target="_blank" rel="noreferrer">查看当前 PDF</a>
          {contract.status === 'pending' && onContinue
            ? <button type="button" className="primary-action" onClick={startNext}>继续下一方签署</button>
            : contract.status === 'completed' ? <button type="button" className="primary-action" disabled={downloading} onClick={() => void download()}>{downloading ? '下载中…' : '下载最终 PDF'}</button> : null}
        </div>
      </section>
    </main>
  );
}

export function SigningFlow({ session, onBack, onContinue, backLabel = '返回模板设计器' }: {
  session: SigningSession;
  onBack: () => void;
  onContinue?: (session: SigningSession) => void;
  backLabel?: string;
}) {
  const runtimeTemplate = useMemo(() => asJsonRuntimeTemplate(session.template), [session.template]);
  const [preparedTemplate, setPreparedTemplate] = useState(runtimeTemplate);
  const [preparedTableValues, setPreparedTableValues] = useState<ContractTableValue[]>(session.initialTableValues || []);
  const [tableReady, setTableReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setTableReady(false);
    prepareSigningTemplate(runtimeTemplate, session.initialTableValues || [])
      .then(result => { if (!cancelled) { setPreparedTemplate(result.template); setPreparedTableValues(result.tableValues); setTableValues(Object.fromEntries(result.tableValues.map(cell => [`${cell.tableId}:${cell.rowId}:${cell.columnId}`, cell.value]))); setTableReady(true); } })
      .catch(reason => { if (!cancelled) { setError(reason instanceof Error ? reason.message : '字段表格加载失败'); setTableReady(true); } });
    return () => { cancelled = true; };
  }, [runtimeTemplate, session.initialTableValues]);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial = { ...(session.initialValues || {}) };
    session.template.fields.forEach(field => {
      if (field.roleId === session.roleId && field.binding?.sourceId === 'system' && field.binding.fieldId === 'name') initial[field.id] = session.signerName;
    });
    return initial;
  });
  const [signatures, setSignatures] = useState<Record<string, string>>({ ...(session.initialSignatures || {}) });
  const [seals, setSeals] = useState<Record<string, string>>({ ...(session.initialSeals || {}) });
  const [tableValues, setTableValues] = useState<Record<string, string>>(() => Object.fromEntries(
    (session.initialTableValues || []).map(cell => [`${cell.tableId}:${cell.rowId}:${cell.columnId}`, cell.value]),
  ));
  const [invalidFieldIds, setInvalidFieldIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [contract, setContract] = useState<SigningContract | null>(null);
  const [exportingScheme, setExportingScheme] = useState<'html' | null>(null);
  const extensions = useMemo(() => createEditorExtensions(), []);
  const editor = useEditor({ extensions, content: hydrateTemplate(preparedTemplate), editable: false }, [extensions, preparedTemplate]);
  const fields = useMemo(() => Object.fromEntries(preparedTemplate.fields.map(field => [field.id, field])), [preparedTemplate]);
  const role = preparedTemplate.roles?.find(item => item.id === session.roleId);
  const signingFields = preparedTemplate.fields.filter(field => field.roleId === session.roleId && field.type === 'text' && field.binding?.sourceId === 'system' && !field.id.includes(':'));
  const signatureFields = preparedTemplate.fields.filter(field => field.roleId === session.roleId && field.type === 'signature');
  const sealFields = preparedTemplate.fields.filter(field => field.roleId === session.roleId && field.type === 'companySeal');
  const context = useMemo(() => ({
    contractId: session.contractId,
    userId: session.userId,
    roleId: session.roleId,
    fields,
    values,
    signatures,
    seals,
    tableValues,
    invalidFieldIds,
    setValue: (fieldId: string, value: string) => {
      setValues(current => ({ ...current, [fieldId]: value }));
      setInvalidFieldIds(current => { const next = new Set(current); next.delete(fieldId); return next; });
    },
    setSignature: (fieldId: string, value?: string) => {
      setSignatures(current => {
        const next = { ...current };
        if (value) next[fieldId] = value; else delete next[fieldId];
        return next;
      });
      setInvalidFieldIds(current => { const next = new Set(current); if (value) next.delete(fieldId); return next; });
    },
    setSeal: (fieldId: string, value?: string) => {
      setSeals(current => { const next = { ...current }; if (value) next[fieldId] = value; else delete next[fieldId]; return next; });
      setInvalidFieldIds(current => { const next = new Set(current); if (value) next.delete(fieldId); return next; });
    },
    setTableValue: (key: string, value: string) => {
      setTableValues(current => ({ ...current, [key]: value }));
      setInvalidFieldIds(current => { const next = new Set(current); next.delete(key); return next; });
    },
  }), [fields, invalidFieldIds, seals, session.contractId, session.roleId, session.userId, signatures, tableValues, values]);

  if (contract) return <ReceiptView contract={contract} onBack={onBack} onContinue={onContinue} backLabel={backLabel} />;
  if (!editor) return <div className="app-loading">签署页面加载中…</div>;

  const submit = async () => {
    if (submitting) return;
    if (!tableReady) return;
    const invalid = new Set<string>();
    signingFields.forEach(field => { if (!values[field.id]?.trim()) invalid.add(field.id); });
    signatureFields.forEach(field => { if (!signatures[field.id]) invalid.add(field.id); });
    sealFields.forEach(field => { if (!seals[field.id]) invalid.add(field.id); });
    setInvalidFieldIds(invalid);
    if (invalid.size) {
      setError('请完成标红的必填字段和签名区');
      document.querySelector<HTMLElement>(`[data-field-id="${Array.from(invalid)[0]}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const roleValues = Object.fromEntries(signingFields.map(field => [field.id, values[field.id]]));
    const roleSignatures = Object.fromEntries(signatureFields.map(field => [field.id, signatures[field.id]]));
    const roleSeals = Object.fromEntries(sealFields.map(field => [field.id, seals[field.id]]));
    setSubmitting(true); setError('');
    try {
      const editableKeys = new Set(preparedTableValues.filter(cell => cell.editable && cell.roleId === session.roleId).map(cell => `${cell.tableId}:${cell.rowId}:${cell.columnId}`));
      const roleTableValues = Object.entries(tableValues)
        .filter(([key]) => editableKeys.has(key))
        .map(([key, value]) => { const [tableId, rowId, columnId] = key.split(':'); return { tableId, rowId, columnId, value }; });
      const input = { signerName: session.signerName, roleId: session.roleId, userId: session.userId, values: roleValues, signatures: roleSignatures, seals: roleSeals, tableValues: roleTableValues };
      setContract(session.contractId
        ? await continueSigningContract(session.contractId, input)
        : await createSigningContract({ ...input, template: session.template }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '签署提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const exportPdf = async (scheme: 'html') => {
    if (exportingScheme) return;
    setExportingScheme(scheme); setError('');
    try {
      await pdfExportService.exportTemplatePdf(session.template, {
        fields: Object.entries(values).map(([fieldId, value]) => ({ fieldId, value })),
        signatures: Object.entries(signatures).map(([fieldId, dataUrl]) => ({ fieldId, dataUrl })),
        seals: Object.entries(seals).map(([fieldId, dataUrl]) => ({ fieldId, dataUrl })),
        tableValues: preparedTableValues.map(cell => ({ ...cell, value: tableValues[`${cell.tableId}:${cell.rowId}:${cell.columnId}`] || cell.value })),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'PDF 导出失败');
    } finally {
      setExportingScheme(null);
    }
  };

  return (
    <SigningContext.Provider value={context}>
      <div className="signing-shell">
        <header className="signing-header">
          <div><strong>合同签署</strong><span>{session.signerName} · {role?.name}</span></div>
          <div className="signing-header__actions"><button type="button" className="secondary-action" disabled={!!exportingScheme} onClick={() => void exportPdf('html')}>{exportingScheme === 'html' ? '导出中…' : '导出 PDF'}</button><button type="button" className="secondary-action" onClick={onBack}>退出签署</button><button type="button" className="primary-action" disabled={submitting || !tableReady || !!exportingScheme} onClick={() => void submit()}>{submitting ? '提交中…' : '完成本方签署'}</button></div>
        </header>
        {error ? <div className="signing-banner" role="alert">{error}</div> : null}
        {!tableReady ? <div className="signing-banner">字段表格加载中…</div> : null}
        <main className="signing-canvas"><EditorContent editor={editor} /></main>
      </div>
    </SigningContext.Provider>
  );
}
