import { Avatar, AvatarBadge, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Mascot, mascotState } from '@/components/mascot';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import type { ActivitySeat } from '@/api/activityModels';
import { attentionHash } from '../../Attention';
import { activityTime, dotClass } from './presentation';
import { RunContext } from './RunContext';
import { StatusPill } from './StatusPill';
import type { Store } from '@/state/store';
import { SeatRuntimeBadge } from '@/components/agent-config/SeatRuntimeBadge';

export type OpenActivityTask = (projectId: string, taskId: string) => void;
export function AgentRow({ store, seat, now, onTask }: { store: Store; seat: ActivitySeat; now: number; onTask: OpenActivityTask }) {
  const t = useT(); const run = seat.runs[0];
  const open = () => { if (run) onTask(run.projectId, run.taskId); };
  const context = seat.status === 'queued' ? t('activityUi.queuedWork').replace('{count}', String(seat.queued))
    : seat.status === 'done' && seat.lastFinished ? t('activityUi.finished').replace('{code}', seat.lastFinished.code).replace('{time}', seat.lastFinished.at ? activityTime(seat.lastFinished.at, now) : '')
      : seat.status === 'problem' ? t(seat.lastFinished?.outcome === 'failed' ? 'activityUi.attempt.failed' : 'activityUi.attempt.unknown') : t('activityUi.noWork');
  return <div className="min-w-0 py-1">
    <div role="button" tabIndex={run ? 0 : -1} aria-disabled={!run} onClick={open}
      onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open(); } }}
      className={cn('grid min-w-0 grid-cols-[40px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 rounded-lg px-2 py-3 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring', run && 'cursor-pointer hover:bg-secondary/50')}>
      <Mascot seat={seat.isLead ? 'Lead' : seat.name} state={seat.needsYou.length ? 'attention' : mascotState(seat.status)} size={40} fallback={<Avatar className="size-8 overflow-visible rounded-md" aria-hidden="true">
        <AvatarFallback className="rounded-md bg-secondary font-mono text-xs text-foreground">{Array.from(seat.name)[0]?.toLocaleUpperCase()}</AvatarFallback>
        <AvatarBadge className={cn('top-0 bottom-auto size-2.5 text-foreground ring-card', dotClass[seat.status])} />
      </Avatar>} />
      <div className="min-w-0 space-y-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5"><span className="text-sm font-medium [overflow-wrap:anywhere]">{seat.name}</span><span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{seat.role}</span><SeatRuntimeBadge store={store} seatId={seat.id} /></div>
        {run ? <RunContext run={run} /> : <p className="text-xs text-muted-foreground">{context}</p>}
      </div>
      <StatusPill status={seat.status} />
    </div>
    {seat.needsYou.map(need => <div key={need.approvalId} className="mt-1 ml-11 flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border border-need/20 bg-need/10 px-3 py-2">
      <span className="min-w-0 text-xs text-need [overflow-wrap:anywhere]">{t('activityUi.waitingFor').replace('{code}', need.code)}</span>
      <Button variant="outline" size="sm" className="h-7 shrink-0 border-need/30 bg-transparent text-xs text-need hover:bg-need/10 hover:text-need" onClick={() => { location.hash = need.approvalId ? attentionHash(`approval:${need.approvalId}`) : '#/attention'; }}>{t('activityUi.answer')}</Button>
    </div>)}
    {seat.runs.slice(1, 4).map(extra => <Button key={extra.attemptId} variant="ghost" className="mt-1 ml-11 block h-auto w-[calc(100%-2.75rem)] rounded-md px-2 py-2 text-left font-normal whitespace-normal" onClick={() => onTask(extra.projectId, extra.taskId)}><RunContext run={extra} /></Button>)}
    {seat.runs.length > 4 && <p className="mt-2 ml-13 text-xs text-muted-foreground">{t('activityUi.moreRuns').replace('{count}', String(seat.runs.length - 4))}</p>}
  </div>;
}

