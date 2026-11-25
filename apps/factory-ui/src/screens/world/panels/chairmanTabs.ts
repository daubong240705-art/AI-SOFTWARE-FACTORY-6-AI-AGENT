export const chairmanTabs = ['assign', 'attention', 'create', 'projects', 'agents', 'knowledge', 'flows', 'chat', 'activity'] as const;
export type ChairmanTab = typeof chairmanTabs[number];
export function chairmanTabFromHash(): ChairmanTab | null {
  if (!location.hash.startsWith('#/world?')) return null;
  const value = new URLSearchParams(location.hash.split('?')[1]).get('hub');
  return chairmanTabs.find(tab => tab === value) ?? null;
}
