import { useEffect, useMemo, useState } from 'react';
import { ContractEditor } from '../App';
import type { ContractTemplateSource } from '../editor/types';
import {
  getDemoSigningView,
  getDemoTemplate,
  issueDemoContract,
  listDemoTemplates,
  listDemoUserContracts,
  listDemoUsers,
  saveDemoTemplate,
  type DemoContractSummary,
  type DemoTemplateDetail,
  type DemoTemplateSummary,
  type DemoUser,
} from '../services/demo';
import { SigningFlow, type SigningSession } from './SigningFlow';

type Page =
  | { name: 'admin-templates' }
  | { name: 'standalone-editor' }
  | { name: 'editor'; format: 'html'; template?: DemoTemplateDetail }
  | { name: 'send'; templateId: string }
  | { name: 'user-contracts'; user: DemoUser }
  | { name: 'sign'; user: DemoUser; session: SigningSession };

function DemoHeader({ actor, users, onAdmin, onUser, onEditor }: {
  actor: string;
  users: DemoUser[];
  onAdmin: () => void;
  onEditor: () => void;
  onUser: (user: DemoUser) => void;
}) {
  return <header className="demo-header">
    <div><strong>合同签署流程 Demo</strong><span>模板 → 发送快照 → 分角色签署 → PDF</span></div>
    <nav>
      <button type="button" onClick={onEditor}>本地编辑与签署</button>
      <button type="button" className={actor === 'admin' ? 'is-active' : ''} onClick={onAdmin}>管理员</button>
      {users.map(user => <button key={user.id} type="button" className={actor === user.id ? 'is-active' : ''} onClick={() => onUser(user)}>{user.name}</button>)}
    </nav>
  </header>;
}

function AdminTemplates({ onEdit, onSend }: { onEdit: (format: 'html', template?: DemoTemplateDetail) => void; onSend: (id: string) => void }) {
  const [templates, setTemplates] = useState<DemoTemplateSummary[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    listDemoTemplates().then(result => { if (!cancelled) setTemplates(result); }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : '模板加载失败'); });
    return () => { cancelled = true; };
  }, []);
  const edit = async (id: string) => {
    try { const template = await getDemoTemplate(id); onEdit(template.format, template); } catch (reason) { setError(reason instanceof Error ? reason.message : '模板读取失败'); }
  };
  return <main className="demo-page">
    <div className="demo-page__title"><div><h1>模板列表</h1><p>管理员维护模板，发布后可为两个演示用户分配签署角色。</p></div><div><button type="button" className="primary-action" onClick={() => onEdit('html')}>新建模板</button></div></div>
    {error ? <div className="demo-alert">{error}</div> : null}
    <section className="demo-grid">{templates.map(template => <article className="demo-card" key={template.id} data-template-id={template.id}>
      <div className="demo-card__badge">{template.format.toUpperCase()} · {template.status === 'published' ? '已发布' : '草稿'}</div>
      <h2>{template.name}</h2>
      <p>{template.roles.map(role => role.name).join(' → ') || '未配置角色'}</p>
      <small>{template.fieldCount} 个字段 · {new Date(template.updatedAt).toLocaleString()}</small>
      <div><button type="button" className="secondary-action" onClick={() => void edit(template.id)}>编辑模板</button><button type="button" className="primary-action" onClick={() => onSend(template.id)}>发送合同</button></div>
    </article>)}</section>
  </main>;
}

function SendContract({ templateId, onBack }: { templateId: string; onBack: () => void }) {
  const [template, setTemplate] = useState<DemoTemplateDetail | null>(null);
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  useEffect(() => { Promise.all([getDemoTemplate(templateId), listDemoUsers()]).then(([detail, nextUsers]) => {
    setTemplate(detail); setUsers(nextUsers);
    setAssignments(Object.fromEntries(detail.roles.map((role, index) => [role.id, nextUsers[index % nextUsers.length]?.id || ''])));
  }).catch(reason => setMessage(reason instanceof Error ? reason.message : '发送页面加载失败')); }, [templateId]);
  const send = async () => {
    if (!template || sending) return;
    setSending(true); setMessage('');
    try {
      const result = await issueDemoContract(template.id, template.roles.map(role => ({ roleId: role.id, userId: assignments[role.id] })));
      setMessage(`合同发送成功：${result.contractId}。请切换到对应用户查看。`);
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : '合同发送失败'); }
    finally { setSending(false); }
  };
  return <main className="demo-page demo-page--narrow">
    <button type="button" className="demo-back" onClick={onBack}>← 返回模板列表</button>
    <div className="demo-page__title"><div><h1>发送合同</h1><p>发送时由服务端读取归属记录并固化字段表快照。</p></div></div>
    {message ? <div className="demo-alert">{message}</div> : null}
    {template ? <section className="demo-panel"><h2>{template.name}</h2><div className="demo-flow">{template.roles.map(role => role.name).join(' → ')}</div>
      {template.roles.map(role => <label className="demo-form-row" key={role.id}><span>{role.name}签署用户</span><select value={assignments[role.id] || ''} onChange={event => setAssignments(current => ({ ...current, [role.id]: event.target.value }))}>{users.map(user => <option key={user.id} value={user.id}>{user.name} · {user.title}</option>)}</select></label>)}
      <div className="demo-snapshot-note"><strong>本次发送将固化</strong><span>模板版本、角色分配、员工/归属数据、稳定行 ID。后续业务数据变化不会修改本合同。</span></div>
      <button type="button" className="primary-action demo-submit" disabled={sending} onClick={() => void send()}>{sending ? '正在生成快照…' : '确认发送合同'}</button>
    </section> : <p>加载中…</p>}
  </main>;
}

