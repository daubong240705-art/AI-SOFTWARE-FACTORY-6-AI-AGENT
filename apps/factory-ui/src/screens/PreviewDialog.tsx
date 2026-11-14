import { useEffect, useId, useRef, useState } from 'react';
import { ExternalLink, Play, RotateCw, Square } from 'lucide-react';
import type { PreviewStatus } from '@/api/readModels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/Dialog';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import type { Store } from '@/state/store';

const BUSY = new Set(['preparing', 'installing', 'starting']);
const TONE: Record<PreviewStatus['state'], string> = { stopped: 'text-muted-foreground', preparing: 'text-info', installing: 'text-info', starting: 'text-info', running: 'text-ok', failed: 'text-destructive' };

/** Starts the project from its latest integrated code and shows the link. Everything shown is plain text from the Host. */
export function PreviewDialog({ store, projectId, onClose }: { store: Store; projectId: string; onClose: () => void }) {
  const t = useT(); const titleId = useId();
  const [status, setStatus] = useState<PreviewStatus | null>(null);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  const log = useRef<HTMLPreElement>(null);
  const load = async (action?: 'start' | 'stop') => {
    setPending(true); setError(false);
    try {
      const result = action === 'start' ? await store.startPreview(projectId) : action === 'stop' ? await store.stopPreview(projectId) : await store.getPreview(projectId);
      setStatus(result.preview);
    } catch { setError(true); } finally { setPending(false); }
  };
  useEffect(() => { void load(); }, [projectId]);
  // Poll while something is happening or running (a crash shows up without a click).
  useEffect(() => {
    if (!status || status.state === 'stopped' || status.state === 'failed') return;
    const handle = window.setInterval(() => { void store.getPreview(projectId).then(result => setStatus(result.preview), () => undefined); }, BUSY.has(status.state) ? 1500 : 4000);
    return () => window.clearInterval(handle);
  }, [status?.state, projectId]);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [status?.log]);
  const state = status?.state ?? 'stopped';
  const openUrl = status?.viewUrl ?? status?.url;
  return <Dialog labelledBy={titleId} onClose={onClose}>
    <div className="space-y-4">
      <header className="space-y-1"><h2 id={titleId} className="font-display text-xl font-semibold">{t('previewUi.title')}</h2><p className="text-sm text-muted-foreground">{t('previewUi.help')}</p></header>
      <div className="flex flex-wrap items-center gap-3"><Badge variant="outline" className={cn('gap-1.5 font-normal', TONE[state])}><span aria-hidden="true" className="size-1.5 rounded-full bg-current" />{t(`previewUi.states.${state}`)}</Badge>
        {status?.sha && <span className="font-mono text-xs text-muted-foreground">{status.sha.slice(0, 8)}</span>}</div>
      {status?.message && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm [overflow-wrap:anywhere]">{status.message}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{t('previewUi.error')}</p>}
      {state === 'running' && openUrl && <a href={openUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary px-4 py-2 text-sm font-medium hover:bg-secondary/70"><ExternalLink className="size-4" aria-hidden="true" />{t('previewUi.open')}</a>}
      {!!status?.log && <pre ref={log} aria-label={t('previewUi.log')} className="max-h-56 overflow-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]">{status.log}</pre>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" onClick={onClose}>{t('previewUi.close')}</Button>
        {state !== 'stopped' && <Button type="button" variant="outline" disabled={pending} onClick={() => { void load('stop'); }}><Square className="size-4" aria-hidden="true" />{t('previewUi.stop')}</Button>}
        <Button type="button" disabled={pending || BUSY.has(state)} onClick={() => { void load('start'); }}>{state === 'running' || state === 'failed' ? <RotateCw className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}{t(state === 'running' || state === 'failed' ? 'previewUi.restart' : 'previewUi.start')}</Button>
      </div>
    </div>
  </Dialog>;
}
