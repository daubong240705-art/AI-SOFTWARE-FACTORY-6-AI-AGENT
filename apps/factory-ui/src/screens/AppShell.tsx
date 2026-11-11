import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import type { Store } from '../state/store';
import { Dialog } from '../components/Dialog';
import { Button } from '../components/Button';
import { ErrorNotice } from '../components/ErrorNotice';
import { ProjectView } from './ProjectView';
import { CreateProject } from './CreateProject';
import { inboxCount } from './Inbox';
import { Attention, attentionHash } from './Attention';
import { Teams } from './Teams';
import { Overview } from './Overview';
import { Icon } from './shell/Icon';
import { ProjectTile } from './shell/ProjectTile';
import { Settings } from './shell/Settings';
import { attentionItems } from './shell/attention';
import { useNavigation, type View } from './shell/navigation';

const compactQuery = '(max-width: 1179px)';
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
  const t = useT(); const state = store.useStoreSelector(value => value);
  const { view, tab, navigate } = useNavigation();
  const [chatProject, setChatProject] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
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
  const items = attentionItems(state.globalInbox);
  const streamLabel = state.stream === 'open' ? 'shell.live' : state.stream === 'closed' ? 'shell.offline' : 'shell.reconnecting';
  function go(next: View) { navigate(next); setExpanded(false); }
  function create() { setExpanded(false); setCreating(true); }
  const navigation = <nav id="factory-navigation" className="sidebar" aria-label={t('nav.main')}>
    <div className="brand"><span className="brand-mark" aria-hidden="true">F</span><span className="nav-label">{t('shell.product')}</span></div>
    <button type="button" className="shell-nav" aria-label={t('nav.overview')} aria-current={view === 'overview' ? 'page' : undefined} onClick={() => go('overview')}><Icon name="overview" /><span className="nav-label">{t('nav.overview')}</span></button>
    <button type="button" className="shell-nav" aria-label={`${t('nav.attention')}, ${inboxCount(t, items.length)}`} aria-current={view === 'needs-attention' ? 'page' : undefined} onClick={() => go('needs-attention')}><Icon name="attention" /><span className="nav-label">{t('nav.attention')}</span>{items.length > 0 && <span className="attention-badge badge">{items.length}</span>}</button>
    <button type="button" className="shell-nav" aria-label={t('nav.team')} aria-current={view === 'team' ? 'page' : undefined} onClick={() => go('team')}><Icon name="team" /><span className="nav-label">{t('nav.team')}</span></button>
    <h2 className="project-group nav-label">{t('global.projects')}</h2>
    <div className="sidebar-projects">
      {state.loading.projects && <p role="status">{t('viewStates.loading')}</p>}
      {state.errors.projects && <><ErrorNotice error={state.errors.projects} /><Button onClick={() => { void store.loadProjects(); }}>{t('errors.retry')}</Button></>}
      <ul className="project-list">{state.projects.map(project => <li key={project.id}>
        <button type="button" className="shell-nav project-link" aria-label={project.name} title={project.name} aria-current={view === `project:${project.id}` ? 'page' : undefined} onClick={() => go(`project:${project.id}`)}>
          <ProjectTile id={project.id} name={project.name} /><span className="nav-label">{project.name}</span>
          {items.some(item => item.projectId === project.id) && <span className="waiting-dot" role="img" aria-label={t('inboxUi.needsDecision')} title={t('inboxUi.needsDecision')} />}
          {state.selectedProjectId === project.id && <span className={`stream-dot stream-${state.stream}`} role="img" aria-label={t(streamLabel)} title={t(streamLabel)} />}
        </button>
      </li>)}</ul>
      <button type="button" className="shell-nav" aria-label={t('projects.create')} onClick={create}><Icon name="plus" /><span className="nav-label">{t('nav.addProject')}</span></button>
    </div>
    <footer className="sidebar-footer">
      <Settings store={store} />
      <button type="button" className="shell-nav" aria-label={t(compact ? 'nav.close' : collapsed ? 'nav.expand' : 'nav.collapse')} aria-expanded={compact ? expanded : !collapsed} onClick={() => compact ? setExpanded(false) : setCollapsed(!collapsed)}><Icon name={compact ? 'close' : collapsed ? 'expand' : 'collapse'} /><span className="nav-label">{t(compact ? 'nav.close' : collapsed ? 'nav.expand' : 'nav.collapse')}</span></button>
    </footer>
  </nav>;
  const pageName = selected?.name ?? t(view === 'needs-attention' ? 'nav.attention' : view === 'team' ? 'nav.team' : 'nav.overview');
  return <div className={`app${collapsed && !compact ? ' sidebar-collapsed' : ''}`}>
    <a className="skip-link" href="#factory-main" onClick={event => { event.preventDefault(); main.current?.focus(); }}>{t('nav.skip')}</a>
    {!compact && navigation}
    <header className="topbar">
      {compact && <button type="button" aria-label={t('shell.toggleProjects')} aria-expanded={expanded} aria-controls="factory-navigation" onClick={() => setExpanded(!expanded)}><Icon name="menu" /></button>}
      {state.selectedProjectId && state.stream !== 'open' && <p role="status" className="stream-notice"><span className={`stream-dot stream-${state.stream}`} aria-hidden="true" />{t(streamLabel)}</p>}
    </header>
    <main ref={main} id="factory-main" className={`content${view === 'needs-attention' ? ' attention-content' : view.startsWith('project:') ? ' project-content' : ''}`} tabIndex={-1} aria-label={pageName} inert={compact && expanded}>
      {view === 'overview' ? <Overview store={store} onProject={id => { setChatProject(id); go(`project:${id}`); }} onCreate={create} onAttention={item => { navigate('needs-attention'); history.replaceState(null, '', attentionHash(item?.key)); }} />
        : view === 'needs-attention' ? <Attention store={store} />
        : view === 'team' ? <Teams store={store} />
        : selected && state.selectedProjectId === selected.id ? <ProjectView key={selected.id} store={store} project={selected} tab={tab} onTabChange={next => navigate(view, next)} openChat={chatProject === selected.id} onChatOpened={() => setChatProject(null)} />
        : <p role="status">{t('viewStates.loading')}</p>}
    </main>
    {compact && expanded && <Dialog labelledBy="navigation-title" onClose={() => setExpanded(false)} className="navigation-overlay"><h2 id="navigation-title" className="sr-only">{t('nav.main')}</h2>{navigation}</Dialog>}
    {creating && <CreateProject store={store} onClose={() => setCreating(false)} onCreated={id => go(`project:${id}`)} />}
    <p role="status" className="sr-only" aria-live="polite">{pageName}</p>
    <p role="status" className="sr-only" key={state.announcement}>{state.announcement > 0 ? t('inboxUi.decided') : ''}</p>
  </div>;
}
