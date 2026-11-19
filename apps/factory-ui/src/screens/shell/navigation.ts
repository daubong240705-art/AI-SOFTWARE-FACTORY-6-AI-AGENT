import { useCallback, useEffect, useState } from 'react';
import { defaultSettingsSection, settingsSections, type SettingsSection } from '../project-settings/sections';
export type { SettingsSection } from '../project-settings/sections';

export type ProjectTab = 'overview' | 'agents' | 'office' | 'board' | 'workflow' | 'knowledge' | 'code' | 'settings';
export type TeamTab = 'activity' | 'config';
export type View = 'portal' | 'overview' | 'needs-attention' | 'team' | 'world' | 'system' | 'mascots' | `project:${string}`;
const tabs: ProjectTab[] = ['overview', 'agents', 'office', 'board', 'workflow', 'knowledge', 'code', 'settings'];
export function viewHash(view: View, tab: ProjectTab = 'overview', team: TeamTab = 'activity', section?: SettingsSection): string {
  if (view === 'team') return team === 'config' ? '#/team/config' : '#/team';
  if (!view.startsWith('project:')) return view === 'needs-attention' ? '#/attention' : `#/${view}`;
  const id = encodeURIComponent(view.slice(8));
  if (tab === 'workflow' || tab === 'code') return `#/project/${id}/settings/${tab}`;
  if (tab === 'overview') return `#/project/${id}`;
  if (tab === 'settings') return `#/project/${id}/settings${section ? `/${section}` : ''}`;
  return `#/project/${id}/${tab}`;
}
export function parseHash(hash: string): View {
  if (hash === '#/portal') return 'portal';
  if (hash === '#/mascots') return 'mascots';
  if (hash === '#/system') return 'system';
  if (hash === '#/attention' || hash.startsWith('#/attention/')) return 'needs-attention';
  if (hash === '#/team' || hash === '#/team/config') return 'team';
  if (hash === '#/world' || hash.startsWith('#/world?')) return 'world';
  const project = /^#\/project\/([^/]+)(?:\/(?:overview|agents|agent|office|board|workflow|knowledge|code|automation)|\/settings(?:\/[^/]+)?)?$/.exec(hash);
  if (project?.[1]) { try { const id = decodeURIComponent(project[1]); if (id.trim()) return `project:${id}`; } catch { /* Invalid encodings return home. */ } }
  return 'overview';
}
export function projectTab(hash: string): ProjectTab {
  if (!parseHash(hash).startsWith('project:')) return 'overview';
  const value = /^#\/project\/[^/]+\/([^/]+)(?:\/[^/]+)?$/.exec(hash)?.[1];
  // Legacy hash tabs.
  if (value === 'agent') return 'office';
  if (value === 'automation' || value === 'workflow' || value === 'code') return 'settings';
  return tabs.includes(value as ProjectTab) ? value as ProjectTab : 'overview';
}
export function settingsSection(hash: string): SettingsSection {
  const legacy = /^#\/project\/[^/]+\/(workflow|code)$/.exec(hash)?.[1];
  if (legacy === 'workflow' || legacy === 'code') return legacy;
  const value = /^#\/project\/[^/]+\/settings\/([^/]+)$/.exec(hash)?.[1];
  return settingsSections.some(section => section === value) ? value as SettingsSection : defaultSettingsSection;
}
export function teamTab(hash: string): TeamTab { return hash === '#/team/config' ? 'config' : 'activity'; }
/** Normalize legacy links while preserving attention deep links and the bare settings page. */
export function canonicalHash(hash: string): string {
  const view = parseHash(hash);
  if (view === 'world' && hash.startsWith('#/world?')) return hash;
  if (view === 'needs-attention' && /^#\/attention\/[^/]+$/.test(hash)) return hash;
  const tab = projectTab(hash);
  if (tab === 'settings' && /\/settings\/[^/]+$/.test(hash) && !settingsSections.some(section => hash.endsWith(`/${section}`))) return viewHash(view, tab, teamTab(hash));
  return viewHash(view, tab, teamTab(hash), hash.endsWith('/settings') ? undefined : settingsSection(hash));
}

export function useNavigation() {
  const [view, setView] = useState<View>(() => parseHash(location.hash));
  const [tab, setTab] = useState<ProjectTab>(() => projectTab(location.hash));
  const [team, setTeam] = useState<TeamTab>(() => teamTab(location.hash));
  const [section, setSection] = useState<SettingsSection>(() => settingsSection(location.hash));
  useEffect(() => {
    const sync = () => {
      const next = parseHash(location.hash); const nextTab = projectTab(location.hash); const nextTeam = teamTab(location.hash); const nextSection = settingsSection(location.hash);
      const canonical = canonicalHash(location.hash);
      if (location.hash !== canonical) history.replaceState(null, '', canonical);
      setView(next); setTab(nextTab); setTeam(nextTeam); setSection(nextSection);
    };
    sync(); window.addEventListener('hashchange', sync); window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); };
  }, []);
  const navigate = useCallback((next: View, nextTab: ProjectTab = 'overview', nextTeam: TeamTab = 'activity', nextSection: SettingsSection = defaultSettingsSection) => {
    const hash = viewHash(next, nextTab, nextTeam, nextSection);
    if (location.hash !== hash) location.hash = hash;
    setView(next); setTab(projectTab(hash)); setTeam(nextTeam); setSection(settingsSection(hash));
  }, []);
  return { view, tab, teamTab: team, settingsSection: section, navigate };
}
