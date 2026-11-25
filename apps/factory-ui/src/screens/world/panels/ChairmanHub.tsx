import { lazy, Suspense, useId } from 'react';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/LoadingState';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { openFlowRoute, viewHash, type View } from '../../shell/navigation';
import { DockedPane } from '../../DockedPane';
import { agentStatusKey } from '../agentPresentation';
import type { WorldData } from '../data/useWorldData';
import { WorldActivity } from '../WorldActivity';
import { chairmanTabs, type ChairmanTab } from './chairmanTabs';

const Attention = lazy(() => import('../../Attention').then(module => ({ default: module.Attention })));
export function ChairmanHub({ store, data, attention, tab, onTab, onClose, onNavigate, onTask }: {
  store: Store; data: WorldData; attention: number; tab: ChairmanTab; onTab: (tab: ChairmanTab) => void;
  onClose: () => void; onNavigate: (view: View) => void;
  onTask: (projectId: string, taskId: string) => void;
}) {
  const t = useT(); const id = useId(); const { model, interactions, sources } = data; const projectId = model.focusProjectId;
  const interactionState = sources[`interactions:${projectId}`]?.state;
  const flowState = sources[`flows:${projectId}`]?.state;
  const agentState = sources[`agents:${projectId}`]?.state;
  const agents = model.agents.filter(agent => agent.projectId === projectId);
  const fullPage = () => {
    if (tab === 'attention' || tab === 'activity' || !projectId) { onNavigate(tab === 'attention' ? 'needs-attention' : 'overview'); return; }
    location.hash = viewHash(`project:${projectId}`, tab === 'flows' || tab === 'agents' ? tab : 'overview');
  };
  return <DockedPane label={t('worldUi.ownerDesk')} onClose={onClose} className="world-panel chairman-hub" fallbackFocus={() => document.querySelector<HTMLElement>('.world-map')}>
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4"><h2 className="font-display text-lg font-semibold">{t('worldUi.ownerDesk')}</h2><div className="flex gap-2"><Button size="sm" variant="outline" onClick={fullPage}>{t('worldUi.chairman.fullPage')}</Button><Button size="sm" variant="ghost" onClick={onClose}>{t('worldUi.close')}</Button></div></header>
    <div role="tablist" aria-label={t('worldUi.ownerDesk')} className="chairman-tabs" onKeyDown={event => {
      const index = chairmanTabs.indexOf(tab);
      const next = event.key === 'ArrowRight' ? (index + 1) % chairmanTabs.length : event.key === 'ArrowLeft' ? (index + chairmanTabs.length - 1) % chairmanTabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? chairmanTabs.length - 1 : -1;
      if (next < 0) return; event.preventDefault(); onTab(chairmanTabs[next]!);
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
    }}>{chairmanTabs.map(key => <button key={key} role="tab" id={`${id}-${key}`} aria-controls={`${id}-panel`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} onClick={() => onTab(key)}>{t(`worldUi.chairman.tabs.${key}`)}{key === 'attention' ? ` (${attention})` : ''}</button>)}</div>
    {(tab === 'agents' || tab === 'flows' || tab === 'activity') && <label className="flex items-center gap-3 border-b border-border px-4 py-2 text-sm">{t('overview.project')}<select className="min-w-0 flex-1 rounded border border-border bg-background p-2" value={projectId ?? ''} disabled={!model.projects.length} onChange={event => data.setFocusProjectId(event.target.value)}>{model.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} tabIndex={0} className="chairman-content">
      <Suspense fallback={<LoadingState inline />}>
        {tab === 'projects' && <div className="space-y-3 p-4">{!model.loaded.projects ? <LoadingState inline /> : !model.projects.length ? <p>{t('projects.empty')}</p> : model.buildings.map(building => <section key={building.id}><h3 className="mb-1 text-sm font-semibold">{building.name ?? t('worldUi.campus.shared')}</h3><ul className="space-y-2">{building.rooms.map(project => <li key={project.id}><a className="underline" href={viewHash(`project:${project.id}`)}>{project.name}</a></li>)}</ul></section>)}</div>}
        {tab === 'agents' && <div className="space-y-2 p-4">{agentState === 'error' && <p role="status">{t('worldUi.sourceError')}</p>}{!agents.length ? agentState !== 'error' && <p>{t(projectId && agentState !== 'ok' ? 'worldUi.campus.loading' : 'worldUi.noAgents')}</p> : agents.map(agent => <p key={agent.seatId}><strong>{agent.name}</strong> · {agent.role} · {t(agentStatusKey(agent))}</p>)}</div>}
        {tab === 'flows' && <div className="space-y-2 p-4">{flowState === 'error' && <p role="status">{t('worldUi.sourceError')}</p>}{!model.workflowLoaded ? flowState !== 'error' && <p>{t(projectId ? 'worldUi.campus.loading' : 'officeUi.floorLive.noFlows')}</p> : !model.workflows.length ? <p>{t('officeUi.floorLive.noFlows')}</p> : model.workflows.map(item => <Button key={item.run.id} variant="outline" className="w-full justify-between" onClick={() => openFlowRoute(item.run.projectId, { kind: 'runs', id: item.run.id })}><span className="truncate">{item.title}</span><span>{t(`flowsUi.state.${item.run.state}`)}</span></Button>)}</div>}
        {tab === 'attention' && <Attention store={store} embedded />}
        {tab === 'activity' && <WorldActivity embedded office={projectId ? interactions[projectId] : undefined} projectName={model.projects.find(project => project.id === projectId)?.name ?? null}
          loading={!!projectId && (!interactionState || interactionState === 'pending')} error={interactionState === 'error'} onTask={taskId => { if (projectId) onTask(projectId, taskId); }} />}
      </Suspense>
    </div>
  </DockedPane>;
}
