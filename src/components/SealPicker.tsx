import { useEffect, useState } from 'react';
import { listAvailableDemoSeals, type DemoLibraryItem } from '../services/demo';
import { SealUpload } from './SealUpload';

export function SealPicker({ contractId, userId, value, invalid, onChange }: {
  contractId?: string;
  userId?: string;
  value?: string;
  invalid?: boolean;
  onChange: (value?: string) => void;
}) {
  const [seals, setSeals] = useState<DemoLibraryItem[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!contractId || !userId) return undefined;
    let cancelled = false;
    listAvailableDemoSeals(contractId, userId).then(items => { if (!cancelled) setSeals(items); }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : '印章库加载失败'); });
    return () => { cancelled = true; };
  }, [contractId, userId]);
  if (!contractId || !userId) return <SealUpload value={value} invalid={invalid} onChange={onChange} />;
  return <div className={`seal-picker${invalid ? ' is-invalid' : ''}`}>
    {value ? <img src={value} alt="已选择企业章" /> : null}
    {seals.length ? <select aria-label="选择企业印章" value={seals.find(item => item.dataUrl === value)?.id || ''} onChange={event => onChange(seals.find(item => item.id === event.target.value)?.dataUrl)}>
      <option value="">请选择企业印章</option>
      {seals.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select> : <span>{error || '当前角色没有可用印章'}</span>}
  </div>;
}
