import { LoadingState } from '@/components/LoadingState';
import { shallowSelectionEqual } from '@/state/storeSelector';
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '../i18n';
import type { Store } from '../state/store';
import { Dialog } from '../components/Dialog';
import { ProjectView } from './ProjectView';
import { ProjectLinkState } from './ProjectLinkState';
import { CreateProject } from './CreateProject';
import { Attention, attentionHash } from './Attention';
import { System } from './system/SystemPage';
import { Overview } from './Overview';
import { useNavigation, type View } from './shell/navigation';
import { Sidebar } from './shell/Sidebar';
import { TopBar } from './shell/TopBar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Reveal } from '@/components/motion/Reveal';
import { GroupEditor } from './groups/GroupDialogs';
import { useGroupLabels, useGroups } from './groups/GroupsContext';

const compactQuery = '(max-width: 1179px)';
const WorldPage = lazy(() => import('./world/WorldPage'));
const GroupPage = lazy(() => import('./groups/GroupPage'));
function useCompact() {
  const [compact, setCompact] = useState(() => typeof matchMedia === 'function' && matchMedia(compactQuery).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const media = matchMedia(compactQuery);
    const update = () => setCompact(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return compact;
}

export function AppShell({ store, libraryPage }: { store: Store; libraryPage?: ReactNode }) {
  const t = useT(); const state = store.useStoreSelector(value => ({ projects: value.projects, selectedProjectId: value.selectedProjectId, announcement: value.announcement }), shallowSelectionEqual);
  const { view, tab, settingsSection, navigate } = useNavigation();
  const groupLabel = useGroupLabels();
  const { list: groups } = useGroups();
  const groupId = view.startsWith('group:') ? view.slice(6) : null;
  const group = groups.data?.groups.find(item => item.id === groupId);
  const [newTaskRequest, setNewTaskRequest] = useState<{ projectId: string; sequence: number } | null>(null);
  const [chatProject, setChatProject] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ groupId: string | null } | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [focusComposer, setFocusComposer] = useState(0);
  const [initialTask, setInitialTask] = useState<{ projectId: string; taskId: string } | null>(null);
  const compact = useCompact(); const main = useRef<HTMLElement>(null);
  const loaded = useRef<Store | null>(null);
  useEffect(() => { if (loaded.current !== store) { loaded.current = store; void store.loadProjects(); } }, [store]);
  useEffect(() => {
    if (!view.startsWith('project:')) return;
    const id = view.slice(8);
    if (state.projects.some(project => project.id === id) && state.selectedProjectId !== id) void store.selectProject(id);
  }, [store, view, state.projects, state.selectedProjectId]);
  useEffect(() => { setExpanded(false); main.current?.focus(); main.current?.scrollTo?.(0, 0); }, [view]);
  useEffect(() => { if (!compact) setExpanded(false); }, [compact]);
  const selected = state.projects.find(project => view === `project:${project.id}`);
  function go(next: View) { navigate(next); setExpanded(false); }
  function createProject(id: string | null) { setExpanded(false); setCreating({ groupId: id }); }
  function create(kind: 'task' | 'project') {
    setExpanded(false);
    if (kind === 'project') createProject(group?.archived ? null : groupId);
    else if (view.startsWith('project:')) { setInitialTask(null); setNewTaskRequest(value => ({ projectId: view.slice(8), sequence: (value?.sequence ?? 0) + 1 })); navigate(view, 'board'); }
    else newTask();
  }
  function newTask() { setInitialTask(null); setFocusComposer(value => value + 1); go('overview'); }
  function openTask(projectId: string, taskId: string) { setInitialTask({ projectId, taskId }); navigate(`project:${projectId}`, 'board'); setExpanded(false); }
  const navigation = <Sidebar store={store} view={view} collapsed={collapsed && !compact} compact={compact} expanded={expanded} onNavigate={go} onCollapse={() => compact ? setExpanded(false) : setCollapsed(value => !value)}
    onNewProject={() => createProject(null)} onNewGroup={() => { setExpanded(false); setCreatingGroup(true); }} />;
  const pageName = groupId ? group?.name ?? groupLabel('projectGroup') : selected?.name ?? t(view === 'needs-attention' ? 'nav.attention' : view === 'library' ? 'nav.library' : view === 'world' ? 'nav.world' : view === 'system' ? 'systemUi.title' : 'nav.overview');
  return <div className={`app${collapsed && !compact ? ' sidebar-collapsed' : ''}`}>
    <a className="skip-link" href="#factory-main" onClick={event => { event.preventDefault(); main.current?.focus(); }}>{t('nav.skip')}</a>
    <TooltipProvider>{!compact && navigation}<TopBar store={store} compact={compact} expanded={expanded} onToggle={() => setExpanded(value => !value)} onCreate={create} onProject={id => go(`project:${id}`)} onTask={openTask} />
    {compact && expanded && <Dialog labelledBy="navigation-title" onClose={() => setExpanded(false)} className="navigation-overlay"><h2 id="navigation-title" className="sr-only">{t('nav.main')}</h2>{navigation}</Dialog>}
    <main ref={main} id="factory-main" className={`content p-0${view === 'needs-attention' ? ' attention-content' : view === 'world' ? ' world-content' : view.startsWith('project:') ? ' project-content' : ''}`} tabIndex={-1} aria-label={pageName} inert={compact && expanded}>
      <Reveal key={view} className="h-full min-h-0">
      {view === 'overview' ? <Overview store={store} onOpenProject={id => go(`project:${id}`)} onProject={id => { setChatProject(id); go(`project:${id}`); }} onCreate={create} onAttention={item => { navigate('needs-attention'); history.replaceState(null, '', attentionHash(item?.key)); }} focusComposer={focusComposer} onTask={openTask} />
        : view === 'needs-attention' ? <Attention store={store} />
        : view === 'library' ? <Suspense fallback={<LoadingState />}>{libraryPage}</Suspense>
        : view === 'world' ? <Suspense fallback={<LoadingState />}><WorldPage store={store} projects={state.projects} onNavigate={go} onTask={openTask} /></Suspense>
        : view === 'system' ? <System store={store} />
        : groupId ? <Suspense fallback={<LoadingState />}><GroupPage key={groupId} id={groupId} store={store} onNavigate={go} onNewProject={createProject} /></Suspense>
        : selected && state.selectedProjectId === selected.id ? <ProjectView key={selected.id} store={store} project={selected} tab={tab} settingsSection={settingsSection} onTabChange={(next, section) => navigate(view, next, section)} newTaskRequest={newTaskRequest?.projectId === selected.id ? newTaskRequest.sequence : 0} onNewTaskOpened={() => setNewTaskRequest(null)} openChat={chatProject === selected.id} onChatOpened={() => setChatProject(null)} initialTaskId={initialTask?.projectId === selected.id ? initialTask.taskId : undefined} />
        : view.startsWith('project:') && !selected ? <ProjectLinkState key={view} store={store} projectId={view.slice(8)} onOverview={() => go('overview')} /> : <LoadingState />}
      </Reveal>
    </main>
    {creating && <CreateProject store={store} initialGroupId={creating.groupId} onClose={() => setCreating(null)} onCreated={id => go(`project:${id}`)} />}
    {creatingGroup && <GroupEditor close={() => setCreatingGroup(false)} onCreated={id => go(`group:${id}`)} />}
    <p role="status" className="sr-only" aria-live="polite">{pageName}</p>
    <p role="status" className="sr-only" key={state.announcement}>{state.announcement > 0 ? t('inboxUi.decided') : ''}</p>
  </TooltipProvider></div>;
}
