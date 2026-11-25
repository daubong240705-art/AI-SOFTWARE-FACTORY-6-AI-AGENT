import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Copy, ImageOff } from 'lucide-react';

export type Lang = 'vi' | 'en';
export const text = (lang: Lang, vi: string, en: string) => lang === 'vi' ? vi : en;
export const repo = 'https://github.com/daubong240705-art/AI-SOFTWARE-FACTORY-6-AI-AGENT';
export const demo = 'http://192.168.1.14:8790/';

export function Mochi({ role = 'LEAD', className = '' }: { role?: string; className?: string }) {
  return <img src={`/mascot/${role}.svg`} className={`mochi ${className}`} alt="" aria-hidden="true" />;
}

export function External({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className={className}>{children}<ArrowUpRight size={16} aria-hidden="true" /></a>;
}

export async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const previous = document.activeElement;
    const field = document.createElement('textarea');
    field.className = 'clipboard-field';
    field.value = value;
    field.readOnly = true;
    document.body.append(field);
    field.select();
    try {
      if (!document.execCommand('copy')) throw new Error('Copy unavailable');
    } finally {
      field.remove();
      if (previous instanceof HTMLElement) previous.focus();
    }
  }
}

export function CopyButton({ value, lang }: { value: string; lang: Lang }) {
  const [result, setResult] = useState<'copied' | 'failed' | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return <button type="button" className="copy-button" onClick={async () => {
    try { await copyText(value); setResult('copied'); }
    catch { setResult('failed'); }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setResult(null), 2500);
  }}>
    {result === 'copied' ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
    <span aria-live="polite">{result === 'copied' ? text(lang, 'Đã sao chép', 'Copied') : result === 'failed' ? text(lang, 'Lỗi sao chép', 'Copy failed') : text(lang, 'Sao chép', 'Copy')}</span>
  </button>;
}

export function CodeBlock({ value, lang, label = 'Bash' }: { value: string; lang: Lang; label?: string }) {
  return <div className="code-block">
    <div className="code-bar"><span>{label}</span><CopyButton value={value} lang={lang} /></div>
    <pre tabIndex={0}><code>{value}</code></pre>
  </div>;
}

export function Screenshot({ name, caption, lang, hero = false }: { name: string; caption: string; lang: Lang; hero?: boolean }) {
  const localized = (name === 'workflow' || name === 'office') && lang === 'vi';
  const sources = localized ? [`${name}.vi`, name] : [name];
  const [failed, setFailed] = useState(0);
  return <figure className={`browser-frame ${hero ? 'hero-screen' : ''}`}>
    <figcaption className="browser-bar"><span className="browser-dots" aria-hidden="true"><i /><i /><i /></span><span>{hero ? `Factory / ${caption}` : caption}</span></figcaption>
    {failed < sources.length ? <img key={sources[failed]} src={`/images/${sources[failed]}.png`} alt={caption} loading={hero ? 'eager' : 'lazy'} onError={() => setFailed(failed + 1)} /> :
      <div className="screen-placeholder"><ImageOff size={25} aria-hidden="true" /><span>{text(lang, 'Chưa có ảnh giao diện', 'Screenshot not available yet')}</span></div>}
  </figure>;
}
