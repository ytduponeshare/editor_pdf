import { useEffect, useState } from 'react';
import { listDemoSignatures, saveDemoSignature, type DemoLibraryItem } from '../services/demo';
import { SignaturePad } from './SignaturePad';

export function SignatureChooser({ userId, value, invalid, onChange }: {
  userId?: string;
  value?: string;
  invalid?: boolean;
  onChange: (value?: string) => void;
}) {
  const [library, setLibrary] = useState<DemoLibraryItem[]>([]);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    listDemoSignatures(userId).then(items => { if (!cancelled) setLibrary(items); }).catch(() => { if (!cancelled) setMessage('签名库加载失败，可直接手写'); });
    return () => { cancelled = true; };
  }, [userId]);
  const save = async () => {
    if (!userId || !value || saving) return;
    setSaving(true); setMessage('');
    try {
      await saveDemoSignature(userId, value);
      setLibrary(await listDemoSignatures(userId));
      setMessage('已保存到我的签名库');
    } catch (error) { setMessage(error instanceof Error ? error.message : '签名保存失败'); }
    finally { setSaving(false); }
  };
  return <div className="signature-chooser">
    {library.length ? <select aria-label="从签名库选择" value={library.find(item => item.dataUrl === value)?.id || ''} onChange={event => onChange(library.find(item => item.id === event.target.value)?.dataUrl)}>
      <option value="">现场手写</option>
      {library.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select> : null}
    <SignaturePad value={value} invalid={invalid} onChange={onChange} />
    {userId && value ? <button type="button" className="signature-save" disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '存入签名库'}</button> : null}
    {message ? <small>{message}</small> : null}
  </div>;
}
