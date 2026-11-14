import type { ProjectTab } from '../screens/shell/navigation';

export type UiProfile = 'games' | 'full';

// Pure ordered lists, independent of React and browser storage.
export function visibleTabs(profile: UiProfile): ProjectTab[] {
  return profile === 'games' ? ['overview', 'office', 'board', 'workflow', 'knowledge', 'code'] :
    ['overview', 'office', 'board', 'workflow', 'automation', 'knowledge', 'code', 'settings'];
}
