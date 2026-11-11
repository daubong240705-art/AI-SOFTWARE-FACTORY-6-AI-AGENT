import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Project } from '@factory/contracts';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useT } from '../i18n';
import type { Store } from '../state/store';
import { DockedPane } from './DockedPane';
import { ProjectChat } from './ProjectChat';
import { ProjectTasks } from './ProjectTasks';
import { ProjectOverview } from './ProjectOverview';
import { ProjectKnowledge } from './ProjectKnowledge';
import { ProjectWorkflow } from './ProjectWorkflow';
import { ProjectAutomation } from './ProjectAutomation';
import { ProjectSettings } from './ProjectSettings';
import { DossierPanel } from './Dossier';
import { useNavigation, type ProjectTab } from './shell/navigation';

const tabs = ['overview', 'board', 'workflow', 'automation', 'knowledge', 'settings'] as const;
export function ProjectView({ store, project, tab, onTabChange, openChat = false, onChatOpened, initialTaskId }: {
  store: Store; project: Project; tab?: ProjectTab; onTabChange?: (tab: ProjectTab) => void; openChat?: boolean; onChatOpened?: () => void; initialTaskId?: string | undefined;
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
  useEffect(() => { if (initialTaskId) { setChat(false); setSelected(initialTaskId); } }, [initialTaskId]);
  function select(next: ProjectTab) {
    if (onTabChange) onTabChange(next); else navigation.navigate(`project:${project.id}`, next);
  }
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); select(tabs[next]!); buttons.current[next]?.focus();
  }
  function openTask(taskId: string) { setChat(false); setSelected(taskId); select('board'); }
  return <div className="project-view flex h-full min-h-0 flex-col">
    <header role="generic" className="flex-none px-6 pt-6 max-sm:px-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-4"><h1 className="m-0 min-w-0 font-display text-2xl font-semibold tracking-tight">{project.name}</h1><div className="flex flex-wrap items-center gap-2">
        {active === 'board' && <Button aria-expanded={creating} aria-controls={`${id}-new-task`} onClick={() => setCreating(!creating)}>{t('taskUi.new')}</Button>}
        <Button ref={ask} variant="outline" aria-expanded={chat} aria-controls={`${id}-chat`} onClick={() => { setSelected(null); setChat(!chat); }}>{t('projectUi.askLead')}</Button>
      </div></div>
      <Tabs value={active} onValueChange={value => select(value as ProjectTab)} className="gap-0">
        <TabsList variant="line" aria-label={t('shell.projectTabs')} className="w-full justify-start gap-1 overflow-x-auto rounded-none border-b border-border p-0">
          {tabs.map((value, index) => <TabsTrigger key={value} ref={node => { buttons.current[index] = node; }} value={value} id={`${id}-${value}`} aria-controls={`${id}-panel`} onClick={() => select(value)} onKeyDown={event => navigate(event, index)} className="flex-none rounded-none px-3.5 py-2 text-sm">{t(`projectUi.${value}`)}</TabsTrigger>)}
        </TabsList>
      </Tabs>
    </header>
    <div className={`project-body${chat ? ' has-chat' : ''}`}>
      <div className="project-tab-content" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${active}`} tabIndex={0}>
        {active === 'overview' && <ProjectOverview store={store} onOpenTask={openTask} />}
        {active === 'board' && <ProjectTasks store={store} projectId={project.id} selectedTask={selected} onOpenTask={openTask} onCloseTask={() => setSelected(null)} newTaskOpen={creating} newTaskId={`${id}-new-task`} />}
        {active === 'workflow' && <ProjectWorkflow key={project.id} store={store} projectId={project.id} onOpenTask={openTask} />}
        {active === 'automation' && <ProjectAutomation key={project.id} store={store} projectId={project.id} />}
        {active === 'settings' && <ProjectSettings key={project.id} store={store} projectId={project.id} />}
        {active === 'knowledge' && <div className="project-knowledge stack"><section className="stack" aria-labelledby={`${id}-documents`}><h2 id={`${id}-documents`}>{t('projectUi.documents')}</h2><ProjectKnowledge store={store} projectId={project.id} /></section><DossierPanel store={store} /></div>}
      </div>
      {chat && <DockedPane id={`${id}-chat`} label={t('projectUi.chat')} className="project-chat-dock" onClose={() => setChat(false)} fallbackFocus={() => ask.current}>
        <header className="project-dock-header"><h2>{t('projectUi.askLead')}</h2><Button onClick={() => { setChat(false); ask.current?.focus(); }}>{t('projectUi.closeChat')} <kbd>Esc</kbd></Button></header>
        <ProjectChat store={store} projectId={project.id} showBudget={active !== 'overview'} />
      </DockedPane>}
    </div>
  </div>;
}
