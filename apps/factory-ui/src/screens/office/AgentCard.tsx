import { useState, type ReactNode } from 'react';
import { HoverCard } from 'radix-ui';
import { ArrowRight, CheckCircle2, Clock3, Coffee, Eye, ListChecks } from 'lucide-react';
import type { OfficeSeat } from '@/api/officeModels';
import { Mascot, type MascotState } from '@/components/mascot';
import { MarkdownContent } from '@/components/MarkdownContent';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { activityTime } from '../teams/activity/presentation';
import { StatusPill } from '../teams/activity/StatusPill';

export type OfficeNeed = OfficeSeat['needsYou'][number];
export type OpenOfficeTask = (taskId: string, tab?: 'request' | 'progress' | 'actions') => void;
export const mascotFor: Record<OfficeSeat['status'], MascotState> = {
  working: 'working', waiting: 'attention', problem: 'error', done: 'success', queued: 'thinking', idle: 'idle',
};

/** A missing report is indeterminate: elapsed time never becomes a made-up percentage. */
export function WorkProgress({ percent, label, startedAt, now }: { percent: number | null | undefined; label: string; startedAt?: string | null; now?: number }) {
  const t = useT();
  const value = percent == null ? null : Math.round(Math.max(0, Math.min(100, percent)));
  const elapsed = startedAt && now !== undefined ? Math.max(0, Math.floor((now - Date.parse(startedAt)) / 60_000)) : null;
  const running = elapsed !== null && Number.isFinite(elapsed)
    ? elapsed < 1 ? t('officeUi.runningJustStarted') : t(elapsed === 1 ? 'officeUi.runningMinute' : 'officeUi.runningMinutes').replace('{count}', String(elapsed))
    : t('officeUi.running');
  return <div className="space-y-2">
    <div className="flex items-baseline justify-between gap-3"><span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn('shrink-0 font-mono font-semibold tabular-nums', value === null ? 'text-[11px] text-muted-foreground' : 'text-xl text-run')}>{value === null ? running : `${value}%`}</span>
    </div>
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} {...(value === null ? { 'aria-valuetext': running } : { 'aria-valuenow': value })} className="h-2 overflow-hidden rounded-full bg-secondary">
      <span className={cn('block h-full rounded-full bg-run transition-[width] duration-500 motion-reduce:transition-none', value === null && 'office-progress-pending')} style={{ width: value === null ? '30%' : `${value}%` }} />
    </div>
  </div>;
}

export function ReviewNeeds({ store, seat, onReview }: { store: Store; seat: OfficeSeat; onReview: (need: OfficeNeed) => void }) {
  const t = useT(); const state = store.useStoreSelector(value => value);
  return <div className="space-y-3">{seat.needsYou.map(need => {
    const approval = state.approvals[need.approvalId] ?? state.inbox.approvals.find(item => item.id === need.approvalId);
    if (approval && !['pending', 'requested'].includes(approval.state)) return null;
    const task = state.tasks.find(item => item.id === need.taskId);
    return <section key={need.approvalId} className="space-y-2 rounded-xl border border-need/25 bg-need/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-need"><span className="inline-flex items-center gap-1.5"><ListChecks className="size-3.5" />{t(`officeUi.kinds.${need.kind}`)}</span><span className="font-mono">{need.code}</span></div>
      <p className="text-sm font-medium [overflow-wrap:anywhere]">{approval?.subject || task?.title || need.code}</p>
      {approval?.summary && <div className="line-clamp-4"><MarkdownContent content={approval.summary} className="space-y-1 text-xs leading-5 text-muted-foreground" /></div>}
      <Button type="button" size="sm" variant="outline" className="h-8 border-need/30 bg-background text-xs text-need hover:bg-need/10" onClick={() => onReview(need)}><Eye className="size-3.5" />{t(need.kind === 'question' ? 'officeUi.answerHere' : 'officeUi.reviewHere')}</Button>
    </section>;
  })}</div>;
}

