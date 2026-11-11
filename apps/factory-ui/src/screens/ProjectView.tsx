import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Project } from '@factory/contracts';
import { Button } from '../components/Button';
import { useT } from '../i18n';
import type { Store } from '../state/store';
import { DockedPane } from './DockedPane';
import { ProjectChat } from './ProjectChat';
import { ProjectTasks } from './ProjectTasks';
import { ProjectOverview } from './ProjectOverview';
import { ProjectKnowledge } from './ProjectKnowledge';
import { DossierPanel } from './Dossier';
import { useNavigation, type ProjectTab } from './shell/navigation';

const tabs = ['overview', 'board', 'knowledge'] as const;
export function ProjectView({ store, project, tab, onTabChange, openChat = false, onChatOpened }: {
  store: Store; project: Project; tab?: ProjectTab; onTabChange?: (tab: ProjectTab) => void; openChat?: boolean; onChatOpened?: () => void;
}) {
  const t = useT(); const id = useId();
  const navigation = useNavigation();
  const active: ProjectTab = tab ?? navigation.tab ?? 'overview';
  const [chat, setChat] = useState(openChat);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const ask = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (openChat) { setSelected(null); setChat(true); onChatOpened?.(); }
  }, [openChat, onChatOpened]);
  useEffect(() => { if (active !== 'board') setSelected(null); }, [active]);
  function select(next: ProjectTab) {
    if (onTabChange) onTabChange(next); else navigation.navigate(`project:${project.id}`, next);
  }
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); select(tabs[next]!); buttons.current[next]?.focus();
  }
  function openTask(taskId: string) { setChat(false); setSelected(taskId); select('board'); }
  return <div className="project-view">
    <header role="generic" className="projectbar">
      <div className="project-title-row"><h1>{project.name}</h1><div className="task-actions">
        {active === 'board' && <Button aria-expanded={creating} aria-controls={`${id}-new-task`} onClick={() => setCreating(!creating)}>{t('taskUi.new')}</Button>}
        <button ref={ask} type="button" aria-expanded={chat} aria-controls={`${id}-chat`} onClick={() => { setSelected(null); setChat(!chat); }}>{t('projectUi.askLead')}</button>
      </div></div>
      <div role="tablist" aria-label={t('shell.projectTabs')} className="project-tabs">
        {tabs.map((value, index) => <button key={value} ref={node => { buttons.current[index] = node; }} type="button" role="tab" id={`${id}-${value}`} aria-controls={`${id}-panel`} aria-selected={active === value} tabIndex={active === value ? 0 : -1} onClick={() => select(value)} onKeyDown={event => navigate(event, index)}>{t(`projectUi.${value}`)}</button>)}
      </div>
    </header>
    <div className={`project-body${chat ? ' has-chat' : ''}`}>
      <div className="project-tab-content" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${active}`} tabIndex={0}>
        {active === 'overview' && <ProjectOverview store={store} onOpenTask={openTask} />}
        {active === 'board' && <ProjectTasks store={store} projectId={project.id} selectedTask={selected} onOpenTask={openTask} onCloseTask={() => setSelected(null)} newTaskOpen={creating} newTaskId={`${id}-new-task`} />}
        {active === 'knowledge' && <div className="project-knowledge stack"><section className="stack" aria-labelledby={`${id}-documents`}><h2 id={`${id}-documents`}>{t('projectUi.documents')}</h2><ProjectKnowledge store={store} projectId={project.id} /></section><DossierPanel store={store} /></div>}
      </div>
      {chat && <DockedPane id={`${id}-chat`} label={t('projectUi.chat')} className="project-chat-dock" onClose={() => setChat(false)} fallbackFocus={() => ask.current}>
        <header className="project-dock-header"><h2>{t('projectUi.askLead')}</h2><Button onClick={() => { setChat(false); ask.current?.focus(); }}>{t('projectUi.closeChat')} <kbd>Esc</kbd></Button></header>
        <ProjectChat store={store} projectId={project.id} showBudget={active !== 'overview'} />
      </DockedPane>}
    </div>
  </div>;
}
