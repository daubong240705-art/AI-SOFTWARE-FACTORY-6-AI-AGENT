import { useId } from 'react';
import type { WorkflowStage } from '@/api/m5Models';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useT } from '@/i18n';
import { attentionHash } from '../Attention';
import { activityAttemptLabel, activityTime } from '../teams/activity/presentation';
import { LiveDot } from './StageLiveInfo';
import { stageLiveRuns, type LiveRun, type LiveRuns } from './useLiveRuns';

function LiveRunRow({ taskId, code, run, now, onOpenTask }: {
  taskId: string; code: string; run: LiveRun; now: number; onOpenTask?: ((taskId: string) => void) | undefined;
}) {
  const t = useT();
  return <Card className="min-w-0 gap-2 rounded-lg border-border p-3 shadow-none">
    <div className="flex min-w-0 items-start justify-between gap-2">
      <div className="min-w-0 space-y-0.5">
        <p className="flex min-w-0 items-center gap-1.5"><LiveDot needsYou={run.needsYou} /><span className="font-medium break-words">{run.seatName}</span></p>
        <p className="text-xs text-muted-foreground break-words">{run.seatRole}</p>
      </div>
      <span className="max-w-24 shrink-0 truncate font-mono text-[11px] text-muted-foreground" title={code}>{code}</span>
    </div>
    <p className="text-xs text-muted-foreground">{activityAttemptLabel(run.attemptState)}{run.needsYou && <span className="text-need"> · {t('activityUi.status.waiting')}</span>}</p>
    {run.progress && <div className="space-y-1.5">
      {run.progress.percent !== null && <div className="flex items-center gap-2">
        <Progress value={run.progress.percent} aria-label={`${t('workUi.progress')} ${code}`} className="h-1 flex-1 bg-secondary [&_[data-slot=progress-indicator]]:bg-run" />
        <span className="shrink-0 text-[11px] text-muted-foreground">{run.progress.percent}%</span>
      </div>}
      {run.progress.message && <p className="text-xs text-muted-foreground break-words">{run.progress.message}</p>}
      <p className="text-[11px] text-muted-foreground">{t('activityUi.updated')} <time dateTime={run.progress.at}>{activityTime(run.progress.at, now)}</time></p>
    </div>}
    <p className="text-[11px] text-muted-foreground">{run.startedAt
      ? <time dateTime={run.startedAt}>{t('workflowGraph.live.started').replace('{time}', activityTime(run.startedAt, now))}</time>
      : t('workflowGraph.live.startedUnknown')}</p>
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" className="h-7 text-xs" disabled={!onOpenTask} onClick={() => onOpenTask?.(taskId)}>{t('workflowGraph.live.openTask')}</Button>
      {run.needsYou && <Button type="button" size="sm" variant="outline" className="h-7 border-need/30 bg-transparent text-xs text-need hover:bg-need/10 hover:text-need"
        onClick={() => { location.hash = run.approvalId ? attentionHash(`approval:${run.approvalId}`) : '#/attention'; }}>{t('activityUi.answer')}</Button>}
    </div>
  </Card>;
}

export function StageLivePanel({ stage, liveRuns, onOpenTask }: {
  stage: WorkflowStage; liveRuns: LiveRuns; onOpenTask?: ((taskId: string) => void) | undefined;
}) {
  const t = useT(); const id = useId(); const runs = stageLiveRuns(stage, liveRuns); const now = Date.now();
  if (!runs.length) return null;
  return <section className="space-y-3" aria-labelledby={id}>
    <h4 id={id} className="text-xs font-medium text-muted-foreground">{t('workflowGraph.live.section')}</h4>
    {runs.map(({ taskId, code, run }) => <LiveRunRow key={taskId} taskId={taskId} code={code} run={run} now={now} onOpenTask={onOpenTask} />)}
  </section>;
}
