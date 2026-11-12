import { PanelPresence, usePanelLayout } from '@/components/motion/PanelPresence';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Project } from '@factory/contracts';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BookOpen, Columns3, GitBranch, LayoutGrid, MessageSquare, Plus, Settings, Workflow, Zap } from 'lucide-react';
import { useT } from '../i18n';
import type { Store } from '../state/store';
import { DockedPane } from './DockedPane';
import { ProjectChat } from './ProjectChat';
import { ProjectTasks } from './ProjectTasks';
import { ProjectOverview } from './ProjectOverview';
import { ProjectKnowledge } from './ProjectKnowledge';
import { ProjectCode } from './ProjectCode';
import { ProjectWorkflow } from './ProjectWorkflow';
import { ProjectAutomation } from './ProjectAutomation';
import { ProjectSettings } from './ProjectSettings';
import { useNavigation, type ProjectTab } from './shell/navigation';
import { Page } from '../components/Page';
import { ProjectTile } from './shell/ProjectTile';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { Reveal } from '@/components/motion/Reveal';

const tabs = ['overview', 'board', 'workflow', 'automation', 'knowledge', 'code', 'settings'] as const;
const tabIcons = { overview: LayoutGrid, board: Columns3, workflow: Workflow, automation: Zap, knowledge: BookOpen, code: GitBranch, settings: Settings };
export function ProjectView({ store, project, tab, onTabChange, openChat = false, onChatOpened, initialTaskId }: {
  store: Store; project: Project; tab?: ProjectTab; onTabChange?: (tab: ProjectTab) => void; openChat?: boolean; onChatOpened?: () => void; initialTaskId?: string | undefined;
}) {
  const t = useT(); const id = useId();
  const reduced = useReducedMotion();
  const navigation = useNavigation();
  const active: ProjectTab = tab ?? navigation.tab ?? 'overview';
  const [chat, setChat] = useState(openChat);
  const [chatVisible, chatExited] = usePanelLayout(chat);
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
    <Page className="min-w-0 flex-none pt-4 pb-0"><header role="generic" className="flex h-14 items-center overflow-x-auto rounded-xl border border-border bg-card px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ProjectTile id={project.id} name={project.name} className="size-8" />
      <h1 className="m-0 ml-2.5 hidden max-w-48 shrink-0 truncate font-sans text-base leading-normal font-medium sm:block" title={project.name}>{project.name}</h1>
      <Separator orientation="vertical" className="mx-3 shrink-0 data-[orientation=vertical]:h-6" />
      <LayoutGroup id={`${id}-project-tabs`}><Tabs value={active} onValueChange={value => select(value as ProjectTab)} className="shrink-0 gap-0">
        <TabsList aria-label={t('shell.projectTabs')} className="justify-start gap-1 bg-transparent p-0">
          {tabs.map((value, index) => {
            const Icon = tabIcons[value];
            return <TabsTrigger key={value} ref={node => { buttons.current[index] = node; }} value={value} id={`${id}-${value}`} aria-controls={`${id}-panel`} onClick={() => select(value)} onKeyDown={event => navigate(event, index)} className="h-9 flex-none gap-2 rounded-lg border-0 px-3 text-sm font-medium text-muted-foreground hover:bg-secondary/50 hover:text-foreground data-[state=active]:!bg-transparent data-[state=active]:!text-foreground group-data-[variant=default]/tabs-list:data-[state=active]:shadow-none">
              {active === value && <motion.span layoutId="pill" aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-lg bg-secondary/70" transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 32 }} />}
              <Icon className="relative size-4" aria-hidden="true" /><span className="relative">{t(`projectUi.${value}`)}</span>
              {active === value && <motion.span layoutId="underline" aria-hidden="true" className="pointer-events-none absolute right-3 bottom-0 left-3 h-0.5 rounded-full bg-tab-accent" transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 32 }} />}
            </TabsTrigger>;
          })}
        </TabsList>
      </Tabs></LayoutGroup>
      <div className="ml-auto flex shrink-0 items-center gap-2 pl-3">
        {active === 'board' && <Button variant="default" className="h-9 w-9 border-0 px-0 sm:w-auto sm:px-3" aria-label={t('taskUi.new')} aria-expanded={creating} aria-controls={`${id}-new-task`} onClick={() => setCreating(!creating)}><Plus className="size-4" aria-hidden="true" /><span className="hidden sm:inline">{t('taskUi.new')}</span></Button>}
        <Button ref={ask} variant="outline" className="h-9 w-9 px-0 sm:w-auto sm:px-3" aria-label={t('projectUi.askLead')} aria-expanded={chat} aria-controls={`${id}-chat`} onClick={() => { setSelected(null); setChat(!chat); }}><MessageSquare className="size-4" aria-hidden="true" /><span className="hidden sm:inline">{t('projectUi.askLead')}</span></Button>
      </div>
    </header></Page>
    <div className={`project-body${chatVisible ? ' has-chat' : ''}`}>
      <div className="project-tab-content" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${active}`} tabIndex={0}>
        <Reveal key={active} className="h-full min-h-0">
        {active === 'overview' && <ProjectOverview store={store} onOpenTask={openTask} />}
        {active === 'board' && <ProjectTasks store={store} projectId={project.id} selectedTask={selected} onOpenTask={openTask} onCloseTask={() => setSelected(null)} newTaskOpen={creating} newTaskId={`${id}-new-task`} />}
        {active === 'workflow' && <ProjectWorkflow key={project.id} store={store} projectId={project.id} onOpenTask={openTask} />}
        {active === 'automation' && <ProjectAutomation key={project.id} store={store} projectId={project.id} />}
        {active === 'settings' && <ProjectSettings key={project.id} store={store} projectId={project.id} />}
        {active === 'knowledge' && <ProjectKnowledge key={project.id} store={store} projectId={project.id} />}
        {active === 'code' && <ProjectCode key={project.id} store={store} projectId={project.id} />}
        </Reveal>
      </div>
      <PanelPresence className="project-chat-dock min-h-0 min-w-0" fallbackFocus={() => ask.current} onExitComplete={chatExited}>{chat && <DockedPane id={`${id}-chat`} label={t('projectUi.chat')} className="project-chat-dock h-full p-0" onClose={() => setChat(false)} fallbackFocus={() => ask.current}>
        <ProjectChat store={store} projectId={project.id} showBudget={active !== 'overview'} onClose={() => { setChat(false); ask.current?.focus(); }} />
      </DockedPane>}</PanelPresence>
    </div>
  </div>;
}

