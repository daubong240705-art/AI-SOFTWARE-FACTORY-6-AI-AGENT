import { Mascot } from '@/components/mascot';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { DockedPane } from '../../DockedPane';
import type { WorldAgent } from '../data/types';
import { agentStatusKey } from '../agentPresentation';

export function AgentPanel({ agent, following, onFollow, onClose, onTask, onReview, onTeam }: {
  agent: WorldAgent; following: boolean; onFollow: () => void; onClose: () => void;
  onTask: (projectId: string, taskId: string) => void; onReview: (need: WorldAgent['needsYou'][number]) => void; onTeam: () => void;
}) {
  const t = useT();
  return <DockedPane label={agent.name} onClose={onClose} className="world-panel min-w-0 max-w-full">
    <div className="mb-4 flex items-start gap-3"><Mascot seat={agent.seatName} isLead={agent.isLead} state={agent.pose === 'resting' ? 'offline' : agent.pose} size={52} animated={false} /><div className="min-w-0 flex-1"><h2 className="font-semibold">{agent.name}</h2><p className="text-sm text-muted-foreground">{agent.role}</p><span className="world-status" data-status={agent.status}>{t(agentStatusKey(agent))}</span></div><Button size="sm" variant="ghost" onClick={onClose}>{t('worldUi.close')}</Button></div>
    <p className="mb-3 break-words text-sm">{[agent.desk.agent.adapter, agent.desk.agent.model].filter(Boolean).join(' / ')}</p>
    <div className="mb-3 space-y-2">{agent.runs.map(run => <Button key={run.attemptId} variant="outline" size="sm" className="w-full justify-start text-left" onClick={() => onTask(run.projectId, run.taskId)}><span className="truncate">{run.code} · {run.title}</span></Button>)}
      {agent.desk.task && !agent.runs.some(run => run.taskId === agent.desk.task?.id) && <Button variant="outline" size="sm" onClick={() => onTask(agent.projectId, agent.desk.task!.id)}><span className="truncate">{agent.desk.task.title}</span></Button>}
      <p className="break-words text-sm text-muted-foreground">{agent.desk.progress?.message || t('officeUi.floorLive.noProgress')}</p>
      {agent.needsYou.map(need => <Button key={need.approvalId} size="sm" onClick={() => onReview(need)}>{t('workUi.decide')} · {need.code}</Button>)}
    </div>
    <div className="mt-4 flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled={agent.overflow} aria-pressed={following} onClick={onFollow}>{t(following ? 'worldUi.unfollow' : 'worldUi.follow')}</Button>
      <Button variant="outline" size="sm" onClick={onTeam}>{t('worldUi.openTeam')}</Button>
    </div>
  </DockedPane>;
}