function UserContracts({ user, onSign }: { user: DemoUser; onSign: (session: SigningSession) => void }) {
  const [contracts, setContracts] = useState<DemoContractSummary[]>([]);
  const [error, setError] = useState('');
  const [loadingId, setLoadingId] = useState('');
  const load = () => listDemoUserContracts(user.id).then(setContracts).catch(reason => setError(reason instanceof Error ? reason.message : '合同加载失败'));
  useEffect(() => {
    let cancelled = false;
    listDemoUserContracts(user.id).then(result => { if (!cancelled) setContracts(result); }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : '合同加载失败'); });
    return () => { cancelled = true; };
  }, [user.id]);
  const enter = async (contract: DemoContractSummary) => {
    setLoadingId(contract.contractId); setError('');
    try {
      const view = await getDemoSigningView(contract.contractId, user.id);
      onSign({
        contractId: view.contractId, userId: user.id, signerName: user.name, roleId: view.currentRole!.id,
        template: view.template,
        initialValues: Object.fromEntries(view.fields.map(field => [field.fieldId, field.value])),
        initialSignatures: Object.fromEntries(view.signatures.map(item => [item.fieldId, item.dataUrl])),
        initialSeals: Object.fromEntries(view.seals.map(item => [item.fieldId, item.dataUrl])),
        initialTableValues: view.tableValues,
      });
    } catch (reason) { setError(reason instanceof Error ? reason.message : '合同无法打开'); }
    finally { setLoadingId(''); }
  };
  return <main className="demo-page">
    <div className="demo-page__title"><div><h1>{user.name}的合同</h1><p>{user.title} · 这里只展示发送时分配给当前用户的合同。</p></div><button type="button" className="secondary-action" onClick={load}>刷新</button></div>
    {error ? <div className="demo-alert">{error}</div> : null}
    {!contracts.length ? <div className="demo-empty">暂无合同，请先切换到管理员发送合同。</div> : <section className="demo-list">{contracts.map(contract => {
      const assigned = contract.currentRole && contract.assignments.some(item => item.roleId === contract.currentRole!.id && item.userId === user.id);
      return <article key={contract.contractId}><div><span className={`demo-status demo-status--${contract.status}`}>{contract.status === 'completed' ? '已完成' : assigned ? '待我签署' : `等待${contract.currentRole?.name}签署`}</span><h2>{contract.templateName}</h2><p>{contract.signers.length} / {contract.roleOrder.length} 方完成 · {new Date(contract.updatedAt).toLocaleString()}</p><small>{contract.contractId}</small></div><div className="demo-list__actions"><a className="secondary-action" href={contract.pdfUrl} target="_blank" rel="noreferrer">查看当前 PDF</a>{assigned ? <button type="button" className="primary-action" disabled={!!loadingId} onClick={() => void enter(contract)}>{loadingId === contract.contractId ? '加载中…' : '进入签署'}</button> : null}</div></article>;
    })}</section>}
  </main>;
}

export function DemoPortal() {
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [page, setPage] = useState<Page>({ name: 'admin-templates' });
  useEffect(() => { void listDemoUsers().then(setUsers); }, []);
  const actor = page.name === 'user-contracts' || page.name === 'sign' ? page.user.id : 'admin';
  const content = useMemo(() => {
    if (page.name === 'standalone-editor') return <ContractEditor onBack={() => setPage({ name: 'admin-templates' })} />;
    if (page.name === 'editor') return <ContractEditor key={page.template?.id || `new-${page.format}`} initialTemplate={page.template?.template} templateId={page.template?.id} templateName={page.template?.name} onBack={() => setPage({ name: 'admin-templates' })} onSaved={async (name: string, template: ContractTemplateSource, id?: string) => { await saveDemoTemplate(name, template, id); setPage({ name: 'admin-templates' }); }} />;
    if (page.name === 'send') return <SendContract templateId={page.templateId} onBack={() => setPage({ name: 'admin-templates' })} />;
    if (page.name === 'user-contracts') return <UserContracts user={page.user} onSign={session => setPage({ name: 'sign', user: page.user, session })} />;
    if (page.name === 'sign') return <SigningFlow session={page.session} backLabel="返回合同列表" onBack={() => setPage({ name: 'user-contracts', user: page.user })} />;
    return <AdminTemplates onEdit={(format, template) => setPage({ name: 'editor', format, template })} onSend={templateId => setPage({ name: 'send', templateId })} />;
  }, [page]);
  if (page.name === 'editor' || page.name === 'sign' || page.name === 'standalone-editor') return content;
  return <div className="demo-shell"><DemoHeader onEditor={() => setPage({ name: 'standalone-editor' })} actor={actor} users={users} onAdmin={() => setPage({ name: 'admin-templates' })} onUser={user => setPage({ name: 'user-contracts', user })} />{content}</div>;
}