/** Shared by the hover preview and the pinned agent panel, including touch devices. */
export function AgentOverview({ store, seat, now, onOpenTask, onReview }: {
  store: Store; seat: OfficeSeat; now: number; onOpenTask: OpenOfficeTask; onReview: (need: OfficeNeed) => void;
}) {
  const t = useT(); const tasks = store.useStoreSelector(value => value.tasks);
  return <div className="space-y-4">
    {!!seat.needsYou.length && <ReviewNeeds store={store} seat={seat} onReview={onReview} />}
    {seat.runs.map(run => {
      const task = tasks.find(item => item.id === run.taskId);
      return <section key={run.attemptId} className="space-y-3 rounded-xl border border-border bg-background/60 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span className="font-mono">{run.code}</span>{run.startedAt && <span className="inline-flex items-center gap-1"><Clock3 className="size-3" />{activityTime(run.startedAt, now)}</span>}</div>
        <h4 className="text-sm font-semibold leading-6 [overflow-wrap:anywhere]">{run.title}</h4>
        <WorkProgress percent={run.progress?.percent} label={t('officeUi.taskProgress')} startedAt={run.startedAt} now={now} />
        {task?.goal && <div className="space-y-1"><h5 className="text-xs font-medium text-muted-foreground">{t('taskUi.goal')}</h5><div className="line-clamp-5"><MarkdownContent content={task.goal} className="space-y-1 text-xs leading-5" /></div></div>}
        {!!task?.acceptance.length && <div className="space-y-1"><h5 className="text-xs font-medium text-muted-foreground">{t('taskUi.acceptance')}</h5><ul className="list-disc space-y-1 pl-4 text-xs leading-5">{task.acceptance.slice(0, 3).map((item, index) => <li key={index} className="[overflow-wrap:anywhere]">{item}</li>)}</ul></div>}
        {run.progress && <div className="space-y-1 border-t border-border pt-3"><p className="text-[11px] text-muted-foreground">{t('officeUi.latestReport')} · {activityTime(run.progress.at, now)}</p><MarkdownContent content={run.progress.message} className="space-y-1 text-xs leading-5 text-muted-foreground" /></div>}
        <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => onOpenTask(run.taskId, 'request')}>{t('officeUi.taskOverview')}</Button><Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => onOpenTask(run.taskId, 'progress')}>{t('workUi.progress')}<ArrowRight className="size-3.5" /></Button></div>
      </section>;
    })}
    {!seat.runs.length && <div className="rounded-xl border border-dashed border-border p-4 text-center"><Coffee className="mx-auto mb-2 size-6 text-muted-foreground" /><p className="text-sm text-muted-foreground">{t(seat.chat ? 'officeUi.replying' : seat.queued ? 'officeUi.queued' : seat.needsYou.length ? 'officeUi.waitingYou' : 'officeUi.resting').replace('{count}', String(seat.queued))}</p></div>}
    {seat.lastFinished && <p className="flex items-start gap-2 text-xs text-muted-foreground"><CheckCircle2 className={cn('mt-0.5 size-3.5 shrink-0', seat.lastFinished.outcome === 'succeeded' && 'text-ok')} /><span>{t('officeUi.lastTask')} <span className="font-mono">{seat.lastFinished.code}</span> · {t(seat.lastFinished.outcome === 'succeeded' ? 'officeUi.kinds.finished' : 'officeUi.kinds.failed')}</span></p>}
  </div>;
}

