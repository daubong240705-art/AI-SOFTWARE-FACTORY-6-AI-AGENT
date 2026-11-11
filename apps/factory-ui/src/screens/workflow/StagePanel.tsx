import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { WorkflowDetail, WorkflowStage } from '@/api/m5Models';
import { useT } from '@/i18n';
import { M5Status } from '../M5Shared';
import { LoopChip } from './LoopChip';
import type { StageDefinition } from './graphTypes';

export function StagePanel({ definition, stage, detail, onClose, onOpenTask, assignment }: {
  definition: StageDefinition; stage: WorkflowStage; detail: WorkflowDetail; onClose: () => void;
  onOpenTask?: ((taskId: string) => void) | undefined; assignment?: ReactNode;
}) {
  const t = useT();
  const gates = detail.graph?.gates.filter(gate => gate.before === stage.key) ?? [];
  const maxLoops = Math.max(0, ...(detail.graph?.edges.filter(edge => edge.type === 'rework' && edge.to === stage.key).map(edge => edge.maxLoops ?? 0) ?? []));
  const kindLabel = (kind: string) => kind === 'brief' ? t('workflowGraph.brief') : t(`knowledgeUi.kinds.${kind}`);
  return <Card role="region" aria-label={t('workflowGraph.stageDetails')} className="max-h-[calc(100vh-17rem)] w-full min-w-0 gap-0 overflow-y-auto rounded-xl border-border py-0 shadow-none lg:w-80 lg:shrink-0">
    <CardHeader className="flex flex-row items-start justify-between gap-3 border-b border-border p-4"><h3 className="font-display text-lg font-semibold break-words">{definition.title || definition.key}</h3><Button type="button" variant="ghost" size="icon-sm" className="shrink-0" aria-label={t('m5Ui.close')} onClick={onClose}><X /></Button></CardHeader>
    <CardContent className="space-y-5 p-4 text-sm">
      <div className="flex flex-wrap gap-2"><M5Status value={stage.state} /><LoopChip stage={stage} maxLoops={maxLoops} /></div>
      <dl className="space-y-1"><dt className="text-xs text-muted-foreground">{t('workflowGraph.phase')}</dt><dd>{definition.phase || stage.phase || '—'}</dd></dl>
      {!!definition.requiredCapabilities.length && <section className="space-y-2"><h4 className="text-xs text-muted-foreground">{t('workflowGraph.capabilities')}</h4><div className="flex flex-wrap gap-1.5">{definition.requiredCapabilities.map(capability => <Badge key={capability} variant="secondary" className="font-normal">{capability}</Badge>)}</div></section>}
      {!!definition.inputs.length && <section className="space-y-2"><h4 className="text-xs text-muted-foreground">{t('workflowGraph.inputs')}</h4><ul className="space-y-2">{definition.inputs.map((input, index) => <li key={`${input.kind}:${index}`}>{kindLabel(input.kind)}{input.required && <span className="text-muted-foreground"> ({t('workflowGraph.required')})</span>}</li>)}</ul></section>}
      {!!definition.outputs.length && <section className="space-y-2"><h4 className="text-xs text-muted-foreground">{t('workflowGraph.outputs')}</h4><ul className="space-y-2">{definition.outputs.map((output, index) => <li key={`${output.kind}:${index}`}>{kindLabel(output.kind)}<span className="text-muted-foreground"> · {t('workflowGraph.mustReach')}: {output.mustReach === 'unknown' ? t('m5Ui.states.unknown') : t(`knowledgeUi.statuses.${output.mustReach}`)}</span></li>)}</ul></section>}
      {!!gates.length && <section className="space-y-2"><h4 className="text-xs text-muted-foreground">{t('workflowGraph.gateBefore')}</h4>{gates.map((gate, index) => <p key={index}>{t(`workflowGraph.gates.${gate.kind}`)}<span className="text-muted-foreground"> · {t(`workflowGraph.approvers.${gate.approver}`)}</span></p>)}</section>}
      {!!stage.tasks.length && <section className="space-y-2"><h4 className="text-xs text-muted-foreground">{t('workflowGraph.tasks')}</h4><div className="flex flex-wrap gap-2">{stage.tasks.map(task => <Badge key={task.taskId} variant="outline" asChild={!!onOpenTask} className="rounded-md font-mono font-normal">{onOpenTask ? <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => onOpenTask(task.taskId)}>{task.code}</Button> : task.code}</Badge>)}</div></section>}
      {stage.blockedReason && <p className="rounded-lg border border-info/30 bg-info/5 p-3 text-info break-words">{stage.blockedReason}</p>}
      {assignment && <><Separator />{assignment}</>}
    </CardContent>
  </Card>;
}
