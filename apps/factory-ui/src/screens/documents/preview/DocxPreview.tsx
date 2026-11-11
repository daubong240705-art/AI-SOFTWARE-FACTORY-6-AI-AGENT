import { useEffect, useState } from 'react';

export function DocxPreview({ data }: { data: ArrayBuffer }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => { let active = true; void import('mammoth').then(({ default: mammoth }) => mammoth.convertToHtml({ arrayBuffer: data })).then(result => { if (active) setHtml(result.value.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')); }).catch(() => setHtml(null)); return () => { active = false; }; }, [data]);
  if (!html) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  const srcDoc = `<!doctype html><meta charset="utf-8"><style>body{font:15px sans-serif;line-height:1.7;color:#222;max-width:760px;margin:24px auto;padding:0 20px}img{max-width:100%}</style>${html}`;
  return <iframe title="Document preview" sandbox="" srcDoc={srcDoc} className="h-[65dvh] w-full rounded-lg border border-border bg-white" />;
}
