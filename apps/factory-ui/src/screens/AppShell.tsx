import { useEffect, useId, useRef, useState } from 'react';
import { applyTheme, getPreferences, i18n, useT, type Theme } from '../i18n';
import type { Store } from '../state/store';
import { Button } from '../components/Button';
import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { ErrorNotice } from '../components/ErrorNotice';
import { ProjectView } from './ProjectView';
import { CreateProject } from './CreateProject';

// Design compact breakpoint: tokens.json (CSS variables cannot be used in media queries).
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
  const t = useT();
  const state = store.useStoreSelector((value) => value);
  const [theme, setTheme] = useState(getPreferences().theme);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const compact = useCompact();
  const navId = useId();
  const themeId = useId();
  const languageId = useId();
  const loaded = useRef<Store | null>(null);
  useEffect(() => { if (loaded.current !== store) { loaded.current = store; void store.loadProjects(); } }, [store]);
  useEffect(() => {
    const project = state.projects[0];
    if (!state.selectedProjectId && state.projects.length === 1 && project) void store.selectProject(project.id);
  }, [store, state.projects, state.selectedProjectId]);
  const selected = state.projects.find((project) => project.id === state.selectedProjectId);
  const streamLabel = state.stream === 'open' ? 'shell.live' : state.stream === 'closed' ? 'shell.offline' : 'shell.reconnecting';
  return <div className="app">
    <header className="topbar" role="banner">
      <strong className="brand">{t('shell.product')}</strong>
      <div className="preferences">
        <label htmlFor={themeId}>{t('shell.theme')}</label>
        <select id={themeId} value={theme} onChange={(event) => { const next = event.target.value as Theme; setTheme(next); applyTheme(next); }}>
          <option value="light">{t('shell.light')}</option><option value="dark">{t('shell.dark')}</option><option value="system">{t('shell.system')}</option>
        </select>
        <label htmlFor={languageId}>{t('shell.language')}</label>
        <select id={languageId} value={i18n.locale} onChange={(event) => i18n.setLocale(event.target.value === 'vi' ? 'vi' : 'en')}>
          <option value="en">{t('shell.english')}</option><option value="vi">{t('shell.vietnamese')}</option>
        </select>
        <Button onClick={() => { void store.signOut(); }}>{t('auth.signOut')}</Button>
      </div>
      {compact && <Button aria-expanded={expanded} aria-controls={navId} onClick={() => setExpanded(!expanded)}>{t('shell.toggleProjects')}</Button>}
    </header>
    <nav id={navId} className="sidebar stack" aria-label={t('global.projects')} hidden={compact && !expanded}>
      <h2>{t('global.projects')}</h2>
      {state.loading.projects && <p role="status">{t('viewStates.loading')}</p>}
      {state.errors.projects && <><ErrorNotice error={state.errors.projects} /><Button onClick={() => { void store.loadProjects(); }}>{t('errors.retry')}</Button></>}
      {!state.loading.projects && !state.errors.projects && state.projects.length === 0 && <p className="muted">{t('projects.empty')}</p>}
      <ul className="project-list stack">{state.projects.map((project) => <li key={project.id}>
        <Button className="project-link" aria-current={state.selectedProjectId === project.id ? 'page' : undefined} onClick={() => { void store.selectProject(project.id); setExpanded(false); }}>
          <span>{project.name}</span>{state.selectedProjectId === project.id && <Badge>{t(streamLabel)}</Badge>}
        </Button>
      </li>)}</ul>
      <Button variant="accent" onClick={() => setCreating(true)}>{t('projects.create')}</Button>
    </nav>
    <main className="content">{selected ? <ProjectView key={selected.id} store={store} project={selected} /> : <Card className="state-empty">
      <h1>{t('shell.welcome')}</h1><p className="muted">{t('shell.chooseProject')}</p>
      <Button variant="primary" onClick={() => setCreating(true)}>{t('projects.create')}</Button>
    </Card>}</main>
    {creating && <CreateProject store={store} onClose={() => setCreating(false)} />}
  </div>;
}
