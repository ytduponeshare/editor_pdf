import { useEffect, useState } from 'react';
import {
  downloadSignedPdf,
  getSigningContract,
  listSigningContracts,
  type SigningContractSummary,
} from '../services/signing';
import { getDemoSigningView } from '../services/demo';
import { sessionFromContract, type SigningSession } from './SigningFlow';

export function ContractRecordsDialog({ onClose, onContinue }: {
  onClose: () => void;
  onContinue: (session: SigningSession) => void;
}) {
  const [contracts, setContracts] = useState<SigningContractSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [continueId, setContinueId] = useState('');
  const [signerName, setSignerName] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    listSigningContracts()
      .then(result => { if (!cancelled) setContracts(result); })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : '合同记录加载失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [retry]);

  const download = async (contract: SigningContractSummary) => {
    if (busyId) return;
    setBusyId(contract.contractId); setError('');
    try { await downloadSignedPdf(contract); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '合同文件下载失败'); }
    finally { setBusyId(''); }
  };

  const continueSigning = async (contract: SigningContractSummary) => {
    const name = signerName.trim();
    const assignment = contract.assignments?.find(item => item.roleId === contract.currentRole?.id);
    if (!name && !assignment) { setError(`请输入${contract.currentRole?.name || '当前角色'}签署人姓名`); return; }
    if (busyId) return;
    setBusyId(contract.contractId); setError('');
    try {
      if (assignment) {
        const view = await getDemoSigningView(contract.contractId, assignment.userId);
        onContinue({ ...sessionFromContract(view, view.currentUser.name), userId: assignment.userId });
      } else {
        const detail = await getSigningContract(contract.contractId);
        onContinue(sessionFromContract(detail, name));
      }
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '合同无法继续签署');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="signed-files-backdrop" role="presentation">
      <section className="signed-files-dialog" role="dialog" aria-modal="true" aria-labelledby="contract-records-title">
        <header><div><h2 id="contract-records-title">合同记录</h2><p>签署中的合同可继续流转，完成后可下载最终文件</p></div><button type="button" aria-label="关闭合同记录" onClick={onClose}>×</button></header>
        {loading ? <p role="status">加载中…</p> : null}
        {error ? <p className="signing-error" role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>重试</button></p> : null}
        {!loading && !contracts.length ? <div className="signed-files-empty">暂无合同记录，完成第一方签署后会出现在这里。</div> : null}
        {contracts.length ? <div className="signed-files-list">{contracts.map(contract => (
          <article key={contract.contractId}>
            <div>
              <strong>{contract.status === 'completed' ? '已完成合同' : `待${contract.currentRole?.name || '下一方'}签署`}</strong>
              <span>{contract.signers.length} / {contract.roleOrder.length} 方已完成 · {new Date(contract.updatedAt).toLocaleString()}</span>
              <span>{contract.signers.map(signer => `${signer.roleName}：${signer.signerName}`).join('；')}</span>
              <small>{contract.contractId}</small>
            </div>
            <div className="signed-files-actions">
              <a href={contract.pdfUrl} target="_blank" rel="noreferrer">查看当前 PDF</a>
              {contract.status === 'completed'
                ? <button type="button" disabled={!!busyId} onClick={() => void download(contract)}>{busyId === contract.contractId ? '下载中…' : '下载最终文件'}</button>
                : <button type="button" onClick={() => { setContinueId(contract.contractId); setSignerName(''); setError(''); }}>继续签署</button>}
            </div>
            {continueId === contract.contractId ? <div className="contract-continue">
              {contract.assignments ? <span>由已分配的演示用户继续签署</span> : <label>{contract.currentRole?.name}签署人姓名<input autoFocus maxLength={50} value={signerName} onChange={event => setSignerName(event.target.value)} /></label>}
              <button type="button" onClick={() => { setContinueId(''); setSignerName(''); }}>取消</button>
              <button type="button" className="primary-action" disabled={!!busyId} onClick={() => void continueSigning(contract)}>{busyId === contract.contractId ? '加载中…' : '进入签署'}</button>
            </div> : null}
          </article>
        ))}</div> : null}
      </section>
    </div>
  );
}

export const SignedFilesDialog = ContractRecordsDialog;
