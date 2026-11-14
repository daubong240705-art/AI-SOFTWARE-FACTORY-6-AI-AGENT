import { useSyncExternalStore } from 'react';
import type { UiProfile } from './uiProfileTabs';

export { visibleTabs, type UiProfile } from './uiProfileTabs';

const storageKey = 'factory.ui.profile';
const changeEvent = 'factory.ui.profile.change';
const defaultProfile: UiProfile = 'games';


function getSnapshot(): UiProfile {
  try { return localStorage.getItem(storageKey) === 'full' ? 'full' : defaultProfile; } catch { return defaultProfile; }
}
function subscribe(listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) listener(); };
  window.addEventListener('storage', storage); window.addEventListener(changeEvent, listener);
  return () => { window.removeEventListener('storage', storage); window.removeEventListener(changeEvent, listener); };
}
export function setUiProfile(next: UiProfile) {
  try { localStorage.setItem(storageKey, next); } catch { /* Fall back to the default when storage is unavailable. */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(changeEvent));
}
export function useUiProfile(): UiProfile { return useSyncExternalStore(subscribe, getSnapshot, () => defaultProfile); }
