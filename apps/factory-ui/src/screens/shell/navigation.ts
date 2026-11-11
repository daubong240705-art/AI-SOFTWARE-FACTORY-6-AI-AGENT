import { useCallback, useEffect, useState } from 'react';

export type ProjectTab = 'overview' | 'board' | 'workflow' | 'automation' | 'knowledge';
export type View = 'overview' | 'needs-attention' | 'team' | `project:${string}`;
export function viewHash(view: View, tab: ProjectTab = 'overview'): string {
  return view.startsWith('project:') ? `#/project/${encodeURIComponent(view.slice(8))}${tab === 'overview' ? '' : `/${tab}`}` : view === 'needs-attention' ? '#/attention' : `#/${view}`;
}
export function projectTab(hash: string): ProjectTab {
  if (!parseHash(hash).startsWith('project:')) return 'overview';
  const tab = /^#\/project\/[^/]+\/(board|workflow|automation|knowledge)$/.exec(hash)?.[1];
  return tab === 'board' || tab === 'workflow' || tab === 'automation' || tab === 'knowledge' ? tab : 'overview';
}
export function parseHash(hash: string): View {
  if (hash === '#/attention' || hash.startsWith('#/attention/')) return 'needs-attention';
  if (hash === '#/team') return 'team';
  const project = /^#\/project\/([^/]+)(?:\/(overview|board|workflow|automation|knowledge))?$/.exec(hash);
  if (project?.[1]) {
    try { const id = decodeURIComponent(project[1]); if (id.trim()) return `project:${id}`; } catch { /* Invalid encodings return home. */ }
  }
  return 'overview';
}
export function useNavigation() {
  const [view, setView] = useState<View>(() => parseHash(location.hash));
  const [tab, setTab] = useState<ProjectTab>(() => projectTab(location.hash));
  useEffect(() => {
    const sync = () => {
      const next = parseHash(location.hash);
      const nextTab = projectTab(location.hash);
      if (location.hash !== viewHash(next, nextTab) && !(next === 'needs-attention' && /^#\/attention\/[^/]+$/.test(location.hash))) history.replaceState(null, '', viewHash(next, nextTab));
      setView(next); setTab(nextTab);
    };
    sync(); window.addEventListener('hashchange', sync); window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); };
  }, []);
  const navigate = useCallback((next: View, nextTab: ProjectTab = 'overview') => {
    if (location.hash !== viewHash(next, nextTab)) location.hash = viewHash(next, nextTab);
    setView(next); setTab(nextTab);
  }, []);
  return { view, tab, navigate };
}
