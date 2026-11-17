import { Mascot } from '@/components/mascot';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { DockedPane } from '../../DockedPane';
import { AgentOverview, type OfficeNeed } from '../../office/AgentCard';
import { officeSeat } from '../data/officeSeat';
import type { WorldAgent } from '../data/types';
import { agentStatusKey } from '../agentPresentation';

export function AgentPanel({ agent, store, following, onFollow, onClose, onTask, onReview, onTeam }: {
  agent: WorldAgent; store: Store; following: boolean; onFollow: () => void; onClose: () => void;
  onTask: (projectId: string, taskId: string) => void; onReview: (need: OfficeNeed) => void; onTeam: () => void;
}) {
  const t = useT(); const projectId = agent.runs[0]?.projectId;
  return <DockedPane label={agent.name} onClose={onClose} className="world-panel min-w-0 max-w-full">
    <div className="mb-4 flex items-start gap-3"><Mascot seat={agent.name} isLead={agent.isLead} state={agent.pose === 'resting' ? 'offline' : agent.pose} size={52} animated={false} /><div className="min-w-0 flex-1"><h2 className="font-semibold">{agent.name}</h2><p className="text-sm text-muted-foreground">{agent.role}</p><span className="world-status" data-status={agent.status}>{t(agentStatusKey(agent))}</span></div><Button size="sm" variant="ghost" onClick={onClose}>{t('worldUi.close')}</Button></div>
    <AgentOverview store={store} seat={officeSeat(agent, { name: agent.teamName || t('worldUi.team') })} now={Date.now()} onOpenTask={taskId => {
      const run = agent.runs.find(item => item.taskId === taskId); if (run) onTask(run.projectId, taskId);
    }} onReview={onReview} />
    <div className="mt-4 flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled={agent.overflow} aria-pressed={following} onClick={onFollow}>{t(following ? 'worldUi.unfollow' : 'worldUi.follow')}</Button>
      {projectId && <Button variant="outline" size="sm" asChild><a href={`#/project/${encodeURIComponent(projectId)}/office`}>{t('worldUi.projectOffice')}</a></Button>}
      <Button variant="outline" size="sm" onClick={onTeam}>{t('worldUi.openTeam')}</Button>
    </div>
  </DockedPane>;
}
