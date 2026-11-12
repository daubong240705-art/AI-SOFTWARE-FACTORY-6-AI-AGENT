import { useSyncExternalStore } from 'react';
import { getPreferences, saveMascotSkin, PREFERENCES_KEY } from '@/i18n';
import type { MascotSkin } from './skins';
let skin = getPreferences().mascotSkin;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function setMascotSkin(next: MascotSkin) { saveMascotSkin(next); skin = next; listeners.forEach(listener => listener()); }
export function useMascotSkin() { return useSyncExternalStore(subscribe, () => skin, () => 'original' as MascotSkin); }
if (typeof window !== 'undefined') window.addEventListener('storage', event => { if (event.key === PREFERENCES_KEY) { skin = getPreferences().mascotSkin; listeners.forEach(listener => listener()); } });
