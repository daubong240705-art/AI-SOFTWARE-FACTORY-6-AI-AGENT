import { useEffect, useId, useRef, useState } from 'react';
import type { ReleaseView, ReleasesResponse } from '@factory/contracts';
import type { WorkflowDetail, WorkflowInstance } from '@/api/readModels';
import { Dialog } from '@/components/Dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { i18n, useT } from '@/i18n';
import type { Store } from '@/state/store';
import { PreviewDialog } from './PreviewDialog';
import { M5Status } from './M5Shared';

type Confirmation = { kind: 'publish' } | { kind: 'rollback'; version: number };
type Action = Confirmation | { kind: 'reconcile'; releaseId: string };
const tone: Record<ReleaseView['state'], string> = { pending: 'text-info', done: 'text-ok', failed: 'text-destructive', unknown: 'text-need' };

function buildStage(detail: WorkflowDetail | undefined) {
  const stages = detail?.stages ?? [];
  const current = stages.filter(stage => ['active', 'ready', 'failed', 'blocked'].includes(stage.state));
  const last = stages.findLast(stage => ['done', 'skipped', 'cancelled'].includes(stage.state));
  return (current.length ? current : last ? [last] : stages.slice(0, 1)).map(stage => ({ ...stage,
    title: detail?.graph?.stages.find(item => item.key === stage.key)?.title || stage.key,
  }));
}

