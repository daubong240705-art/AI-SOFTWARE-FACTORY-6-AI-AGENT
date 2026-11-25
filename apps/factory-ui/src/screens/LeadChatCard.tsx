import { useCallback, useEffect, useReducer, useState } from 'react';
import { FLOW_RUN_TRANSITIONS, type LeadCard } from '@factory/contracts';
import { createApiClient } from '@/api/client';
import { flowCommand } from '@/api/commands';
import { openProjectEvents } from '@/api/events';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { baseUrl, FlowDialog, FlowError, useRead, useFlowWrite } from './flows/shared';
import { artifactHash, viewHash } from './shell/navigation';

const link = 'font-medium underline underline-offset-4 [overflow-wrap:anywhere]';

export function useLeadRunUpdates(projectId: string, runIds: string) {
  const [epoch, reconnect] = useReducer(value => value + 1, 0);
  const [revisions, setRevisions] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!runIds) return;
    const watched = new Set(runIds.split(','));
    const stream = openProjectEvents({ projectId, baseUrl, onSnapshotRequired: reconnect, onEvent: ({ payload }) => {
      if (payload.type !== 'entity.changed' || payload.entity.kind !== 'flow-run' || !watched.has(payload.entity.id)) return;
      const { id, revision } = payload.entity;
      setRevisions(current => current[id] === revision ? current : { ...current, [id]: revision });
    } });
    return stream.close;
  }, [projectId, runIds, epoch]);
  return { revisions, epoch };
}

function RunCard({ projectId, card, refreshKey }: { projectId: string; card: Extract<LeadCard, { kind: 'run' }>; refreshKey: number }) {
  const t = useT();
  const [api] = useState(() => createApiClient({ baseUrl }));
  const [confirm, setConfirm] = useState(false);
  const [refreshCount, refresh] = useReducer(value => value + 1, 0);
  const latest = useRead(useCallback((signal: AbortSignal) => api.getFlowRun(projectId, card.runId, signal), [api, projectId, card.runId]), refreshKey + refreshCount);
  const write = useFlowWrite(api, refresh);
  const state = latest.data?.run.state ?? card.state;
  return <>
    <div className="flex flex-wrap items-center gap-2">
      <a className={link} href={`${viewHash(`project:${projectId}`)}/runs/${encodeURIComponent(card.runId)}`}>{t(state === 'cancelled' ? 'leadChatUi.run' : 'leadChatUi.started').replace('{title}', card.title)}</a>
      <Badge variant="outline">{t(`flowsUi.state.${state}`)}</Badge>
      {FLOW_RUN_TRANSITIONS[state].includes('cancelled') && <Button data-testid="lead-run-stop" size="sm" variant="outline" disabled={write.busy} onClick={() => setConfirm(true)}>{t('leadChatUi.stop')}</Button>}
    </div>
    {confirm && <FlowDialog title={t('leadChatUi.stop')} description={t('leadChatUi.stopConfirm').replace('{title}', card.title)}
      close={() => setConfirm(false)} busy={write.busy} submit={t('leadChatUi.stop')}
      onSubmit={() => void write.run(() => flowCommand('flow-runs.cancel', projectId, {
        runId: card.runId, expectedRevision: latest.data?.run.revision ?? card.revision, reason: t('leadChatUi.stopReason'),
      }), () => setConfirm(false))}>
      <FlowError error={write.error} />
    </FlowDialog>}
  </>;
}

export function LeadChatCard({ projectId, card, onOpenTask, refreshKey = 0 }: { projectId: string; card: LeadCard; onOpenTask?: ((id: string) => void) | undefined; refreshKey?: number }) {
  const t = useT();
  return <section data-testid={`lead-card-${card.kind}`} className="space-y-1 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm">
    {card.kind === 'brief' ? <a className={link} href={artifactHash(projectId, { id: card.artifactId, version: card.version })}>
      {t('leadChatUi.brief').replace('{version}', String(card.version))} · {card.title}
    </a> : card.kind === 'run' ? <RunCard projectId={projectId} card={card} refreshKey={refreshKey} /> : <>
      <strong>{t('leadChatUi.tasks').replace('{count}', String(card.tasks.length))}</strong>
      <ul className="list-inside list-disc">{card.tasks.map(task => <li key={task.id}><a className={link} href={viewHash(`project:${projectId}`, 'board')}
        onClick={onOpenTask ? event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onOpenTask(task.id); } } : undefined}>{task.title}</a></li>)}</ul>
    </>}
  </section>;
}
