import { useState } from 'react';

export function SealUpload({ value, invalid, onChange }: { value?: string; invalid?: boolean; onChange: (value?: string) => void }) {
  const [error, setError] = useState('');
  const choose = (file?: File) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml'].includes(file.type)) { setError('企业章只支持 SVG、PNG 或 JPG'); return; }
    if (file.size > 2 * 1024 * 1024) { setError('企业章图片不能超过 2MB'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (file.type === 'image/svg+xml' && /<\/?script[\s>]|foreignObject|\son[a-z]+\s*=/i.test(result)) { setError('SVG 包含不安全内容'); return; }
      setError(''); onChange(result);
    };
    reader.onerror = () => setError('企业章读取失败');
    reader.readAsDataURL(file);
  };
  return <div className={`seal-upload${invalid ? ' is-invalid' : ''}`}>
    {value ? <img src={value} alt="企业章预览" /> : <span>上传企业章</span>}
    <input type="file" accept="image/svg+xml,image/png,image/jpeg" aria-label="上传企业章" onChange={event => { choose(event.target.files?.[0]); event.currentTarget.value = ''; }} />
    {value ? <button type="button" onClick={() => onChange(undefined)}>清空</button> : null}
    {error ? <small role="alert">{error}</small> : null}
  </div>;
}
