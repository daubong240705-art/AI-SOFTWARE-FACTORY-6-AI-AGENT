import { Badge } from '@/components/ui/badge';
import type { WorkflowStage } from '@/api/m5Models';
import { useT } from '@/i18n';

export function LoopChip({ stage, maxLoops }: { stage: WorkflowStage; maxLoops?: number | null }) {
  const t = useT();
  if (maxLoops) return <Badge variant="secondary" className="font-normal">{t('ux5.loop').replace('{current}', String(stage.iteration ?? (stage.loopCount ?? 0) + 1)).replace('{total}', String(maxLoops))}</Badge>;
  if (stage.loopCount === undefined && (stage.iteration === undefined || stage.iteration <= 1)) return null;
  return <Badge variant="secondary" className="font-normal">{stage.loopCount !== undefined && stage.iteration !== undefined ? t('ux5.loop').replace('{current}', String(stage.iteration)).replace('{total}', String(stage.loopCount)) : `${t(stage.loopCount !== undefined ? 'workflowUi.loop' : 'workflowUi.iteration')}: ${stage.loopCount ?? stage.iteration}`}</Badge>;
}