export function AgentCard({ store, seat, featured = false, innerRef, className, bubble, now, onSelectSeat, onOpenTask, onReview }: {
  store: Store; seat: OfficeSeat; featured?: boolean; innerRef: (element: HTMLElement | null) => void; className?: string | undefined;
  bubble: ReactNode; now: number; onSelectSeat: (seat: OfficeSeat) => void; onOpenTask: OpenOfficeTask; onReview: (need: OfficeNeed) => void;
}) {
  const t = useT(); const run = seat.runs[0]; const [open, setOpen] = useState(false);
  const closeAnd = (action: () => void) => { setOpen(false); action(); };
  const needs = seat.needsYou.length;
  return <HoverCard.Root open={open} onOpenChange={setOpen} openDelay={350} closeDelay={200}>
    <HoverCard.Trigger asChild><button type="button" ref={innerRef} data-status={seat.status} onFocus={() => setOpen(true)} onClick={() => closeAnd(() => onSelectSeat(seat))} aria-label={`${seat.name} · ${t('officeUi.viewAgent')}`} className={cn('office-agent-card group flex h-full min-h-64 w-full min-w-0 flex-col rounded-2xl border border-border bg-card p-4 text-left [overflow-wrap:anywhere] hover:border-info/50 focus-visible:outline-2 focus-visible:outline-ring', featured && 'justify-self-center', className)}>
      <div className="flex min-w-0 items-start gap-3"><span className="office-avatar relative shrink-0 rounded-2xl bg-secondary/60 p-1"><Mascot seat={seat.isLead ? 'Lead' : seat.name} state={mascotFor[seat.status]} size={featured ? 52 : 44} fallback={<span className="flex size-11 items-center justify-center text-lg font-semibold">{seat.name.slice(0, 2)}</span>} />{seat.status === 'working' && <span aria-hidden="true" className="absolute -right-1 -bottom-1 flex gap-0.5 rounded-full bg-run px-1.5 py-1"><i /><i /><i /></span>}</span>
        <span className="min-w-0 flex-1 space-y-1"><span className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{seat.name}</span><StatusPill status={seat.status} /></span><span className="block truncate text-xs text-muted-foreground">{seat.role}</span></span>
      </div>
      {run ? <div className="mt-4 space-y-3"><p className="line-clamp-2 text-sm leading-5"><span className="mr-1.5 font-mono text-xs text-muted-foreground">{run.code}</span>{run.title}</p><WorkProgress percent={run.progress?.percent} label={t('officeUi.taskProgress')} startedAt={run.startedAt} now={now} />{run.progress && <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{run.progress.message}</p>}{seat.runs.length > 1 && <p className="text-xs text-info">{t('activityUi.moreRuns').replace('{count}', String(seat.runs.length - 1))}</p>}</div>
        : <div className="mt-4 space-y-2"><p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Coffee className="size-3.5" />{t(seat.chat ? 'officeUi.replying' : needs ? 'officeUi.waitingYou' : seat.queued ? 'officeUi.queued' : 'officeUi.resting').replace('{count}', String(seat.queued))}</p>{seat.status === 'done' && seat.lastFinished?.outcome === 'succeeded' ? <WorkProgress percent={100} label={seat.lastFinished.code} /> : <p className="text-xs text-muted-foreground">{t('officeUi.noActiveProgress')}</p>}{bubble}</div>}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4 text-xs">{needs ? <span className="inline-flex items-center gap-1 rounded-full bg-need/10 px-2 py-1 font-medium text-need"><ListChecks className="size-3.5" />{t('officeUi.pendingCount').replace('{count}', String(needs))}</span> : <span className="text-muted-foreground">{t('officeUi.hoverHint')}</span>}<ArrowRight className="ml-auto size-3.5 text-info transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" /></div>
    </button></HoverCard.Trigger>
    <HoverCard.Portal><HoverCard.Content side="right" align="start" sideOffset={12} collisionPadding={16} onEscapeKeyDown={() => setOpen(false)} className="office-agent-preview z-40 w-[390px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-xl outline-none">
      <div className="mb-4 flex items-center justify-between gap-2 border-b border-border pb-3"><div className="min-w-0"><h3 className="truncate text-sm font-semibold">{seat.name}</h3><p className="text-xs text-muted-foreground">{t('officeUi.taskOverview')}</p></div><StatusPill status={seat.status} /></div>
      <AgentOverview store={store} seat={seat} now={now} onOpenTask={(taskId, tab) => closeAnd(() => onOpenTask(taskId, tab))} onReview={need => closeAnd(() => onReview(need))} />
      <Button type="button" variant="ghost" size="sm" className="mt-3 w-full text-xs" onClick={() => closeAnd(() => onSelectSeat(seat))}>{t('officeUi.pinAgent')}<ArrowRight className="size-3.5" /></Button>
    </HoverCard.Content></HoverCard.Portal>
  </HoverCard.Root>;
}
