import type { WorkflowStage } from '@/api/m5Models';
import { Progress } from '@/components/ui/progress';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { activityAttemptLabel } from '../teams/activity/presentation';
import { stageLiveRuns, type LiveRun, type LiveRuns } from './useLiveRuns';

export function LiveDot({ needsYou = false }: { needsYou?: boolean }) {
  return <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', needsYou ? 'bg-need' : 'bg-run motion-safe:animate-pulse')} />;
}

function waitingState(stage: WorkflowStage) {
  if (stage.state !== 'active') return null;
  if (stage.tasks.some(task => task.state === 'awaiting-go')) return 'awaitingGo';
  if (stage.tasks.some(task => task.state === 'in-review')) return 'awaitingReview';
  if (stage.tasks.some(task => ['ready', 'accepted'].includes(task.state))) return 'awaitingAssignment';
  return null;
}

function WaitingLine({ stage }: { stage: WorkflowStage }) {
  const t = useT(); const waiting = waitingState(stage);
  return waiting && <p className={cn('truncate text-[11px] leading-[14px] text-muted-foreground', waiting !== 'awaitingAssignment' && 'text-need')}>{t(`workflowGraph.live.${waiting}`)}</p>;
}

export function StageLiveSummary({ stage, liveRuns }: { stage: WorkflowStage; liveRuns: LiveRuns }) {
  const t = useT(); const runs = stageLiveRuns(stage, liveRuns);
  const active = runs.find(item => item.run.needsYou) ?? runs[0];
  if (!active) return <WaitingLine stage={stage} />;
  const { run } = active;
  return <div className="min-w-0">
    <div className="flex min-w-0 items-center gap-1.5 leading-4"><LiveDot needsYou={run.needsYou} /><span className="truncate text-xs font-medium leading-4">{run.seatName}</span></div>
    {run.progress && <>
      <p className="truncate text-[11px] leading-[14px] text-muted-foreground">{run.progress.message}</p>
      {run.progress.percent !== null && <Progress value={run.progress.percent} aria-label={`${t('workUi.progress')} ${active.code}`} className="mt-0.5 h-[3px] bg-secondary [&_[data-slot=progress-indicator]]:bg-run" />}
    </>}
  </div>;
}

function RunTooltip({ run, code }: { run: LiveRun; code: string }) {
  const t = useT();
  return <div className="space-y-1 text-xs">
    <p className="flex items-center gap-1.5"><LiveDot needsYou={run.needsYou} /><span className="font-medium break-words">{run.seatName}</span><span className="text-muted-foreground">{run.seatRole}</span></p>
    <p className="font-mono text-[11px] text-muted-foreground">{code}</p>
    <p className="text-muted-foreground">{activityAttemptLabel(run.attemptState)}</p>
    {run.needsYou && <p className="text-need">{t('activityUi.status.waiting')}</p>}
    {run.progress && <>
      <p className="text-muted-foreground break-words">{run.progress.message}</p>
      {run.progress.percent !== null && <div className="flex items-center gap-2"><Progress value={run.progress.percent} aria-label={`${t('workUi.progress')} ${code}`} className="h-[3px] bg-secondary [&_[data-slot=progress-indicator]]:bg-run" /><span className="shrink-0 text-[11px] text-muted-foreground">{run.progress.percent}%</span></div>}
    </>}
  </div>;
}

export function StageLiveTooltip({ stage, liveRuns }: { stage: WorkflowStage; liveRuns: LiveRuns }) {
  const runs = stageLiveRuns(stage, liveRuns);
  if (!runs.length) return <WaitingLine stage={stage} />;
  return <div className="space-y-2 border-t border-border pt-2">{runs.map(({ taskId, code, run }) => <RunTooltip key={taskId} run={run} code={code} />)}</div>;
}
