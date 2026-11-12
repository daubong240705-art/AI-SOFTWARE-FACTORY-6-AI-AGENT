import type { WorkflowDetail } from '@/api/m5Models';
import { Button } from '@/components/ui/button';
import { plural, i18n, useT } from '@/i18n';
import { LiveDot } from './StageLiveInfo';
import { workflowLiveRuns, type LiveRuns } from './useLiveRuns';

export function WorkflowLiveChip({ detail, liveRuns, onSelectStage }: {
  detail: WorkflowDetail; liveRuns: LiveRuns; onSelectStage: (key: string) => void;
}) {
  const t = useT();
  const stages = detail.stages.filter(stage => detail.graph?.stages.some(definition => definition.key === stage.key));
  const runs = workflowLiveRuns(stages, liveRuns);
  const firstStage = detail.graph?.stages.find(definition => stages.some(stage => stage.key === definition.key && stage.tasks.some(task => liveRuns.has(task.taskId))));
  if (!runs.length || !firstStage) return null;
  const waiting = runs.filter(([, run]) => run.needsYou).length;
  return <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 rounded-full px-2 text-xs font-normal text-muted-foreground" onClick={() => onSelectStage(firstStage.key)}>
    <LiveDot />
    <span>{plural(t, i18n.locale, runs.length, 'workflowGraph.live.running').replace('{count}', String(runs.length))}</span>
    {waiting > 0 && <span className="text-need">· {t('workflowGraph.live.waiting').replace('{count}', String(waiting))}</span>}
  </Button>;
}
