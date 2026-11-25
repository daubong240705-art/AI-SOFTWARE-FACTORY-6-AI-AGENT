import { useId, useState } from 'react';
import { Mascot } from '@/components/mascot';
import { useT } from '@/i18n';
import type { WorldAgent } from './data/types';
import { agentStatusKey } from './agentPresentation';

export function WorldRoster({ agents, highlight, error, loading, selected, onSelect, onOwner, onTask }: {
  agents: readonly WorldAgent[]; error: boolean; loading: boolean; selected: string | null;
  highlight: string | null;
  onSelect: (id: string) => void; onOwner: () => void; onTask: (projectId: string, taskId: string) => void;
}) {
  const t = useT(); const id = useId(); const [open, setOpen] = useState(false);
  const grouped = new Map<string, WorldAgent[]>();
  for (const agent of agents) { const rows = grouped.get(agent.teamId) ?? []; rows.push(agent); grouped.set(agent.teamId, rows); }
  return <aside className={`${open ? 'world-roster-open' : 'world-roster-closed'} world-roster world-control`} aria-label={t('worldUi.roster')}>
    <button className="world-roster-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>{t('worldUi.roster')} ({agents.length}) <span aria-hidden="true">{open ? '−' : '+'}</span></button>
    <div id={id} hidden={!open}>
      <button className="world-roster-agent" aria-pressed={selected === 'owner'} onClick={onOwner}>{t('worldUi.ownerDesk')}</button>
      {!agents.length ? !error && <p role="status" className="p-3 text-sm">{t(loading ? 'worldUi.loading' : 'worldUi.noAgents')}</p> : [...grouped].map(([teamId, members]) => <section key={teamId} className={highlight === teamId ? 'bg-accent/50' : undefined}>
        <h2 className="flex items-center gap-2 px-3 pt-3 pb-1 text-xs font-semibold text-muted-foreground"><span aria-hidden="true" className="size-3 shrink-0 rounded-full border border-border" style={{ backgroundColor: members[0]?.projectColor }} />{members[0]?.teamName || t('worldUi.team')}</h2>
        {members.map(agent => <div key={agent.seatId} className={agent.slot ? 'pl-5' : undefined}><button className="world-roster-agent" aria-pressed={selected === agent.seatId} onClick={() => onSelect(agent.seatId)}>
          <Mascot seat={agent.seatName} isLead={agent.isLead} state={agent.pose === 'resting' ? 'offline' : agent.pose} size={32} animated={false} />
          <span className="min-w-0 flex-1"><span className="block truncate font-medium">{agent.name}</span><span className="world-status" data-status={agent.status}>{t(agentStatusKey(agent))}</span></span>
        </button>{agent.runs.map(run => <button key={run.taskId} className="ml-3 p-1 font-mono text-xs underline" onClick={() => onTask(run.projectId, run.taskId)}>{run.code}</button>)}</div>)}
      </section>)}
    </div>
  </aside>;
}
