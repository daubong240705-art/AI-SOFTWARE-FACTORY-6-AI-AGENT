import { Monitor } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Stagger, StaggerItem } from '@/components/motion/Stagger';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import type { ActivityNode, ActivityTeam } from '@/api/activityModels';
import { AgentRow, type OpenActivityTask } from './AgentRow';
import { dotClass } from './presentation';

export function ActivityTeamCard({ team, nodes, onlyMine, now, onTask }: {
  team: ActivityTeam; nodes: ActivityNode[]; onlyMine: boolean; now: number; onTask: OpenActivityTask;
}) {
  const t = useT();
  const seats = team.seats.filter(seat => !onlyMine || seat.status === 'waiting').sort((a, b) => Number(b.isLead) - Number(a.isLead));
  const nodeId = team.seats.flatMap(seat => seat.runs)[0]?.nodeId;
  const machine = nodes.find(node => node.id === nodeId) ?? nodes[0];
  const hasLead = seats.some(seat => seat.isLead);
  return <Card className="min-w-0 gap-0 rounded-xl border-border py-0 shadow-none">
    <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h2 className="font-sans text-base font-medium [overflow-wrap:anywhere]">{team.name}</h2>
        <span className="text-xs text-muted-foreground">{t('activityUi.agents').replace('{count}', String(team.seats.length))}</span>
        {team.lifecycle !== 'active' && <Badge variant="secondary">{t(team.lifecycle === 'unknown' ? 'm5Ui.states.unknown' : `m3.values.${team.lifecycle}`)}</Badge>}
        {machine && <Badge variant="outline" className="max-w-full gap-1.5 font-normal text-muted-foreground"><Monitor aria-hidden="true" /><span className="truncate">{machine.name}</span></Badge>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {(['working', 'waiting', 'problem', 'queued', 'idle'] as const).filter(status => team.counts[status] > 0).map(status => <Badge key={status} variant="outline" className="gap-1.5 font-normal text-muted-foreground">
          <span aria-hidden="true" className={cn('size-1.5 rounded-full', dotClass[status])} />{t(`activityUi.${status}`).replace('{count}', String(team.counts[status]))}
        </Badge>)}
      </div>
    </CardHeader>
    <CardContent className="min-w-0 px-3 py-2">
      {!seats.length && <p className="px-2 py-4 text-sm text-muted-foreground">{t('team.emptySeats')}</p>}
      <Stagger className="m-0 list-none p-0">{seats.map((seat, index) => <StaggerItem key={seat.id} index={index} className={cn(!seat.isLead && hasLead && 'ml-5 border-l-2 border-border pl-4')}><AgentRow seat={seat} now={now} onTask={onTask} /></StaggerItem>)}</Stagger>
    </CardContent>
  </Card>;
}
