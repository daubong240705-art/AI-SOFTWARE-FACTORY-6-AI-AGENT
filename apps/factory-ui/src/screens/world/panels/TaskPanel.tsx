import { useEffect, useState } from 'react';
import type { Approval, Task } from '@factory/contracts';
import type { Attempt, AttemptEvent, TaskArtifact } from '@/api/client';
import { Mascot } from '@/components/mascot';
import { Button } from '@/components/ui/button';
import { i18n, useT } from '@/i18n';
import { describeEvent } from '@/state/attemptView';
import type { Store } from '@/state/store';
import { ReviewDocuments } from '../../attention/ReviewDocuments';
import type { WorldAgent } from '../data/types';

type Detail = { task: Task | undefined; attempts: Attempt[]; documents: TaskArtifact[]; approvals: Approval[]; events: AttemptEvent[]; owner: string | undefined; error: boolean };
const empty: Detail = { task: undefined, owner: undefined, attempts: [], documents: [], approvals: [], events: [], error: false };

/** All reads carry the project's ID; opening this panel never selects a project. */
export function TaskPanel({ store, projectId, taskId, agents, onTask, onFollow, onReview }: {
  store: Store; projectId: string; taskId: string; agents: readonly WorldAgent[];
  onTask: (projectId: string, taskId: string) => void; onFollow: (seatId: string) => void; onReview: (key: string) => void;
}) {
  const t = useT(); const [detail, setDetail] = useState<Detail>(empty); const [loading, setLoading] = useState(true); const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true; const controller = new AbortController();
    let busy = false;
    const read = async () => {
      if (busy) return; busy = true;
      const next: Detail = { ...empty, attempts: [], documents: [], approvals: [], events: [] };
      const results = await Promise.allSettled([
        store.listTasks(projectId, controller.signal).then(value => { next.task = value.items.find(task => task.id === taskId); }),
        store.listAttempts(projectId, taskId, controller.signal).then(value => { next.attempts = value.attempts.sort((a, b) => b.epoch - a.epoch); }),
        store.listTaskArtifacts(projectId, taskId, controller.signal).then(value => { next.documents = value.items; }),
        store.listTaskApprovals(projectId, taskId, controller.signal).then(value => { next.approvals = value.approvals; }),
        store.getTeam(projectId, controller.signal).then(value => value.seats),
      ]);
      if (!active) return;
      // Resolve the owner after both independent reads have completed.
      const seats = results[4];
      if (seats?.status === 'fulfilled') next.owner = seats.value?.find(seat => seat.id === next.task?.ownerSeatId)?.name;
      next.error = results.slice(0, 4).some(result => result.status === 'rejected');
      const latest = next.attempts[0];
      if (latest) {
        try {
          let afterSeq = 0;
          while (active) {
            const value = await store.listAttemptEvents(projectId, latest.id, { afterSeq, limit: 500 }, controller.signal);
            next.events.push(...value.events);
            const last = value.events.at(-1)?.seq ?? afterSeq;
            if (value.events.length < 500 || last <= afterSeq) break;
            afterSeq = last;
          }
        } catch { next.error = true; }
      }
      if (active) { setDetail(next); setLoading(false); }
      busy = false;
    };
    void read();
    const timer = setInterval(() => { if (!document.hidden) void read(); }, 15000);
    return () => { active = false; controller.abort(); clearInterval(timer); };
  }, [store, projectId, taskId, retry]);
  const { task, attempts, events } = detail; const latest = attempts[0];
  const agent = agents.find(agent => agent.runs.some(run => run.taskId === taskId)) ?? agents.find(agent => agent.seatId === (task?.ownerSeatId ?? latest?.seatId));
  const criteria = new Map<string, { passed: boolean | null; evidence: string | null }>();
  for (const event of events) {
    const result = describeEvent(event);
    if (result.kind === 'criterion') criteria.set(result.criterion, result);
  }
  const owner = agent?.name ?? detail.owner ?? latest?.seatName;
  const summary = events.map(describeEvent).reverse().find(result => result.kind === 'milestone' && result.summary);
  const date = (value: string | null | undefined) => value ? new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
  const duration = latest?.startedAt && latest.endedAt ? Math.max(0, Math.round((Date.parse(latest.endedAt) - Date.parse(latest.startedAt)) / 1000)) : null;
  return <div className="space-y-5">
    <h2 className="font-semibold">{t('workUi.overview')}</h2>
    {loading && <p role="status">{t('worldUi.loading')}</p>}
    {detail.error && <div role="status"><p>{t('worldUi.sourceError')}</p><Button variant="outline" size="sm" onClick={() => setRetry(value => value + 1)}>{t('errors.retry')}</Button></div>}
    {!loading && !task && <p>{t('worldUi.taskDetails.unavailable')}</p>}
    {task && <>
      <header><p className="font-mono text-xs">{task.code}</p><h3 className="text-lg font-semibold">{task.title}</h3><span className="world-status">{t(`taskUi.lifecycle.${task.state}`)}</span></header>
      <div className="flex items-center gap-2">{owner && <Mascot seat={owner} size={40} animated={false} />}<span>{owner ?? '—'}</span></div>
      <section><h3 className="font-medium">{t('taskUi.goal')}</h3><p className="whitespace-pre-wrap text-sm">{task.goal}</p></section>
      <section><h3 className="font-medium">{t('taskUi.acceptance')}</h3><ul className="space-y-2">{[...new Set([...task.acceptance, ...criteria.keys()])].map(criterion => {
        const result = criteria.get(criterion); const passed = result?.passed;
        return <li key={criterion} className="text-sm"><span aria-label={t(passed === true ? 'worldUi.taskDetails.pass' : passed === false ? 'worldUi.taskDetails.fail' : 'worldUi.taskDetails.notReported')}>{passed === true ? '✓' : passed === false ? '✗' : '○'}</span> {criterion}{result?.evidence && <p className="whitespace-pre-wrap text-muted-foreground">{result.evidence}</p>}</li>;
      })}</ul></section>
      <section className="space-y-2 text-sm"><h3 className="font-medium">{t('worldUi.taskDetails.latestRun')}</h3>{latest ? <>
        <dl className="grid grid-cols-2 gap-2"><dt>{t('worldUi.taskDetails.started')}</dt><dd>{date(latest.startedAt)}</dd><dt>{t('worldUi.taskDetails.ended')}</dt><dd>{date(latest.endedAt)}</dd><dt>{t('worldUi.taskDetails.duration')}</dt><dd>{duration === null ? '—' : `${duration} ${t('worldUi.taskDetails.seconds')}`}</dd><dt>{t('worldUi.taskDetails.outcome')}</dt><dd>{t(`workUi.states.${latest.state}`)}</dd></dl>
        <h4>{t('worldUi.taskDetails.summary')}</h4><p className="whitespace-pre-wrap">{summary?.kind === 'milestone' ? summary.summary : t('worldUi.taskDetails.notReported')}</p>
      </> : <p>{t('worldUi.taskDetails.noRuns')}</p>}</section>
      <ReviewDocuments store={store} projectId={projectId} taskId={taskId} documents={detail.documents} attemptId={latest?.id} />
      {detail.approvals.filter(approval => ['requested', 'pending'].includes(approval.state)).map(approval => <Button key={approval.id} onClick={() => onReview(`approval:${approval.id}`)}>{t('worldUi.taskDetails.review')}: {approval.subject}</Button>)}
      {task.state === 'awaiting-go' && !detail.approvals.some(approval => approval.kind === 'start-gate' && ['requested', 'pending'].includes(approval.state)) && <Button onClick={() => onReview(`gate:${taskId}`)}>{t('worldUi.taskDetails.review')}</Button>}
    </>}
    <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => onTask(projectId, taskId)}>{t('worldUi.taskDetails.openProject')}</Button>{agent && !agent.overflow && <Button variant="outline" size="sm" onClick={() => onFollow(agent.seatId)}>{t('worldUi.taskDetails.follow')}</Button>}</div>
  </div>;
}
