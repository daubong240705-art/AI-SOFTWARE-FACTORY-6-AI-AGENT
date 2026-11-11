import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { cn } from '@/lib/utils';

export function TextPreview({ data, type }: { data: ArrayBuffer; type: string }) {
  const [text, setText] = useState('');
  useEffect(() => { setText(new TextDecoder().decode(data).slice(0, 100_000)); }, [data]);
  if (type === 'json') { try { return <pre className="max-h-[65dvh] overflow-auto rounded-lg border border-border bg-muted/30 p-4 font-mono text-xs leading-6 whitespace-pre-wrap">{JSON.stringify(JSON.parse(text), null, 2)}</pre>; } catch { return <pre className="max-h-[65dvh] overflow-auto rounded-lg border border-border bg-muted/30 p-4 font-mono text-xs leading-6 whitespace-pre-wrap">{text}</pre>; } }
  if (type === 'md') return <article className="prose prose-invert max-w-3xl text-sm leading-7"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{text}</ReactMarkdown></article>;
  return <pre className={cn('max-h-[65dvh] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-4 text-sm leading-7', type === 'txt' && 'font-sans')}>{text}</pre>;
}
