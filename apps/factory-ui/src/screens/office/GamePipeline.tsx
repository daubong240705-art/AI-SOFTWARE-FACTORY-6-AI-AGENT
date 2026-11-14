import { AlertTriangle, CheckCircle2, CircleDashed, CircleHelp, PlayCircle, SkipForward } from 'lucide-react';
import type { Task } from '@factory/contracts';
import type { OrgTeam } from '@/api/m3Models';
import type { WorkflowDetail, WorkflowStage } from '@/api/m5Models';
import type { OfficeSeat } from '@/api/officeModels';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';

const stageKeys = ['design', 'rules', 'art', 'client', 'qa'] as const;
const stageCapabilities = ['game.design', 'game.rules', 'game.ui', 'game.client', 'test.e2e'];
const states = {
  pending: { icon: CircleDashed, tone: 'border-border bg-secondary/50 text-muted-foreground' },
  ready: { icon: PlayCircle, tone: 'border-run/30 bg-run/10 text-run' },
  active: { icon: PlayCircle, tone: 'border-run/50 bg-run/10 text-run' },
  done: { icon: CheckCircle2, tone: 'border-ok/30 bg-ok/10 text-ok' },
  skipped: { icon: SkipForward, tone: 'border-border bg-secondary/50 text-muted-foreground' },
  cancelled: { icon: SkipForward, tone: 'border-border bg-secondary/50 text-muted-foreground' },
  blocked: { icon: AlertTriangle, tone: 'border-need/40 bg-need/10 text-need' },
  failed: { icon: AlertTriangle, tone: 'border-destructive/40 bg-destructive/10 text-destructive' },
  unknown: { icon: CircleHelp, tone: 'border-border bg-secondary/50 text-muted-foreground' },
} satisfies Record<WorkflowStage['state'], unknown>;

/** Preserve the source order for seats serving the same stage and for unmatched seats. */
export function orderGameSeats(seats: OfficeSeat[], detail: WorkflowDetail | undefined, teams: OrgTeam[], tasks: Task[]) {
  if (!detail) return seats;
  const ranks = new Map(seats.map(seat => {
    const owned = stageKeys.findIndex(key => detail.stages.find(stage => stage.key === key)?.tasks.some(link =>
      tasks.some(task => task.id === link.taskId && task.ownerSeatId === seat.id) || seat.runs.some(run => run.taskId === link.taskId)));
    const capabilities = teams.find(team => team.id === seat.teamId)?.seats.find(item => item.id === seat.id)?.capabilities ?? [];
    const capable = stageKeys.findIndex((key, index) => {
      const required = detail.graph?.stages.find(stage => stage.key === key)?.requiredCapabilities ?? [stageCapabilities[index]!];
      return required.length > 0 && required.every(capability => capabilities.includes(capability));
    });
    return [seat.id, owned >= 0 ? owned : capable >= 0 ? capable : stageKeys.length] as const;
  }));
  const others = seats.filter(seat => !seat.isLead).sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)!);
  let index = 0;
  return seats.map(seat => seat.isLead ? seat : others[index++]!);
}

export function GamePipeline({ detail, onOpenWorkflow }: { detail: WorkflowDetail | undefined; onOpenWorkflow: () => void }) {
  const t = useT();
  // The graph preserves definition order, including optional stages such as bug reproduction.
  const keys = [...new Set(detail?.graph?.stages.length ? detail.graph.stages.map(stage => stage.key)
    : [...(detail?.stages.some(stage => stage.key === 'reproduce') ? ['reproduce'] : []), ...stageKeys,
      ...(detail?.stages.map(stage => stage.key).filter(key => key !== 'reproduce' && !stageKeys.some(stage => stage === key)) ?? [])])];
  const parallel = (key: string) => detail?.graph?.stages.find(stage => stage.key === key)?.parallelGroup
    ?? (key === 'rules' || key === 'art' ? 'build' : null);
  const groups: string[][] = [];
  for (const key of keys) {
    const last = groups.at(-1);
    if (last && parallel(key) && parallel(last[0]!) === parallel(key)) last.push(key);
    else groups.push([key]);
  }
  const chip = (key: string) => {
    const stage = detail?.stages.find(stage => stage.key === key);
    const state = stage?.state ?? 'pending';
    const { icon: Icon, tone } = states[state];
    const known = [...stageKeys, 'reproduce'].includes(key);
    const title = known ? t(`officeUi.pipelineStages.${key}`) : detail?.graph?.stages.find(stage => stage.key === key)?.title || key;
    const rework = detail?.graph?.edges.find(edge => edge.type === 'rework' && edge.to === key);
    const count = stage?.loopCount ?? Math.max(0, (stage?.iteration ?? 1) - 1);
    const loop = count > 0 && (rework || key === 'client')
      ? t('officeUi.reworkLoop').replace('{current}', String(count)).replace('{total}', String(rework?.maxLoops ?? 3)) : null;
    return <button key={key} type="button" onClick={onOpenWorkflow}
      aria-label={`${t('officeUi.openWorkflow')}: ${title} · ${t(`m5Ui.states.${state}`)}${loop ? ` · ${loop}` : ''}`}
      className={cn('inline-flex min-w-0 items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', tone)}>
      <Icon className="size-3.5 shrink-0" aria-hidden="true" /><span>{title}</span>
      <span className="sr-only">{t(`m5Ui.states.${state}`)}</span>
      {loop && <span className="shrink-0 rounded-full bg-background/70 px-1.5 py-0.5 text-[10px] tabular-nums">{loop}</span>}
    </button>;
  };
  return <section aria-label={t('officeUi.pipeline')} className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
    <span className="mr-1 text-xs font-semibold text-muted-foreground">{t('officeUi.pipeline')}</span>
    {groups.map(group => <div key={group[0]} role={group.length > 1 ? 'group' : undefined} aria-label={group.length > 1 ? t('workflowGraph.parallel') : undefined}
      className={cn('flex min-w-0 flex-wrap items-center gap-1.5', group.length > 1 && 'rounded-xl border border-dashed border-border p-1')}>
      {group.map(chip)}
    </div>)}
  </section>;
}
