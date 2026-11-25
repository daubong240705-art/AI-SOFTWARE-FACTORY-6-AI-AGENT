import { PanelPresence, usePanelLayout } from '@/components/motion/PanelPresence';
import { lazy, Suspense, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Project } from '@factory/contracts';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Activity, BookOpen, Bot, Columns3, Ellipsis, LayoutGrid, MessageSquare, Settings, Users, Workflow } from 'lucide-react';
import { useT } from '../i18n';
import type { Store } from '../state/store';
import { DockedPane } from './DockedPane';
import { ProjectChat } from './ProjectChat';
import { ProjectTasks } from './ProjectTasks';
import { ProjectOverview } from './ProjectOverview';
import { ProjectDocuments } from './monitor/ProjectDocuments';
import { ProjectSettingsPage } from './project-settings/ProjectSettingsPage';
import { ProjectOffice } from './office/ProjectOffice';
import { LoadingState } from '@/components/LoadingState';
import { useNavigation, type ProjectTab, type SettingsSection } from './shell/navigation';
import { Page } from '../components/Page';
import { ProjectTile } from './shell/ProjectTile';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { Reveal } from '@/components/motion/Reveal';

const tabIcons = { overview: LayoutGrid, agents: Bot, flows: Workflow, monitor: Activity, office: Users, board: Columns3, knowledge: BookOpen, settings: Settings };
const tabs = ['overview', 'agents', 'flows', 'monitor', 'office', 'board', 'knowledge'] as const;
const ProjectAgents = lazy(() => import('./agents/ProjectAgents').then(module => ({ default: module.ProjectAgents })));
const ProjectFlows = lazy(() => import('./flows/ProjectFlows'));
const ProjectObservability = lazy(() => import('./monitor/ProjectObservability'));
const ArtifactDetail = lazy(() => import('./monitor/ArtifactDetail'));
const FlowSetupAction = lazy(() => import('./setup/FlowSetupAction'));
export function ProjectView({ store, project, tab, onTabChange, openChat = false, onChatOpened, initialTaskId, settingsSection, newTaskRequest = 0, onNewTaskOpened }: {
  store: Store; project: Project; tab?: ProjectTab; onTabChange?: (tab: ProjectTab, section?: SettingsSection) => void; openChat?: boolean; onChatOpened?: () => void; initialTaskId?: string | undefined; settingsSection?: SettingsSection; newTaskRequest?: number; onNewTaskOpened?: () => void;
}) {
  const t = useT(); const id = useId();
  const reduced = useReducedMotion();
  const navigation = useNavigation();
  const requestedTab = tab ?? navigation.tab;
  const legacySection = requestedTab === 'code' ? requestedTab : undefined;
  const active = legacySection ? 'settings' : requestedTab;
  const [chat, setChat] = useState(openChat);
  const [chatVisible, chatExited] = usePanelLayout(chat);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const tabStrip = useRef<HTMLDivElement>(null);
  const ask = useRef<HTMLButtonElement>(null);
  const compactActions = useRef<HTMLButtonElement>(null);
  const actionFocus = () => ask.current?.getClientRects().length ? ask.current : compactActions.current;
  useEffect(() => {
    const strip = tabStrip.current;
    const button = buttons.current.find(item => item?.dataset.state === 'active');
    if (!strip || !button) return;
    const viewport = strip.getBoundingClientRect();
    const bounds = button.getBoundingClientRect();
    if (bounds.left < viewport.left + 12) strip.scrollLeft += bounds.left - viewport.left - 12;
    else if (bounds.right > viewport.right - 12) strip.scrollLeft += bounds.right - viewport.right + 12;
  }, [active]);
  useEffect(() => {
    if (openChat) { setSelected(null); setChat(true); onChatOpened?.(); }
  }, [openChat, onChatOpened]);
  useEffect(() => { if (active !== 'board') setSelected(null); }, [active]);
  useEffect(() => { if (initialTaskId) { setChat(false); setSelected(initialTaskId); } }, [initialTaskId]);
  useEffect(() => { if (newTaskRequest) { setSelected(null); setChat(false); setCreating(true); onNewTaskOpened?.(); } }, [newTaskRequest, onNewTaskOpened]);
  useEffect(() => { if (active !== 'board') setCreating(false); }, [active]);
  function select(next: ProjectTab, section?: SettingsSection) {
    if (onTabChange) onTabChange(next, section); else navigation.navigate(`project:${project.id}`, next, section);
  }
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); select(tabs[next]!); buttons.current[next]?.focus();
  }
  function openTask(taskId: string) { setChat(false); setSelected(taskId); select('board'); }
  return <div className="project-view flex h-full min-h-0 flex-col">
    <Page className="min-w-0 flex-none px-4 pt-4 pb-0 sm:px-8"><header role="generic" className="flex h-14 min-w-0 items-center border-b border-border">
      <ProjectTile id={project.id} name={project.name} className="size-8 shrink-0" />
      <h1 className="m-0 ml-2.5 max-w-[min(18vw,12rem)] shrink-0 truncate font-sans text-base leading-normal font-medium" title={project.name}>{project.name}</h1>
      <Separator orientation="vertical" className="mx-2 shrink-0 data-[orientation=vertical]:h-6" />
      <div ref={tabStrip} className="min-w-0 flex-1 overflow-x-auto px-3 py-1 [mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-12px),transparent)] [scrollbar-width:none]">
      <LayoutGroup id={`${id}-project-tabs`}><Tabs value={active} onValueChange={value => select(value as ProjectTab)} className="w-max gap-0">
        <TabsList aria-label={t('shell.projectTabs')} className="flex-nowrap gap-1 bg-transparent p-0 whitespace-nowrap">
          {tabs.map((value, index) => {
            const Icon = tabIcons[value];
            return <TabsTrigger data-testid={`project-tab-${value}`} key={value} ref={node => { buttons.current[index] = node; }} value={value} id={`${id}-${value}`} aria-controls={`${id}-panel`} onClick={() => { if (active !== 'flows' || value === 'flows') select(value); }} onKeyDown={event => navigate(event, index)} className="h-9 flex-none gap-2 rounded-lg border-0 px-3 text-sm font-medium text-muted-foreground hover:bg-secondary/50 hover:text-foreground data-[state=active]:!bg-transparent data-[state=active]:!text-foreground group-data-[variant=default]/tabs-list:data-[state=active]:shadow-none">
              {active === value && <motion.span layoutId="pill" aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-lg bg-secondary/70" transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 32 }} />}
              <Icon className="relative size-4" aria-hidden="true" /><span className="relative">{t(value === 'agents' ? 'agentsAdmin.title' : value === 'flows' ? 'flowsUi.title' : value === 'monitor' ? 'traceUi.monitor' : `projectUi.${value}`)}</span>
              {active === value && <motion.span layoutId="underline" aria-hidden="true" className="pointer-events-none absolute right-3 bottom-0 left-3 h-0.5 rounded-full bg-tab-accent" transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 32 }} />}
            </TabsTrigger>;
          })}
        </TabsList>
      </Tabs></LayoutGroup></div>
      <Button data-testid="project-tab-settings" id={`${id}-settings`} type="button" variant="ghost" size="icon" className={`ml-1 shrink-0 ${active === 'settings' ? 'bg-secondary text-foreground' : 'text-muted-foreground'}`} aria-label={t('projectUi.settings')} aria-current={active === 'settings' ? 'page' : undefined} onClick={() => select('settings')}><Settings aria-hidden="true" /></Button>
      <div className="flex shrink-0 items-center gap-2 pl-2">
        <Button ref={ask} variant="outline" className="hidden min-[1300px]:inline-flex" aria-expanded={chat} aria-controls={`${id}-chat`} onClick={() => { setSelected(null); setChat(!chat); }}><MessageSquare className="size-4" aria-hidden="true" />{t('projectUi.askLead')}</Button>
        <DropdownMenu><DropdownMenuTrigger asChild><Button ref={compactActions} type="button" variant="outline" size="icon" className="min-[1300px]:hidden" aria-label={t('commonUi.actions')}><Ellipsis aria-hidden="true" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => { setSelected(null); setChat(!chat); }}><MessageSquare aria-hidden="true" />{t('projectUi.askLead')}</DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header></Page>
    <div className={`project-body${chatVisible ? ' has-chat' : ''}`}>
      <div className="project-tab-content" role="tabpanel" id={`${id}-panel`} aria-labelledby={active === 'settings' ? `${id}-settings` : `${id}-${active}`} tabIndex={0}>
        <Reveal key={active} className="h-full min-h-0">
        {active === 'overview' && <ProjectOverview store={store} onOpenTask={openTask} onOpenSettings={section => select('settings', section)} />}
        {active === 'agents' && <Suspense fallback={<LoadingState />}><ProjectAgents key={project.id} projectId={project.id} linkedAgentId={navigation.agentId} /></Suspense>}
        {active === 'flows' && <Suspense fallback={<LoadingState />}><div className="flex h-full min-h-0 flex-col">
          {navigation.flowRoute?.kind === 'flows' && <FlowSetupAction key={navigation.flowRoute.id} projectId={project.id} flowId={navigation.flowRoute.id} />}
          <div className="min-h-0 flex-1"><ProjectFlows key={project.id} projectId={project.id} route={navigation.flowRoute} store={store} onOpenTask={openTask} /></div>
        </div></Suspense>}
        {active === 'monitor' && <Suspense fallback={<LoadingState />}><ProjectObservability key={navigation.traceId ?? project.id} projectId={project.id} traceId={navigation.traceId} store={store} onOpenTask={openTask} /></Suspense>}
        {active === 'office' && <ProjectOffice key={project.id} store={store} projectId={project.id} onOpenTab={select} />}
        {active === 'board' && <ProjectTasks store={store} projectId={project.id} selectedTask={selected} onOpenTask={openTask} onCloseTask={() => setSelected(null)} newTaskOpen={creating} onCloseNewTask={() => setCreating(false)} newTaskId={`${id}-new-task`} />}
        {active === 'settings' && <ProjectSettingsPage key={project.id} store={store} projectId={project.id} section={legacySection ?? settingsSection ?? navigation.settingsSection} onSection={section => select('settings', section)} />}
        {active === 'knowledge' && (navigation.artifact ? <Suspense fallback={<LoadingState />}><ArtifactDetail key={`${navigation.artifact.id}:${navigation.artifact.version}`} store={store} projectId={project.id} target={navigation.artifact} /></Suspense> : <ProjectDocuments key={project.id} store={store} projectId={project.id} />)}
        </Reveal>
      </div>
      <PanelPresence className="project-chat-dock min-h-0 min-w-0" fallbackFocus={actionFocus} onExitComplete={chatExited}>{chat && <DockedPane id={`${id}-chat`} label={t('projectUi.chat')} className="project-chat-dock h-full p-0" onClose={() => setChat(false)} fallbackFocus={actionFocus}>
        <ProjectChat store={store} projectId={project.id} onClose={() => { setChat(false); actionFocus()?.focus(); }} />
      </DockedPane>}</PanelPresence>
    </div>
  </div>;
}

