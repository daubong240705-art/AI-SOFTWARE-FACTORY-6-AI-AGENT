import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { AlertTriangle, Check, Play, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import { M5Status, m5Dot } from '../M5Shared';
import { LoopChip } from './LoopChip';
import { StageLiveSummary, StageLiveTooltip } from './StageLiveInfo';
import { noLiveRuns } from './useLiveRuns';
import { phaseBorders, type StageData, type GateData, type BandData } from './graphTypes';

export function StageNode({ data, selected }: NodeProps<Node<StageData>>) {
  const t = useT();
  const { definition, stage, phaseIndex, maxLoops, liveRuns = noLiveRuns } = data;
  const card = <Card className={cn('relative h-[108px] w-[204px] gap-0.5 rounded-xl border-border border-l-[3px] px-3 py-2 shadow-none', phaseBorders[phaseIndex % 4],
    definition.optional && 'border-dashed', stage.state === 'skipped' && 'opacity-60', stage.state === 'active' && 'ring-2 ring-run/40', selected && 'outline-2 outline-offset-4 outline-info', ['blocked', 'failed'].includes(stage.state) && 'border-info')}>
    <Handle type="target" position={Position.Left} className="!size-1.5 !border-border !bg-muted-foreground" />
    {stage.state === 'active' && <span aria-hidden className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-run/20 motion-safe:animate-pulse" />}
    <div className="flex min-w-0 shrink-0 items-center justify-between gap-2"><span className="truncate text-sm leading-[18px] font-medium">{definition.title || definition.key}</span>{stage.state === 'done' ? <Check aria-hidden className="size-3.5 shrink-0 text-ok" /> : <span aria-hidden className={cn('size-2 shrink-0 rounded-full', m5Dot(stage.state))} />}</div>
    <div className="flex shrink-0 items-center gap-1 [&_[data-slot=badge]]:h-4 [&_[data-slot=badge]]:px-1 [&_[data-slot=badge]]:py-0 [&_[data-slot=badge]]:text-[10px] [&_[data-slot=badge]]:leading-none"><M5Status value={stage.state} /><LoopChip stage={stage} maxLoops={maxLoops} /></div>
    <div className="flex shrink-0 gap-1 overflow-hidden">{stage.tasks.slice(0, 3).map(task => <Badge key={task.taskId} variant="secondary" className="h-3.5 max-w-16 truncate rounded px-1 py-0 font-mono text-[10px] leading-none font-normal">{task.code}</Badge>)}{stage.tasks.length > 3 && <span className="text-[10px] leading-[14px] text-muted-foreground">+{stage.tasks.length - 3}</span>}</div>
    <StageLiveSummary stage={stage} liveRuns={liveRuns} />
    <Handle type="source" position={Position.Right} className="!size-1.5 !border-border !bg-muted-foreground" />
  </Card>;
  return <Tooltip delayDuration={250}><TooltipTrigger asChild>{card}</TooltipTrigger>
    <TooltipContent side="top" sideOffset={8} className="max-w-72 space-y-1.5 border border-border bg-popover p-3 text-left text-popover-foreground shadow-md">
      <p className="text-sm font-medium break-words">{definition.title || definition.key}</p>
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{definition.phase || stage.phase}</span><span aria-hidden>·</span><span>{t(`m5Ui.states.${stage.state}`)}</span>{maxLoops ? <span>{stage.iteration ?? 1}/{maxLoops}</span> : null}</p>
      {!!definition.requiredCapabilities.length && <p className="text-xs break-words">{definition.requiredCapabilities.join(', ')}</p>}
      {!!stage.tasks.length && <p className="font-mono text-xs break-words">{stage.tasks.map(task => task.code).join(', ')}</p>}
      {stage.blockedReason && <p className="text-xs break-words text-info">{stage.blockedReason}</p>}
      <StageLiveTooltip stage={stage} liveRuns={liveRuns} />
      <p className="text-[11px] text-muted-foreground">{t('workflowGraph.clickForDetails')}</p>
    </TooltipContent></Tooltip>;
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
