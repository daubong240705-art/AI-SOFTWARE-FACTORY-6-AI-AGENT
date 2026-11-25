import { useCallback, useEffect, useState } from 'react';
import { defaultSettingsSection, settingsSections, type SettingsSection } from '../project-settings/sections';
export type { SettingsSection } from '../project-settings/sections';

export type ProjectTab = 'overview' | 'agents' | 'flows' | 'office' | 'board' | 'knowledge' | 'code' | 'settings';
export type View = 'overview' | 'needs-attention' | 'library' | 'world' | 'system' | `project:${string}`;
const tabs: ProjectTab[] = ['overview', 'agents', 'flows', 'office', 'board', 'knowledge', 'code', 'settings'];
export type FlowRoute = { kind: 'flows' | 'runs'; id: string };
export function flowRoute(hash: string): FlowRoute | null {
  const match = /^#\/project\/[^/]+\/(flows|runs)\/([^/]+)$/.exec(hash);
  if (!match?.[2]) return null;
  try { return { kind: match[1] === 'runs' ? 'runs' : 'flows', id: decodeURIComponent(match[2]) }; }
  catch { return null; }
}
let draftGuard: { hash: string; confirm: () => boolean } | undefined;
export function guardFlowDraft(confirm: () => boolean) {
  const guard = { hash: location.hash, confirm };
  draftGuard = guard;
  return () => { if (draftGuard === guard) draftGuard = undefined; };
}
function allowHash(hash: string): boolean {
  if (!draftGuard || draftGuard.hash === hash) return true;
  if (!draftGuard.confirm()) return false;
  draftGuard = undefined;
  return true;
}
export function openFlowRoute(projectId: string, route?: FlowRoute) {
  const base = viewHash(`project:${projectId}`, 'flows');
  const hash = route ? `${route.kind === 'runs' ? base.replace(/\/flows$/, '/runs') : base}/${encodeURIComponent(route.id)}` : base;
  if (allowHash(hash) && location.hash !== hash) location.hash = hash;
}
export function viewHash(view: View, tab: ProjectTab = 'overview', section?: SettingsSection): string {
  if (!view.startsWith('project:')) return view === 'needs-attention' ? '#/attention' : `#/${view}`;
  const id = encodeURIComponent(view.slice(8));
  if (tab === 'code') return `#/project/${id}/settings/${tab}`;
  if (tab === 'overview') return `#/project/${id}`;
  if (tab === 'settings') return `#/project/${id}/settings${section ? `/${section}` : ''}`;
  return `#/project/${id}/${tab}`;
}
export function parseHash(hash: string): View {
  if (hash === '#/system') return 'system';
  if (hash === '#/library') return 'library';
  if (hash === '#/attention' || hash.startsWith('#/attention/')) return 'needs-attention';
  if (hash === '#/world' || hash.startsWith('#/world?')) return 'world';
  const project = /^#\/project\/([^/]+)(?:\/(?:overview|agents|agent|flows|office|board|workflow|knowledge|code|automation)|\/(?:flows|runs)\/[^/]+|\/settings(?:\/[^/]+)?)?$/.exec(hash);
  if (project?.[1]) { try { const id = decodeURIComponent(project[1]); if (id.trim()) return `project:${id}`; } catch { /* Invalid encodings return home. */ } }
  return 'overview';
}
export function projectTab(hash: string): ProjectTab {
  if (!parseHash(hash).startsWith('project:')) return 'overview';
  const value = /^#\/project\/[^/]+\/([^/]+)(?:\/[^/]+)?$/.exec(hash)?.[1];
  if (value === 'runs') return 'flows';
  // Legacy hash tabs.
  if (value === 'agent') return 'office';
  if (value === 'automation' || value === 'code') return 'settings';
  return tabs.includes(value as ProjectTab) ? value as ProjectTab : 'overview';
}
export function settingsSection(hash: string): SettingsSection {
  const legacy = /^#\/project\/[^/]+\/(code)$/.exec(hash)?.[1];
  if (legacy === 'code') return legacy;
  const value = /^#\/project\/[^/]+\/settings\/([^/]+)$/.exec(hash)?.[1];
  return settingsSections.some(section => section === value) ? value as SettingsSection : defaultSettingsSection;
}
/** Normalize legacy links while preserving attention deep links and the bare settings page. */
export function canonicalHash(hash: string): string {
  const view = parseHash(hash);
  if (view === 'world' && hash.startsWith('#/world?')) return hash;
  if (view === 'needs-attention' && /^#\/attention\/[^/]+$/.test(hash)) return hash;
  const tab = projectTab(hash);
  if (tab === 'flows' && flowRoute(hash)) return hash;
  if (tab === 'settings' && /\/settings\/[^/]+$/.test(hash) && !settingsSections.some(section => hash.endsWith(`/${section}`))) return viewHash(view, tab);
  return viewHash(view, tab, hash.endsWith('/settings') ? undefined : settingsSection(hash));
}

export function useNavigation() {
  const [view, setView] = useState<View>(() => parseHash(location.hash));
  const [tab, setTab] = useState<ProjectTab>(() => projectTab(location.hash));
  const [section, setSection] = useState<SettingsSection>(() => settingsSection(location.hash));
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const sync = () => {
      if (draftGuard && !allowHash(location.hash)) history.replaceState(null, '', draftGuard.hash);
      const next = parseHash(location.hash); const nextTab = projectTab(location.hash); const nextSection = settingsSection(location.hash);
      const canonical = canonicalHash(location.hash);
      if (location.hash !== canonical) history.replaceState(null, '', canonical);
      setView(next); setTab(nextTab); setSection(nextSection);
      setHash(canonical);
    };
    sync(); window.addEventListener('hashchange', sync); window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); };
  }, []);
  const navigate = useCallback((next: View, nextTab: ProjectTab = 'overview', nextSection: SettingsSection = defaultSettingsSection) => {
    const hash = viewHash(next, nextTab, nextSection);
    if (!allowHash(hash)) return;
    if (location.hash !== hash) location.hash = hash;
    setView(next); setTab(projectTab(hash)); setSection(settingsSection(hash));
    setHash(hash);
  }, []);
  return { view, tab, settingsSection: section, navigate, flowRoute: flowRoute(hash) };
}
