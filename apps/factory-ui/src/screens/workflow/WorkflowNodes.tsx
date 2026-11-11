import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { AlertTriangle, Check, Play, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import { M5Status, m5Dot } from '../M5Shared';
import { LoopChip } from './LoopChip';
import { phaseBorders, type StageData, type GateData, type BandData } from './graphTypes';

export function StageNode({ data, selected }: NodeProps<Node<StageData>>) {
  const { definition, stage, phaseIndex, maxLoops } = data;
  return <Card title={stage.blockedReason ?? definition.title} className={cn('relative h-[92px] w-[220px] gap-1.5 rounded-xl border-border border-l-[3px] px-3 py-2.5 shadow-none', phaseBorders[phaseIndex % 4],
    definition.optional && 'border-dashed', stage.state === 'skipped' && 'opacity-60', stage.state === 'active' && 'ring-2 ring-run/40', selected && 'outline-2 outline-offset-4 outline-info', ['blocked', 'failed'].includes(stage.state) && 'border-info')}>
    <Handle type="target" position={Position.Left} className="!size-1.5 !border-border !bg-muted-foreground" />
    {stage.state === 'active' && <span aria-hidden className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-run/20 motion-safe:animate-pulse" />}
    <div className="flex min-w-0 items-center justify-between gap-2"><span className="truncate text-sm font-medium">{definition.title || definition.key}</span>{stage.state === 'done' ? <Check aria-hidden className="size-3.5 shrink-0 text-ok" /> : <span aria-hidden className={cn('size-2 shrink-0 rounded-full', m5Dot(stage.state))} />}</div>
    <div className="flex items-center gap-1 [&_.badge]:text-[10px]"><M5Status value={stage.state} /><LoopChip stage={stage} maxLoops={maxLoops} /></div>
    <div className="flex gap-1 overflow-hidden">{stage.tasks.slice(0, 3).map(task => <Badge key={task.taskId} variant="secondary" className="max-w-16 truncate rounded px-1 font-mono text-[10px] font-normal">{task.code}</Badge>)}{stage.tasks.length > 3 && <span className="text-[10px] text-muted-foreground">+{stage.tasks.length - 3}</span>}</div>
    <Handle type="source" position={Position.Right} className="!size-1.5 !border-border !bg-muted-foreground" />
  </Card>;
}

export function GateNode({ data }: NodeProps<Node<GateData>>) {
  const t = useT(); const { gate, waiting } = data;
  const Icon = gate.kind === 'review' ? ShieldCheck : gate.kind === 'execution-gate' ? Play : AlertTriangle;
  return <Tooltip><TooltipTrigger asChild><div tabIndex={0} className="flex size-11 items-center justify-center" aria-label={t(`workflowGraph.gates.${gate.kind}`)}>
    <Handle type="target" position={Position.Left} className="!border-border !bg-muted-foreground" />
    <div className={cn('flex size-8 rotate-45 items-center justify-center rounded-md border border-border bg-card text-muted-foreground', waiting && 'border-need bg-need/10 text-need')}><Icon className="size-4 -rotate-45" /></div>
    <Handle type="source" position={Position.Right} className="!border-border !bg-muted-foreground" />
  </div></TooltipTrigger><TooltipContent>{t('workflowGraph.gateTooltip').replace('{approver}', t(`workflowGraph.approvers.${gate.approver}`))} · {t(`workflowGraph.gates.${gate.kind}`)}</TooltipContent></Tooltip>;
}

export function BandNode({ data, type }: NodeProps<Node<BandData>>) {
  const t = useT();
  return <div aria-hidden className={cn('pointer-events-none h-full w-full rounded-xl border border-border/40 bg-secondary/20 p-3', type === 'parallel' && 'border-dashed border-border bg-transparent p-2')}>
    <span className="text-[11px] tracking-wide text-muted-foreground uppercase">{type === 'parallel' ? `${t('workflowGraph.parallel')} · ${data.policy === 'quorum' ? `≥${data.quorum ?? 1}` : t(`workflowGraph.joins.${data.policy}`)}` : data.label}</span>
  </div>;
}
