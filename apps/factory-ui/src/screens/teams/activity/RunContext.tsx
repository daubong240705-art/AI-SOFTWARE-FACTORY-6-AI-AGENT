import { Progress } from '@/components/ui/progress';
import { useT } from '@/i18n';
import type { ActivityRun } from '@/api/activityModels';

export function RunContext({ run }: { run: ActivityRun }) {
  const t = useT();
  const problem = ['lease-expired', 'unknown', 'reconciling', 'failed'].includes(run.attemptState);
  return <span className="block min-w-0 space-y-1 text-xs text-muted-foreground">
    <span className="flex min-w-0 items-baseline gap-2" title={`${run.code} ${run.title}`}>
      <span className="shrink-0 font-mono text-xs text-foreground">{run.code}</span><span className="truncate">{run.title}</span>
    </span>
    {problem && <span className="block text-info">{t(`activityUi.attempt.${run.attemptState}`)}</span>}
    {run.progress && <>
      {run.progress.message && <span className="block truncate" title={run.progress.message}>{run.progress.message}</span>}
      {run.progress.percent !== null && <Progress value={run.progress.percent} aria-label={`${t('workUi.progress')} ${run.code}`} className="h-1 bg-secondary [&_[data-slot=progress-indicator]]:bg-run" />}
    </>}
  </span>;
}
