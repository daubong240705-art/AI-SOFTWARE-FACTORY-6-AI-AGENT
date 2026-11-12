import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ExtractionText } from '@/api/documents';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import type { ExtractionTarget } from '../useExtraction';

export type TextJump = { offset: number; sequence: number };
const CHUNK_SIZE = 8000;

function textSegments(text: string) {
  const segments: { text: string; offset: number; end: number; page?: string }[] = [];
  let offset = 0;
  for (const match of text.matchAll(/^<!-- (?:page (\d+)|Slide number: (\d+)) -->[ \t]*(?:\r?\n|$)/gm)) {
    segments.push({ text: text.slice(offset, match.index), offset, end: match.index });
    offset = match.index + match[0].length;
    segments.push({ text: '', page: match[1] ?? match[2] ?? '', offset: match.index, end: offset });
  }
  segments.push({ text: text.slice(offset), offset, end: text.length });
  return segments;
}

export function AgentReadText({ store, projectId, artifactId, version, active, jump }: ExtractionTarget & { active: boolean; jump: TextJump | null }) {
  const t = useT();
  const [chunks, setChunks] = useState<ExtractionText[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const chunksRef = useRef(chunks);
  const request = useRef(0);
  const lastJump = useRef<number | null>(null);
  const requested = useRef(false);
  const retry = useRef({ from: 0, replace: true });
  const scroller = useRef<HTMLPreElement>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const load = useCallback(async (from: number, replace: boolean) => {
    const token = ++request.current;
    requested.current = true; retry.current = { from, replace };
    setBusy(true); setError(false);
    if (replace) { chunksRef.current = []; setChunks([]); }
    try {
      const result = await store.getExtractionText(projectId, artifactId, version, from, CHUNK_SIZE);
      if (request.current !== token) return;
      const updated = replace ? [result] : [...chunksRef.current, result];
      chunksRef.current = updated; setChunks(updated);
    } catch { if (request.current === token) setError(true); }
    finally { if (request.current === token) setBusy(false); }
  }, [store, projectId, artifactId, version]);
  useEffect(() => () => { request.current++; requested.current = false; }, []);
  useEffect(() => {
    if (!active) return;
    if (jump && lastJump.current !== jump.sequence) {
      lastJump.current = jump.sequence;
      const loaded = chunksRef.current.some(chunk => chunk.from <= jump.offset && jump.offset < (chunk.next ?? chunk.total));
      if (!loaded) void load(Math.floor(jump.offset / CHUNK_SIZE) * CHUNK_SIZE, true);
    } else if (!requested.current) void load(0, true);
  }, [active, jump, load]);
  useLayoutEffect(() => {
    const container = scroller.current; const target = anchor.current;
    if (active && !busy && jump && container && target) {
      container.scrollTop += target.getBoundingClientRect().top - container.getBoundingClientRect().top - 16;
    }
  }, [active, busy, chunks, jump]);
  const first = chunks[0]; const last = chunks.at(-1);
  const text = chunks.map(chunk => chunk.text).join('');
  const offset = jump && first ? jump.offset - first.from : -1;
  const segments = textSegments(text);
  return <div className="space-y-4">
    <p className="text-sm leading-6 text-muted-foreground">{t('knowledgeUi.extraction.agentReadHelp')}</p>
    <pre ref={scroller} role="region" aria-label={t('knowledgeUi.extraction.textTab')} aria-busy={busy} tabIndex={0} className="max-h-[55dvh] min-h-32 overflow-auto rounded-xl border border-border bg-background p-4 font-mono text-xs leading-6 whitespace-pre-wrap [overflow-wrap:anywhere]">
      {segments.map((segment, index) => {
        const contains = offset >= segment.offset && (offset < segment.end || index === segments.length - 1 && offset === segment.end);
        if (segment.page !== undefined) return <span key={segment.offset} ref={contains ? anchor : undefined} className="my-4 flex items-center gap-3 text-muted-foreground"><Separator asChild className="flex-1"><span /></Separator><span>{t('knowledgeUi.extraction.pageMarker').replace('{page}', segment.page)}</span><Separator asChild className="flex-1"><span /></Separator></span>;
        const at = offset - segment.offset;
        return <Fragment key={`text-${segment.offset}`}>{contains ? <>{segment.text.slice(0, at)}<span ref={anchor}>{segment.text.slice(at)}</span></> : segment.text}</Fragment>;
      })}
    </pre>
    {error && <Alert className="border-border"><AlertDescription className="space-y-2"><p>{t('knowledgeUi.extraction.textError')}</p><Button variant="outline" size="sm" onClick={() => { void load(retry.current.from, retry.current.replace); }}>{t('errors.retry')}</Button></AlertDescription></Alert>}
    <div className="flex flex-wrap items-center gap-2">
      {busy && <Spinner aria-label={t('knowledgeUi.extraction.loadingText')} className="text-muted-foreground" />}
      {last && last.next !== null && <Button variant="outline" size="sm" disabled={busy} onClick={() => { void load(last.next!, false); }}>{t('knowledgeUi.extraction.loadMore')}</Button>}
      {first && first.from > 0 && <Button variant="ghost" size="sm" disabled={busy} onClick={() => { scroller.current?.scrollTo({ top: 0 }); void load(0, true); }}>{t('knowledgeUi.extraction.readStart')}</Button>}
    </div>
  </div>;
}
