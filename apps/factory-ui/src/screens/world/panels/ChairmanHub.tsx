import { lazy, Suspense, useEffect, useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/LoadingState';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import type { View, TeamTab } from '../../shell/navigation';
import { viewHash } from '../../shell/navigation';
import { DockedPane } from '../../DockedPane';
import type { WorldModel } from '../data/types';
import { chairmanTabs, type ChairmanTab } from './chairmanTabs';

// These modules already belong to the app. Keep the hub's initial load small.
const Overview = lazy(() => import('../../Overview').then(m => ({ default: m.Overview })));
const ProjectChat = lazy(() => import('../../ProjectChat').then(m => ({ default: m.ProjectChat })));
const Attention = lazy(() => import('../../Attention').then(m => ({ default: m.Attention })));
const NewGameDialog = lazy(() => import('../../NewGameDialog').then(m => ({ default: m.NewGameDialog })));
const NewTask = lazy(() => import('../../NewTask').then(m => ({ default: m.NewTask })));
const ProjectOverview = lazy(() => import('../../ProjectOverview').then(m => ({ default: m.ProjectOverview })));
const PreviewDialog = lazy(() => import('../../PreviewDialog').then(m => ({ default: m.PreviewDialog })));
const PortalGames = lazy(() => import('../../PortalGames').then(m => ({ default: m.PortalGames })));
const PortalCard = lazy(() => import('../../PortalCard').then(m => ({ default: m.PortalCard })));
const Teams = lazy(() => import('../../Teams').then(m => ({ default: m.Teams })));
const ProjectKnowledge = lazy(() => import('../../ProjectKnowledge').then(m => ({ default: m.ProjectKnowledge })));
const ProjectWorkflow = lazy(() => import('../../ProjectWorkflow').then(m => ({ default: m.ProjectWorkflow })));
const ActivityFeed = lazy(() => import('../../overview/ActivityFeed').then(m => ({ default: m.ActivityFeed })));

/** Gate project-scoped panels until selectProject has finished loading their data.
 * World reads use an independent controller and are unaffected by this scope. */
const scopeJobs = new WeakMap<Store, { id: string; ready: Promise<void> }>();
async function ensureProject(store: Store, projectId: string) {
  const existing = scopeJobs.get(store);
  if (existing?.id === projectId && store.getState().selectedProjectId === projectId) return existing.ready;
  if (store.getState().selectedProjectId === projectId) return;
  const ready = store.selectProject(projectId);
  scopeJobs.set(store, { id: projectId, ready });
  return ready;
}
function ProjectScope({ store, projectId, children }: { store: Store; projectId: string | null; children: ReactNode }) {
  const selected = store.useStoreSelector(s => s.selectedProjectId);
  const [ready, setReady] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const t = useT();
  useEffect(() => {
    let active = true; setReady(null); setFailed(false);
    if (projectId) void (async () => {
      await ensureProject(store, projectId);
      if (active && store.getState().selectedProjectId === projectId) setReady(projectId);
    })().catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [store, projectId, retry]);
  if (!projectId) return <p className="p-4 text-sm">{t('projects.empty')}</p>;
  if (failed) return <div role="alert">{t('worldUi.sourceError')} <Button onClick={() => setRetry(v => v + 1)}>{t('errors.retry')}</Button></div>;
  if (selected !== projectId || ready !== projectId) return <LoadingState inline />;
  return children;
}

export function ChairmanHub({ store, model, attention, tab, onTab, onClose, onNavigate, onFocus, onTask, portalProjectId }: {
  store: Store; model: WorldModel; attention: number; tab: ChairmanTab; onTab: (tab: ChairmanTab) => void;
  onClose: () => void; onNavigate: (view: View) => void; onFocus: (id: string | null) => void;
  onTask: (projectId: string, taskId: string) => void; portalProjectId: string | null;
}) {
  const t = useT(), id = useId();
  const projects = store.useStoreSelector(s => s.projects);
  const [choice, setChoice] = useState(model.focusProjectId ?? '');
  const [teamTab, setTeamTab] = useState<TeamTab>('config');
  const [creating, setCreating] = useState(false), [preview, setPreview] = useState(false);
  const project = projects.find(p => p.id === choice) ?? projects.find(p => p.id === model.focusProjectId) ?? projects[0];
  const projectId = project?.id ?? null;
  const chooseProject = (next: string) => { setChoice(next); onFocus(next); };
  const fullPage = () => {
    const view: View = tab === 'attention' ? 'needs-attention' : tab === 'portal' ? 'portal' : tab === 'team' ? 'team' : tab === 'activity' ? 'overview' : (tab === 'chat' ? portalProjectId : projectId) ? `project:${tab === 'chat' ? portalProjectId : projectId}` : 'overview';
    onNavigate(view);
    const projectTab = tab === 'knowledge' ? 'knowledge' : tab === 'workflow' ? 'workflow' : 'overview';
    // Dispatch a normal route change so the shell and project settings agree.
    location.hash = viewHash(view, projectTab, teamTab);
  };
  const picker = !['assign', 'attention', 'portal', 'activity', 'chat'].includes(tab);
  return <DockedPane label={t('worldUi.ownerDesk')} onClose={onClose} className="world-panel chairman-hub" fallbackFocus={() => document.querySelector<HTMLElement>('.world-map')}>
    <header className="flex items-center justify-between gap-3 border-b border-border p-4"><h2 className="font-display text-lg font-semibold">{t('worldUi.ownerDesk')}</h2><div className="flex gap-2"><Button size="sm" variant="outline" onClick={fullPage}>{t('worldUi.chairman.fullPage')}</Button><Button size="sm" variant="ghost" onClick={onClose}>{t('worldUi.close')}</Button></div></header>
    <div role="tablist" aria-label={t('worldUi.ownerDesk')} className="chairman-tabs" onKeyDown={event => {
      const index = chairmanTabs.indexOf(tab);
      const next = event.key === 'ArrowRight' ? (index + 1) % chairmanTabs.length : event.key === 'ArrowLeft' ? (index + chairmanTabs.length - 1) % chairmanTabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? chairmanTabs.length - 1 : -1;
      if (next < 0) return; event.preventDefault(); onTab(chairmanTabs[next]!);
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
    }}>{chairmanTabs.map(key => <button key={key} role="tab" id={`${id}-${key}`} aria-controls={`${id}-panel`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} onClick={() => onTab(key)}>{t(`worldUi.chairman.tabs.${key}`)}{key === 'attention' ? ` (${attention})` : ''}</button>)}</div>
    {picker && <label className="flex items-center gap-3 border-b border-border px-4 py-2 text-sm">{t('overview.project')}<select aria-label={t('overview.project')} className="min-w-0 flex-1 rounded border border-border bg-background p-2" value={projectId ?? ''} disabled={creating || preview || !projects.length} onChange={event => chooseProject(event.target.value)}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
    <div onClickCapture={event => {
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href="#/attention"],a[href="#/overview"]') : null;
      if (anchor) { event.preventDefault(); event.stopPropagation(); onTab(anchor.hash === '#/attention' ? 'attention' : 'assign'); }
    }} id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} tabIndex={0} className="chairman-content">
      <Suspense fallback={<LoadingState inline />}>
        {tab === 'assign' && <><Overview store={store} composerOnly={{ id: projectId ?? '', onChange: chooseProject }} onProject={chooseProject} onOpenProject={chooseProject} onAttention={() => onTab('attention')} onCreate={kind => kind === 'game' ? setCreating(true) : onTab('create')} onPortal={() => onTab('portal')} onTask={onTask} /><ProjectScope store={store} projectId={projectId}><div className="chairman-chat"><ProjectChat key={projectId} store={store} projectId={projectId!} /></div></ProjectScope></>}
        {tab === 'attention' && <Attention store={store} embedded />}
        {tab === 'create' && <div className="space-y-4 p-4"><Button onClick={() => setCreating(true)}>{t('worldUi.createGame')}</Button><ProjectScope store={store} projectId={projectId}><NewTask key={projectId} store={store} projectId={projectId!} open /></ProjectScope></div>}
        {tab === 'games' && <><div className="flex flex-wrap gap-2 p-4">{model.games.map(game => <Button key={game.projectId} variant={projectId === game.projectId ? 'default' : 'outline'} onClick={() => chooseProject(game.projectId)}>{game.name} · {t(`studioUi.states.${game.workflow?.state ?? 'draft'}`)}</Button>)}<Button disabled={!projectId} onClick={() => setPreview(true)}>{t('worldUi.gallery.play')}</Button></div><ProjectScope store={store} projectId={projectId}><ProjectOverview key={projectId} store={store} onOpenTask={taskId => projectId && onTask(projectId, taskId)} onOpenSettings={section => { if (!projectId) return; onNavigate(`project:${projectId}`); location.hash = viewHash(`project:${projectId}`, 'settings', undefined, section); }} /></ProjectScope></>}
        {tab === 'portal' && <><PortalCard store={store} onChat={() => onTab('chat')} onGames={() => onTab('portal')} /><PortalGames store={store} /></>}
        {tab === 'team' && <ProjectScope store={store} projectId={projectId}><Teams store={store} tab={teamTab} onTabChange={setTeamTab} onTask={onTask} /></ProjectScope>}
        {tab === 'knowledge' && <ProjectScope store={store} projectId={projectId}><ProjectKnowledge key={projectId} store={store} projectId={projectId!} /></ProjectScope>}
        {tab === 'workflow' && <ProjectScope store={store} projectId={projectId}><ProjectWorkflow key={projectId} store={store} projectId={projectId!} onOpenTask={taskId => projectId && onTask(projectId, taskId)} /></ProjectScope>}
        {tab === 'chat' && <ProjectScope store={store} projectId={portalProjectId}><div className="chairman-chat"><ProjectChat key={portalProjectId} store={store} projectId={portalProjectId!} /></div></ProjectScope>}
        {tab === 'activity' && <div className="p-4"><ActivityFeed store={store} onTask={onTask} /></div>}
        {creating && <NewGameDialog store={store} onClose={() => setCreating(false)} onCreated={next => { setCreating(false); chooseProject(next); onTab('games'); }} />}
        {preview && project && <PreviewDialog store={store} projectId={project.id} onClose={() => setPreview(false)} />}
      </Suspense>
    </div>
  </DockedPane>;
}
