import { useEffect } from 'react';
import type { OfficeSeat } from '@/api/officeModels';
import { Section, SidePanel, StatusDot, TechDetails, ViewState } from '@/components/app';
import { Mascot } from '@/components/mascot';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { toneOf } from '@/lib/status';
import type { Store } from '@/state/store';
import { activityTime } from '../teams/activity/presentation';
import { AttemptTimeline } from './AttemptTimeline';
import { durationSince, mascotFor, newestFirst, tokensFor, type OfficeNeed, type ProjectAttempt } from './presentation';

function SeatMascot({ seat, size = 36 }: { seat: OfficeSeat; size?: number }) {
  return <Mascot seat={seat.isLead ? 'Lead' : seat.name} state={mascotFor[seat.status]} size={size} animated={false}
    fallback={<span className="inline-flex shrink-0 items-center justify-center font-semibold" style={{ width: size, height: size }}>{seat.name.slice(0, 2)}</span>} />;
}
function SeatStatus({ seat }: { seat: OfficeSeat }) {
  const t = useT();
  return <StatusDot tone={toneOf('activity', seat.status)} label={t(`activityUi.status.${seat.status}`)} />;
}
export function SeatRow({ seat, attempts, now, selected, onSelect, onOpenTask, onNeed }: {
  seat: OfficeSeat; attempts: ProjectAttempt[]; now: number; selected: boolean; onSelect: () => void;
  onOpenTask: (id: string) => void; onNeed: (need: OfficeNeed) => void;
}) {
  const t = useT(); const run = seat.runs[0];
  const tokens = tokensFor(run ? attempts.find(item => item.id === run.attemptId) : undefined);
  const percent = run?.progress?.percent;
  const last = seat.lastFinished;
  return <div className={`relative flex min-w-0 items-start gap-3 border-b border-border py-3 ${selected ? 'bg-secondary/50' : 'hover:bg-secondary/30'}`}>
    <button type="button" className="absolute inset-0 rounded focus-visible:outline-2 focus-visible:outline-ring" onClick={onSelect}
      aria-label={`${t('agentUi.seatDetails')}: ${seat.name}`} aria-expanded={selected} />
    <div className="pointer-events-none relative flex min-w-0 flex-1 items-start gap-3">
      <SeatMascot seat={seat} /><div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"><span className="font-medium">{seat.name}</span>
          <span className="max-w-48 truncate text-xs text-muted-foreground" title={seat.role}>{seat.role}</span><SeatStatus seat={seat} /></div>
        {run ? <div className="mt-1 min-w-0 space-y-1">
          <button type="button" className="pointer-events-auto block max-w-full truncate text-left text-sm text-info underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            title={`${run.code} · ${run.title}`} onClick={() => onOpenTask(run.taskId)}><span className="font-mono text-xs">{run.code}</span> · {run.title}</button>
          {run.progress && <p className="truncate text-sm text-muted-foreground" title={run.progress.message}>{run.progress.message}</p>}
          {percent != null && <div role="progressbar" aria-label={t('agentUi.progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1 max-w-sm overflow-hidden rounded bg-secondary">
            <span className="block h-full rounded bg-run" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} /></div>}
          <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground"><span title={t('agentUi.duration')}>{durationSince(run.startedAt, null, now)}</span>
            {tokens && <span>{tokens}</span>}{seat.runs.length > 1 && <span>{t('agentUi.moreRuns').replace('{count}', String(seat.runs.length - 1))}</span>}</div>
        </div> : last ? <p className="mt-1 text-xs text-muted-foreground">{t('agentUi.lastRun').replace('{code}', last.code)
          .replace('{outcome}', t(`agentUi.outcome.${last.outcome}`)).replace('{time}', last.at ? activityTime(last.at, now) : t('agentUi.unknown'))}</p> : null}
        <div className="flex flex-wrap items-center gap-2">{seat.needsYou.map(need => <Button key={need.approvalId} type="button" variant="outline" size="sm"
          title={need.code} className="pointer-events-auto mt-2 h-7 border-need/30 text-xs text-need" onClick={() => onNeed(need)}>
          {t(need.kind === 'start-gate' ? 'agentUi.start' : 'agentUi.decide')}</Button>)}
          {seat.queued > 0 && <span className="mt-2 text-xs text-muted-foreground">{t('agentUi.queued').replace('{count}', String(seat.queued))}</span>}
        </div>
      </div>
    </div>
  </div>;
}

export function SeatPanel({ store, seat, attempts, now, onClose, onOpenTask }: {
  store: Store; seat: OfficeSeat; attempts: ProjectAttempt[]; now: number; onClose: () => void; onOpenTask: (id: string) => void;
}) {
  const t = useT(); const taskId = seat.runs[0]?.taskId;
  // Match TaskDetail: the effect owns exactly one reference to the task subscription.
  useEffect(() => {
    if (!taskId) return;
    void store.openTask(taskId);
    return () => store.closeTask(taskId);
  }, [store, taskId]);
  const detail = store.useStoreSelector(state => taskId ? state.details[taskId] : undefined);
  const recent = attempts.filter(attempt => attempt.seatId === seat.id).sort(newestFirst).slice(0, 10);
  return <SidePanel label={t('agentUi.closeSeat')} title={<span className="flex items-center gap-2"><SeatMascot seat={seat} size={28} />{seat.name}</span>}
    onClose={onClose} className="absolute inset-0 z-20 bg-background xl:static">
    <div className="space-y-6"><div className="space-y-2"><p className="truncate text-sm text-muted-foreground" title={seat.role}>{seat.role}</p><SeatStatus seat={seat} /></div>
      {taskId && <Section title={t('agentUi.currentRun')}>
        <ViewState loading={!detail || detail.loading} error={detail?.error} onRetry={() => { void store.loadTaskDetail(taskId); }} />
        {detail && <AttemptTimeline attempts={detail.attempts.filter(attempt => attempt.seatId === seat.id)}
          events={Object.fromEntries(detail.attempts.filter(attempt => attempt.seatId === seat.id).map(attempt => [attempt.id, detail.events[attempt.id]]))}
          onLoadAttempt={id => { void store.loadAttemptEvents(taskId, id); }} />}
      </Section>}
      <Section title={t('agentUi.recentRuns')}>
        {recent.map(attempt => <button key={attempt.id} type="button" className="block w-full space-y-1 border-b border-border py-2 text-left hover:bg-secondary/30 focus-visible:outline-2 focus-visible:outline-ring" onClick={() => onOpenTask(attempt.taskId)}>
          <div className="flex items-center gap-2"><StatusDot tone={toneOf('attempt', attempt.state)} label={t(`workUi.states.${attempt.state}`)} labelHidden />
            <span className="truncate text-sm" title={attempt.taskTitle}><span className="font-mono text-xs">{attempt.taskCode}</span> · {attempt.taskTitle}</span></div>
          <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground"><span>{durationSince(attempt.startedAt, attempt.endedAt, now)}</span>{tokensFor(attempt) && <span>{tokensFor(attempt)}</span>}</div>
        </button>)}
        {!recent.length && <ViewState empty compact emptyText={t('agentUi.noRuns')} />}
      </Section>
      <TechDetails identifier={seat.id}><p>{t('agentUi.team')}: {seat.teamName}</p><p className="font-mono">{seat.teamId}</p></TechDetails>
    </div>
  </SidePanel>;
}
