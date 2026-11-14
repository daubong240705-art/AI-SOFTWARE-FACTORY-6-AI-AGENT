import type { WorkflowDetail, WorkflowInstance } from '@/api/readModels';
import { Card } from '@/components/ui/card';
import { useT } from '@/i18n';
import { stageName } from './presentation';

export function BuildSummary({ workflow, detail }: { workflow: WorkflowInstance; detail: WorkflowDetail | undefined }) {
  const t = useT();
  const stages = detail?.stages ?? [];
  const current = stages.filter(stage => ['active', 'ready', 'blocked', 'failed'].includes(stage.state));
  const last = stages.findLast(stage => ['done', 'skipped', 'cancelled'].includes(stage.state));
  const visible = current.length ? current : last ? [last] : stages.slice(0, 1);
  const loops = Math.max(0, ...stages.map(stage => stage.loopCount ?? Math.max(0, (stage.iteration ?? 1) - 1)));
  return <Card className="gap-3 p-5">
    <dl className="space-y-3 text-sm">
      <div><dt className="text-muted-foreground">{t('studioUi.build')}</dt><dd className="font-medium">{t(`studioUi.states.${detail?.state ?? workflow.state}`)}</dd></div>
      <div><dt className="text-muted-foreground">{t('studioUi.stage')}</dt><dd>{visible.length ? visible.map(stage => <p key={stage.key}>{stageName(stage.key, t, detail?.graph?.stages.find(item => item.key === stage.key)?.title)} · {t(`m5Ui.states.${stage.state}`)}</p>) : t('workflowUi.noStages')}</dd></div>
      {loops > 0 && <div><dt className="inline text-muted-foreground">{t('studioUi.rework')} </dt><dd className="inline">{loops}</dd></div>}
    </dl>
  </Card>;
}
