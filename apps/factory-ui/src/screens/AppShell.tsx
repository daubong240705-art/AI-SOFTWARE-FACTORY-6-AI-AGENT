import { MascotEmpty } from '@/components/mascot';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import type { Store } from '../state/store';
import { Dialog } from '../components/Dialog';
import { ProjectView } from './ProjectView';
import { CreateProject } from './CreateProject';
import { NewGameDialog } from './NewGameDialog';
import { Button } from '@/components/ui/button';
import { Page } from '@/components/Page';
import { Attention, attentionHash } from './Attention';
import { Teams } from './Teams';
import { System } from './system/SystemPage';
import { Overview } from './Overview';
import { useNavigation, type View } from './shell/navigation';
import { Sidebar } from './shell/Sidebar';
import { TopBar } from './shell/TopBar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Reveal } from '@/components/motion/Reveal';
import { useUiProfile } from '../config/uiProfile';

const compactQuery = '(max-width: 1179px)';
const MascotGallery = lazy(() => import('./MascotGallery'));
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

export function AppShell({ store }: { store: Store }) {
  const profile = useUiProfile();
  const t = useT(); const state = store.useStoreSelector(value => value);
  const { view, tab, teamTab, navigate } = useNavigation();
  const [chatProject, setChatProject] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [creatingGame, setCreatingGame] = useState(false);
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
  useEffect(() => { if (profile === 'games') setCreating(false); }, [profile]);
  const selected = state.projects.find(project => view === `project:${project.id}`);
  function go(next: View) { navigate(next); setExpanded(false); }
  function create() { setExpanded(false); if (profile === 'games') setCreatingGame(true); else setCreating(true); }
  function newTask() { setInitialTask(null); setFocusComposer(value => value + 1); go('overview'); }
  function openTask(projectId: string, taskId: string) { setInitialTask({ projectId, taskId }); navigate(`project:${projectId}`, 'board'); setExpanded(false); }
  const navigation = <Sidebar store={store} view={view} collapsed={collapsed && !compact} compact={compact} expanded={expanded} onNavigate={go} onCreate={create} onCollapse={() => compact ? setExpanded(false) : setCollapsed(value => !value)} />;
  const pageName = selected?.name ?? t(view === 'needs-attention' ? 'nav.attention' : view === 'team' ? 'nav.team' : view === 'system' ? 'systemUi.title' : 'nav.overview');
  return <div className={`app${collapsed && !compact ? ' sidebar-collapsed' : ''}`}>
    <a className="skip-link" href="#factory-main" onClick={event => { event.preventDefault(); main.current?.focus(); }}>{t('nav.skip')}</a>
    <TooltipProvider>{!compact && navigation}<TopBar store={store} compact={compact} expanded={expanded} onToggle={() => setExpanded(value => !value)} onNewTask={newTask} onProject={id => go(`project:${id}`)} onTask={openTask} />
    {compact && expanded && <Dialog labelledBy="navigation-title" onClose={() => setExpanded(false)} className="navigation-overlay"><h2 id="navigation-title" className="sr-only">{t('nav.main')}</h2>{navigation}</Dialog>}
    <main ref={main} id="factory-main" className={`content p-0${view === 'needs-attention' ? ' attention-content' : view.startsWith('project:') ? ' project-content' : ''}`} tabIndex={-1} aria-label={pageName} inert={compact && expanded}>
      <Reveal key={view} className="h-full min-h-0">
      {view === 'overview' && <Page className="flex flex-wrap justify-end gap-2 pb-0"><Button type="button" onClick={() => setCreatingGame(true)}>{t('gameUi.newGame')}</Button>{profile === 'full' && <Button type="button" variant="outline" onClick={create}>{t('projects.create')}</Button>}</Page>}
      {view === 'overview' ? <Overview store={store} onProject={id => { setChatProject(id); go(`project:${id}`); }} onCreate={create} onAttention={item => { navigate('needs-attention'); history.replaceState(null, '', attentionHash(item?.key)); }} focusComposer={focusComposer} onTask={openTask} />
        : view === 'needs-attention' ? <Attention store={store} />
        : view === 'team' ? <Teams store={store} tab={teamTab} onTabChange={next => navigate('team', 'overview', next)} onTask={openTask} />
        : view === 'system' ? <System store={store} />
        : view === 'mascots' ? <Suspense fallback={<MascotEmpty seat="Lead" state="thinking" compact><p role="status">{t('viewStates.loading')}</p></MascotEmpty>}><MascotGallery /></Suspense>
        : selected && state.selectedProjectId === selected.id ? <ProjectView key={selected.id} store={store} project={selected} tab={tab} onTabChange={next => navigate(view, next)} openChat={chatProject === selected.id} onChatOpened={() => setChatProject(null)} initialTaskId={initialTask?.projectId === selected.id ? initialTask.taskId : undefined} />
        : <MascotEmpty seat="Lead" state="thinking" compact><p role="status">{t('viewStates.loading')}</p></MascotEmpty>}
      </Reveal>
    </main>
    {creating && profile === 'full' && <CreateProject store={store} onClose={() => setCreating(false)} onCreated={id => go(`project:${id}`)} />}
    {creatingGame && <NewGameDialog store={store} onClose={() => setCreatingGame(false)} onCreated={id => go(`project:${id}`)} />}
    <p role="status" className="sr-only" aria-live="polite">{pageName}</p>
    <p role="status" className="sr-only" key={state.announcement}>{state.announcement > 0 ? t('inboxUi.decided') : ''}</p>
  </TooltipProvider></div>;
}
