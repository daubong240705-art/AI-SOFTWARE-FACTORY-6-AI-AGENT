import { useId, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Mascot } from '@/components/mascot';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import type { WorldAgent } from './data/types';
import { agentStatusKey } from './agentPresentation';
import type { WorldPod } from './data/scope';

function RosterAgent({ seats, selected, onSelect, onTask }: {
  seats: WorldAgent[]; selected: string | null; onSelect: (id: string) => void; onTask: (projectId: string, taskId: string) => void;
}) {
  const t = useT(); const id = useId(); const [open, setOpen] = useState(false);
  const first = seats[0]!;
  const representative = seats.find(seat => seat.status === 'waiting') ?? seats.find(seat => seat.status === 'working') ?? first;
  return <div>
    <div className="flex items-center">
      <button className="world-roster-agent min-w-0 flex-1" aria-pressed={seats.some(seat => selected === seat.seatId)} onClick={() => onSelect(first.seatId)}>
        <Mascot seat={first.seatName} isLead={first.isLead} state={representative.pose === 'resting' ? 'offline' : representative.pose} size={32} animated={false} />
        <span className="min-w-0 flex-1"><span className="block truncate font-medium">{first.seatName}</span><span className="world-status" data-status={representative.status}>{t(agentStatusKey(representative))}</span></span>
      </button>
      <button type="button" className="flex shrink-0 items-center gap-1 px-2 py-1 text-xs" aria-expanded={open} aria-controls={id} aria-label={`${first.seatName} · ${seats.length} seat`} onClick={() => setOpen(value => !value)}>
        {seats.length} seat {open ? <ChevronUp aria-hidden="true" size={14} /> : <ChevronDown aria-hidden="true" size={14} />}
      </button>
    </div>
    <ul id={id} hidden={!open} className="ml-4 border-l border-border pl-2">
      {seats.map(seat => <li key={seat.seatId}>
        <button className="world-roster-agent" aria-pressed={selected === seat.seatId} onClick={() => onSelect(seat.seatId)}>
          <span className="min-w-0 flex-1 truncate">{seat.name}</span><span className="world-status" data-status={seat.status}>{t(agentStatusKey(seat))}</span>
        </button>
        {seat.runs.map(run => <button key={run.attemptId} className="ml-3 p-1 font-mono text-xs underline" onClick={() => onTask(run.projectId, run.taskId)}>{run.code}</button>)}
      </li>)}
    </ul>
  </div>;
}

export function WorldRoster({ agents, pods, compact, onPod, highlight, error, loading, selected, onSelect, onOwner, onTask, onAdd, pickProject }: {
  agents: readonly WorldAgent[]; error: boolean; loading: boolean; selected: string | null;
  highlight: string | null;
  onSelect: (id: string) => void; onOwner: () => void; onTask: (projectId: string, taskId: string) => void;
  onAdd: () => void; pickProject: boolean;
  pods: readonly WorldPod[]; compact: boolean; onPod: (id: string) => void;
}) {
  const t = useT(); const id = useId(); const [open, setOpen] = useState(false);
  const grouped = new Map<string, Map<string, WorldAgent[]>>();
  for (const seat of agents) {
    const project = grouped.get(seat.projectId) ?? new Map<string, WorldAgent[]>();
    const seats = project.get(seat.ownerSeatId) ?? [];
    seats.push(seat); project.set(seat.ownerSeatId, seats); grouped.set(seat.projectId, project);
  }
  return <aside className={`${open ? 'world-roster-open' : 'world-roster-closed'} world-roster world-control`} aria-label={t('worldUi.roster')}>
    <div className="world-roster-header flex items-center pr-1">
      <button className="world-roster-toggle" aria-label={t('worldUi.rosterToggle')} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>{t('worldUi.roster')} ({agents.filter(seat => seat.slot === 0).length} agent · {agents.length} seat) {open ? <ChevronUp aria-hidden="true" size={16} /> : <ChevronDown aria-hidden="true" size={16} />}</button>
      <Button className="shrink-0" size="sm" variant="ghost" onClick={onAdd}>{t('worldUi.addAgent')}</Button>
    </div>
    {pickProject && <p className="px-3 pb-2 text-xs text-muted-foreground" role="status">{t('worldUi.pickProject')}</p>}
    <div id={id} hidden={!open}>
      <button className="world-roster-agent" aria-pressed={selected === 'owner'} onClick={onOwner}>{t('worldUi.ownerDesk')}</button>
      {!agents.length && !error && <p role="status" className="p-3 text-sm">{t(loading ? 'worldUi.loading' : 'worldUi.noAgents')}</p>}
      {pods.map(pod => <section key={pod.projectId} className={highlight === pod.projectId ? 'bg-accent/50' : undefined}>
        <h2 className="flex items-center gap-2 px-3 pt-3 pb-1 text-xs font-semibold text-muted-foreground"><span aria-hidden="true" className="size-3 shrink-0 rounded-full border border-border" style={{ backgroundColor: pod.color }} />{pod.name}
          {compact && pod.size > 4 && <button type="button" className="ml-auto flex items-center gap-1 p-1" aria-label={t(pod.collapsed ? 'worldUi.scope.expandPod' : 'worldUi.scope.collapsePod').replace('{project}', pod.name)} aria-pressed={!pod.collapsed} onClick={() => onPod(pod.projectId)}>{pod.remaining > 0 && `+${pod.remaining}`} {pod.collapsed ? <ChevronDown aria-hidden="true" size={16} /> : <ChevronUp aria-hidden="true" size={16} />}</button>}
        </h2>
        {[...(grouped.get(pod.projectId)?.values() ?? [])].map(seats => <RosterAgent key={seats[0]!.ownerSeatId} seats={seats} selected={selected} onSelect={onSelect} onTask={onTask} />)}
      </section>)}
    </div>
  </aside>;
}