export function GamePanel({ store, projectId, gameName, workflow, releaseOnly = false }: { store: Store; projectId: string; gameName: string; workflow: WorkflowInstance; releaseOnly?: boolean }) {
  const t = useT(); const id = useId();
  const detail = store.useStoreSelector(state => state.m5.workflowDetails[workflow.id]);
  const [data, setData] = useState<ReleasesResponse | null>(null);
  const [loadError, setLoadError] = useState(false); const [actionError, setActionError] = useState(false);
  const [refresh, setRefresh] = useState(0); const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false); const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const inFlight = useRef(false); const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let disposed = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    let delay = 20_000;
    async function load() {
      try {
        const result = await store.listReleases(projectId, controller.signal);
        if (disposed) return;
        setData(result); setLoadError(false);
        delay = result.releases.some(release => release.state === 'pending') ? 3000 : 20_000;
      } catch { if (!disposed) setLoadError(true); }
      if (!disposed) timer = setTimeout(() => { void load(); }, delay);
    }
    void load();
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [store, projectId, refresh]);

  async function execute(action: Action) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setActionError(false);
    try {
      if (action.kind === 'publish') await store.publishGame(projectId);
      else if (action.kind === 'rollback') await store.rollbackRelease(projectId, action.version);
      else await store.reconcileRelease(projectId, action.releaseId);
    } catch { if (mounted.current) setActionError(true); }
    finally {
      inFlight.current = false;
      if (mounted.current) { setBusy(false); setConfirmation(null); setRefresh(value => value + 1); }
    }
  }

  const releases = [...(data?.releases ?? [])].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const newestDone = releases.find(release => release.kind === 'publish' && release.state === 'done');
  const allowed = data?.enabled === true && data.canPublish.allowed && !loadError;
  const stages = buildStage(detail);
  return <Card className="gap-0 rounded-xl border-border py-0 shadow-none" aria-labelledby={id}>
    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 p-5">
      <h2 id={id} className="font-display text-lg font-semibold">{t('gameUi.panelTitle')}</h2>
      <div className="flex flex-wrap items-center gap-2">{!releaseOnly && <Button type="button" variant="outline" onClick={() => setPreview(true)}>{t('previewUi.button')}</Button>}
        <Button type="button" disabled={!allowed || busy} aria-describedby={!allowed ? `${id}-publish-reason` : undefined} onClick={() => setConfirmation({ kind: 'publish' })}>{t('gameUi.publish')}</Button>
        {!allowed && <span id={`${id}-publish-reason`} className="max-w-xl text-sm text-muted-foreground [overflow-wrap:anywhere]">{data?.enabled === false ? t('gameUi.publishingDisabled') : loadError ? t('gameUi.loadError') : data ? data.canPublish.reason ?? t('gameUi.publishUnavailable') : t('viewStates.loading')}</span>}
      </div>
    </CardHeader>
    <CardContent className="space-y-4 px-5 pb-5">
      {!releaseOnly && <dl className="grid gap-2 text-sm"><div className="flex flex-wrap items-center gap-2"><dt className="text-muted-foreground">{t('gameUi.buildStatus')}</dt><dd><M5Status value={detail?.state ?? workflow.state} /></dd></div>
        <div className="flex flex-wrap gap-x-2"><dt className="text-muted-foreground">{t('gameUi.buildStage')}</dt><dd className="space-y-1 [overflow-wrap:anywhere]">{stages.length ? stages.map(stage => <div key={stage.key} className="flex flex-wrap items-center gap-2"><span>{stage.title}</span><M5Status value={stage.state} /></div>) : t('workflowUi.noStages')}</dd></div>
      </dl>}
      {actionError && <p role="alert" className="text-sm text-destructive">{t('gameUi.actionError')}</p>}
      {loadError && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive"><span>{t('gameUi.loadError')}</span><Button type="button" variant="outline" size="sm" onClick={() => setRefresh(value => value + 1)}>{t('errors.retry')}</Button></div>}
      {!data && !loadError && <p role="status" className="text-sm text-muted-foreground">{t('viewStates.loading')}</p>}
      {data?.enabled && <section aria-labelledby={`${id}-releases`} className="space-y-3 border-t border-border pt-4">
        <h3 id={`${id}-releases`} className="text-sm font-medium">{t('gameUi.releases')}</h3>
        {!releases.length && <p className="text-sm text-muted-foreground">{t('gameUi.noReleases')}</p>}
        <ul className="m-0 list-none space-y-3 p-0">{releases.map(release => <li key={release.id} className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>{t('gameUi.version').replace('{version}', release.version === null ? t('gameUi.unassignedVersion') : String(release.version))}</span>
            <span>{t(`gameUi.kinds.${release.kind}`)}</span>
            <Badge variant="outline" className={tone[release.state]}>{t(`gameUi.states.${release.state}`)}</Badge>
            {release.commitSha && <span className="font-mono text-xs" title={release.commitSha}>{release.commitSha.slice(0, 8)}</span>}
            <time dateTime={release.completedAt ?? release.createdAt} className="text-xs text-muted-foreground">{new Date(release.completedAt ?? release.createdAt).toLocaleString(i18n.locale)}</time>
            {release.kind === 'publish' && release.state === 'done' && release.playUrl && /^https?:\/\//i.test(release.playUrl) && <a href={release.playUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4">{t('gameUi.openGame')}</a>}
          </div>
          {(release.state === 'failed' || release.state === 'unknown') && <p className="text-sm text-destructive whitespace-pre-wrap [overflow-wrap:anywhere]">{release.error ?? t('gameUi.noReleaseError')}</p>}
          {release.state === 'unknown' && <div className="flex flex-wrap items-center gap-2"><p className="text-sm text-muted-foreground">{t('gameUi.reconcileHelp')}</p><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { void execute({ kind: 'reconcile', releaseId: release.id }); }}>{t('gameUi.reconcile')}</Button></div>}
          {release.kind === 'publish' && release.state === 'done' && release.id !== newestDone?.id && release.version !== null && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { if (release.version !== null) setConfirmation({ kind: 'rollback', version: release.version }); }}>{t('gameUi.rollback')}</Button>}
        </li>)}</ul>
      </section>}
    </CardContent>
    {preview && <PreviewDialog store={store} projectId={projectId} onClose={() => setPreview(false)} />}
    {confirmation && <Dialog labelledBy={`${id}-confirm`} onClose={() => { if (!inFlight.current) setConfirmation(null); }}>
      <DialogHeader><DialogTitle id={`${id}-confirm`}>{t(confirmation.kind === 'publish' ? 'gameUi.publishConfirm' : 'gameUi.rollbackConfirm').replace('{game}', gameName).replace('{version}', confirmation.kind === 'rollback' ? String(confirmation.version) : '')}</DialogTitle></DialogHeader>
      <DialogFooter><Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirmation(null)}>{t('actions.cancel')}</Button><Button type="button" disabled={busy || (confirmation.kind === 'publish' && !allowed)} onClick={() => { void execute(confirmation); }}>{t(confirmation.kind === 'publish' ? 'gameUi.publish' : 'gameUi.rollback')}</Button></DialogFooter>
    </Dialog>}
  </Card>;
}
