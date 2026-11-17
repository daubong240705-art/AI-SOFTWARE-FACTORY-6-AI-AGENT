import { useSyncExternalStore } from 'react';

export type WorldPreferences = Readonly<{
  mode: 'auto' | '3d' | '2d'; quality: 'auto' | 'high' | 'low'; still: boolean; lineup: boolean;
}>;
export const WORLD_PREFERENCES_KEY = 'factory-ui.world.v1';
const defaults: WorldPreferences = Object.freeze({ mode: 'auto', quality: 'auto', still: false, lineup: false });
let current = defaults;
let memoryOnly = false;
const listeners = new Set<() => void>();
function read(): WorldPreferences {
  if (memoryOnly || typeof localStorage === 'undefined') return current;
  let next = defaults;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(WORLD_PREFERENCES_KEY) ?? 'null');
    if (value && typeof value === 'object' && 'mode' in value && 'quality' in value && 'still' in value && 'lineup' in value &&
      (value.mode === 'auto' || value.mode === '3d' || value.mode === '2d') &&
      (value.quality === 'auto' || value.quality === 'high' || value.quality === 'low') &&
      typeof value.still === 'boolean' && typeof value.lineup === 'boolean') {
      next = { mode: value.mode, quality: value.quality, still: value.still, lineup: value.lineup };
    }
  } catch { /* Invalid JSON or unavailable storage uses defaults. */ }
  if (next.mode !== current.mode || next.quality !== current.quality || next.still !== current.still || next.lineup !== current.lineup) current = Object.freeze(next);
  return current;
}
function emit() { listeners.forEach(listener => listener()); }
function storageChanged(event: StorageEvent) {
  if (event.key !== null && event.key !== WORLD_PREFERENCES_KEY) return;
  memoryOnly = false; read(); emit();
}
function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener('storage', storageChanged);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', storageChanged);
  };
}
export function setWorldPreferences(patch: Partial<WorldPreferences>) {
  current = Object.freeze({ ...read(), ...patch });
  try { localStorage.setItem(WORLD_PREFERENCES_KEY, JSON.stringify(current)); memoryOnly = false; }
  catch { memoryOnly = true; }
  emit();
}
export function useWorldPreferences() {
  const preferences = useSyncExternalStore(subscribe, read, () => defaults);
  return [preferences, setWorldPreferences] as const;
}
