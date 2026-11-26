import { useId, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Mascot } from '@/components/mascot';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import type { WorldAgent } from './data/types';
import { agentStatusKey } from './agentPresentation';
import { liveAttemptCount, type WorldPod } from './data/scope';

export function WorldRoster({ agents, pods, compact, onPod, highlight, error, loading, selected, onSelect, onOwner, onTask, onAdd, pickProject }: {
  agents: readonly WorldAgent[]; error: boolean; loading: boolean; selected: string | null;
  highlight: string | null;
  onSelect: (id: string) => void; onOwner: () => void; onTask: (projectId: string, taskId: string) => void;
  onAdd: () => void; pickProject: boolean;
  pods: readonly WorldPod[]; compact: boolean; onPod: (id: string) => void;
}) {
  const t = useT(); const id = useId(); const [open, setOpen] = useState(false);
  const grouped = new Map<string, WorldAgent[]>();
  for (const agent of agents) { const rows = grouped.get(agent.teamId) ?? []; rows.push(agent); grouped.set(agent.teamId, rows); }
  return <aside className={`${open ? 'world-roster-open' : 'world-roster-closed'} world-roster world-control`} aria-label={t('worldUi.roster')}>
    <div className="world-roster-header flex items-center pr-1">
      <button className="world-roster-toggle" aria-label={t('worldUi.rosterToggle')} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>{t('worldUi.roster')} ({agents.length}) {open ? <ChevronUp aria-hidden="true" size={16} /> : <ChevronDown aria-hidden="true" size={16} />}</button>
      <Button className="shrink-0" size="sm" variant="ghost" onClick={onAdd}>{t('worldUi.addAgent')}</Button>
    </div>
    {pickProject && <p className="px-3 pb-2 text-xs text-muted-foreground" role="status">{t('worldUi.pickProject')}</p>}
    <div id={id} hidden={!open}>
      <button className="world-roster-agent" aria-pressed={selected === 'owner'} onClick={onOwner}>{t('worldUi.ownerDesk')}</button>
      {!agents.length && !error && <p role="status" className="p-3 text-sm">{t(loading ? 'worldUi.loading' : 'worldUi.noAgents')}</p>}
      {pods.map(pod => <section key={pod.projectId} className={highlight === pod.projectId ? 'bg-accent/50' : undefined}>
        <h2 className="flex items-center gap-2 px-3 pt-3 pb-1 text-xs font-semibold text-muted-foreground"><span aria-hidden="true" className="size-3 shrink-0 rounded-full border border-border" style={{ backgroundColor: pod.color }} />{pod.name}
          {compact && <button type="button" className="ml-auto p-1" aria-label={t(pod.collapsed ? 'worldUi.scope.expandPod' : 'worldUi.scope.collapsePod').replace('{project}', pod.name)} aria-pressed={!pod.collapsed} onClick={() => onPod(pod.projectId)}>{pod.collapsed ? <ChevronDown aria-hidden="true" size={16} /> : <ChevronUp aria-hidden="true" size={16} />}</button>}
        </h2>
        {(grouped.get(pod.projectId) ?? []).map(agent => { const attempts = liveAttemptCount(agent); return <div key={agent.seatId}><button className="world-roster-agent" aria-pressed={selected === agent.seatId} onClick={() => onSelect(agent.seatId)}>
          <Mascot seat={agent.seatName} isLead={agent.isLead} state={agent.pose === 'resting' ? 'offline' : agent.pose} size={32} animated={false} />
          <span className="min-w-0 flex-1"><span className="block truncate font-medium">{agent.name}</span><span className="world-status" data-status={agent.status}>{t(agentStatusKey(agent))}</span></span>
          {attempts > 1 && <span className="world-status" aria-label={t('worldUi.scope.attempts').replace('{count}', String(attempts))}>×{attempts}</span>}
        </button>{agent.runs.map(run => <button key={run.attemptId} className="ml-3 p-1 font-mono text-xs underline" onClick={() => onTask(run.projectId, run.taskId)}>{run.code}</button>)}</div>; })}
      </section>)}
    </div>
  </aside>;
}
