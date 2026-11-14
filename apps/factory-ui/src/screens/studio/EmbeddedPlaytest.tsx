import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Maximize2, Play, Square } from 'lucide-react';
import type { PreviewStatus } from '@/api/readModels';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';

const preparing = new Set(['preparing', 'installing', 'starting']);
export function EmbeddedPlaytest({ store, projectId, gameName }: { store: Store; projectId: string; gameName: string }) {
  const t = useT();
  const [status, setStatus] = useState<PreviewStatus | null>(null);
  const [error, setError] = useState(false); const [actionError, setActionError] = useState(false); const [fullscreenError, setFullscreenError] = useState(false);
  const [pending, setPending] = useState(false); const [revision, setRevision] = useState(0);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const frame = useRef<HTMLDivElement>(null); const action = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; action.current?.abort(); };
  }, []);
  useEffect(() => {
    if (pending) return;
    let disposed = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    async function poll() {
      let delay: number | false = 4000;
      try {
        const result = await store.getPreview(projectId, controller.signal);
        if (disposed) return;
        setStatus(result.preview); setError(false);
        delay = preparing.has(result.preview.state) ? 1500 : ['stopped', 'failed'].includes(result.preview.state) ? false : 4000;
      } catch { if (!disposed) setError(true); }
      if (!disposed && delay !== false) timer = setTimeout(() => { void poll(); }, delay);
    }
    void poll();
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [store, projectId, pending, revision]);

  async function execute(kind: 'start' | 'stop') {
    if (action.current) return;
    const controller = new AbortController(); action.current = controller;
    setPending(true); setError(false); setActionError(false); setLoadedUrl(null);
    try {
      const result = kind === 'start' ? await store.startPreview(projectId, controller.signal) : await store.stopPreview(projectId, controller.signal);
      if (mounted.current) setStatus(result.preview);
    } catch { if (mounted.current) setActionError(true); }
    finally { action.current = null; if (mounted.current) setPending(false); }
  }
  async function fullscreen() {
    setFullscreenError(false);
    try { await frame.current?.requestFullscreen(); }
    catch { if (mounted.current) setFullscreenError(true); }
  }
  const state = status?.state;
  const url = state === 'running' ? status?.viewUrl ?? null : null;
  const loading = !status && !error || pending || !!state && preparing.has(state);
  return <Card className="min-w-0 gap-4 p-4 sm:p-5">
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled={pending || !status || !!state && preparing.has(state) || state === 'running'} onClick={() => { void execute('start'); }}><Play aria-hidden="true" />{t('studioUi.run')}</Button>
      <Button variant="outline" disabled={pending || !status || state === 'stopped'} onClick={() => { void execute('stop'); }}><Square aria-hidden="true" />{t('previewUi.stop')}</Button>
      <span role="status" className="text-sm">{state ? <Badge variant="outline">{t(`previewUi.states.${state}`)}</Badge> : t('viewStates.loading')}</span>
      {url && <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-primary underline"><ExternalLink className="size-4" aria-hidden="true" />{t('studioUi.openTab')}</a>}
      <Button variant="outline" disabled={!url} onClick={() => { void fullscreen(); }}><Maximize2 aria-hidden="true" />{t('studioUi.fullscreen')}</Button>
    </div>
    {(error || actionError) && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive"><p>{t('previewUi.error')}</p><Button variant="outline" disabled={pending} onClick={() => { setActionError(false); setRevision(value => value + 1); }}>{t('errors.retry')}</Button></div>}
    {fullscreenError && <p role="alert" className="text-sm text-destructive">{t('studioUi.fullscreenError')}</p>}
    {status?.message && <p role="status" className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{status.message}</p>}
    <div ref={frame} className="relative aspect-[16/10] min-h-[520px] w-full overflow-hidden rounded-lg border border-border bg-background max-sm:aspect-[3/4] fullscreen:h-screen fullscreen:w-screen">
      {url && <iframe key={url} src={url} title={t('studioUi.frameTitle').replace('{game}', gameName)} onLoad={() => setLoadedUrl(url)} className="absolute inset-0 size-full border-0" />}
      {(loading || url && loadedUrl !== url) && <div role="status" className="pointer-events-none absolute inset-0 grid place-items-center bg-background/80 p-5 text-center">{t('studioUi.previewLoading')}</div>}
      {!url && !loading && <p className="absolute inset-0 grid place-items-center p-5 text-center text-sm text-muted-foreground">{t('studioUi.previewEmpty')}</p>}
    </div>
    {state === 'failed' && !!status?.log && <pre aria-label={t('previewUi.log')} className="max-h-56 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">{status.log}</pre>}
  </Card>;
}
