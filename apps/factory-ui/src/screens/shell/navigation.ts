import { useCallback, useEffect, useState } from 'react';
import { useUiProfile, visibleTabs } from '../../config/uiProfile';

export type ProjectTab = 'overview' | 'office' | 'board' | 'workflow' | 'automation' | 'knowledge' | 'code' | 'settings';
export type TeamTab = 'activity' | 'config';
export type View = 'overview' | 'needs-attention' | 'team' | 'system' | 'mascots' | `project:${string}`;
export function viewHash(view: View, tab: ProjectTab = 'overview', team: TeamTab = 'activity'): string {
  if (view === 'team') return team === 'config' ? '#/team/config' : '#/team';
  return view.startsWith('project:') ? `#/project/${encodeURIComponent(view.slice(8))}${tab === 'overview' ? '' : `/${tab}`}` : view === 'needs-attention' ? '#/attention' : `#/${view}`;
}
export function projectTab(hash: string): ProjectTab {
  if (!parseHash(hash).startsWith('project:')) return 'overview';
  const tab = /^#\/project\/[^/]+\/(office|board|workflow|automation|knowledge|code|settings)$/.exec(hash)?.[1];
  return tab === 'office' || tab === 'board' || tab === 'workflow' || tab === 'automation' || tab === 'knowledge' || tab === 'code' || tab === 'settings' ? tab : 'overview';
}
export function parseHash(hash: string): View {
  if (hash === '#/mascots') return 'mascots';
  if (hash === '#/system') return 'system';
  if (hash === '#/attention' || hash.startsWith('#/attention/')) return 'needs-attention';
  if (hash === '#/team' || hash === '#/team/config') return 'team';
  const project = /^#\/project\/([^/]+)(?:\/(overview|office|board|workflow|automation|knowledge|code|settings))?$/.exec(hash);
  if (project?.[1]) {
    try { const id = decodeURIComponent(project[1]); if (id.trim()) return `project:${id}`; } catch { /* Invalid encodings return home. */ }
  }
  return 'overview';
}
export function teamTab(hash: string): TeamTab { return hash === '#/team/config' ? 'config' : 'activity'; }
export function useNavigation() {
  const profile = useUiProfile();
  const [view, setView] = useState<View>(() => parseHash(location.hash));
  const [tab, setTab] = useState<ProjectTab>(() => projectTab(location.hash));
  const [team, setTeam] = useState<TeamTab>(() => teamTab(location.hash));
  useEffect(() => {
    const sync = () => {
      const next = parseHash(location.hash);
      const requestedTab = projectTab(location.hash);
      const nextTab = visibleTabs(profile).includes(requestedTab) ? requestedTab : 'overview';
      const nextTeam = teamTab(location.hash);
      if (location.hash !== viewHash(next, nextTab, nextTeam) && !(next === 'needs-attention' && /^#\/attention\/[^/]+$/.test(location.hash))) history.replaceState(null, '', viewHash(next, nextTab, nextTeam));
      setView(next); setTab(nextTab); setTeam(nextTeam);
    };
    sync(); window.addEventListener('hashchange', sync); window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); };
  }, [profile]);
  const navigate = useCallback((next: View, nextTab: ProjectTab = 'overview', nextTeam: TeamTab = 'activity') => {
    if (!visibleTabs(profile).includes(nextTab)) nextTab = 'overview';
    if (location.hash !== viewHash(next, nextTab, nextTeam)) location.hash = viewHash(next, nextTab, nextTeam);
    setView(next); setTab(nextTab); setTeam(nextTeam);
  }, [profile]);
  return { view, tab: visibleTabs(profile).includes(tab) ? tab : 'overview' as ProjectTab, teamTab: team, navigate };
}
