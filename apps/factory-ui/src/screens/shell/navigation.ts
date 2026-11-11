import { useCallback, useEffect, useState } from 'react';

export type View = 'overview' | 'needs-attention' | 'team' | `project:${string}`;
export function viewHash(view: View): string {
  return view.startsWith('project:') ? `#/project/${encodeURIComponent(view.slice(8))}` : view === 'needs-attention' ? '#/attention' : `#/${view}`;
}
export function parseHash(hash: string): View {
  if (hash === '#/attention') return 'needs-attention';
  if (hash === '#/team') return 'team';
  const project = /^#\/project\/([^/]+)$/.exec(hash);
  if (project?.[1]) {
    try { const id = decodeURIComponent(project[1]); if (id.trim()) return `project:${id}`; } catch { /* Invalid encodings return home. */ }
  }
  return 'overview';
}
export function useNavigation() {
  const [view, setView] = useState<View>(() => parseHash(location.hash));
  useEffect(() => {
    const sync = () => {
      const next = parseHash(location.hash);
      if (location.hash !== viewHash(next)) history.replaceState(null, '', viewHash(next));
      setView(next);
    };
    sync(); window.addEventListener('hashchange', sync); window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); };
  }, []);
  const navigate = useCallback((next: View) => {
    if (location.hash !== viewHash(next)) location.hash = viewHash(next);
    setView(next);
  }, []);
  return { view, navigate };
}
