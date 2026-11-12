import { useSyncExternalStore } from 'react';
import type { MascotSkin } from '@/components/mascot/skins';
import en from '../../../../design/factory-v2/labels.en.json';
import vi from '../../../../design/factory-v2/labels.vi.json';
import { extra as extraEn } from './extra.en';
import { extra as extraVi } from './extra.vi';

export type Locale = 'en' | 'vi';
export function plural(t: (key: string) => string, locale: string, count: number, keyBase: string): string {
  const activeLocale = locale === 'vi' ? 'vi' : 'en';
  const category = new Intl.PluralRules(activeLocale).select(count);
  return t(`${keyBase}.${category === 'one' ? 'one' : 'other'}`);
}
export type Theme = 'light' | 'dark' | 'system';
export const PREFERENCES_KEY = 'factory-ui.preferences.v1';
type Preferences = { locale: Locale; theme: Theme; mascotSkin: MascotSkin };
const defaults: Preferences = { locale: 'vi', theme: 'dark', mascotSkin: 'classic' };
let memory: Preferences = { ...defaults };
let memoryOnly = false;
export function getPreferences(): Preferences {
  if (memoryOnly) return { ...memory };
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? 'null');
    if (typeof parsed === 'object' && parsed !== null && 'locale' in parsed && 'theme' in parsed &&
      (parsed.locale === 'en' || parsed.locale === 'vi') && ['light', 'dark', 'system'].includes(String(parsed.theme))) {
      const candidate = 'mascotSkin' in parsed ? String(parsed.mascotSkin) : 'classic';
      memory = { locale: parsed.locale, theme: parsed.theme as Theme, mascotSkin: ['classic', 'forest', 'ocean', 'fantasy', 'off'].includes(candidate) ? candidate as MascotSkin : 'classic' };
    } else memory = { ...defaults };
  } catch { memoryOnly = true; }
  return { ...memory };
}
function save(patch: Partial<Preferences>) {
  memory = { ...getPreferences(), ...patch };
  try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(memory)); memoryOnly = false; }
  catch { memoryOnly = true; }
}
export function saveMascotSkin(mascotSkin: MascotSkin) { save({ mascotSkin }); }
function flatten(value: unknown, prefix = '', result: Record<string, string> = {}) {
  if (typeof value === 'string') result[prefix] = value;
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, result);
      if (Array.isArray(value) && child && typeof child === 'object' && 'id' in child && typeof child.id === 'string')
        flatten(child, prefix ? `${prefix}.${child.id}` : child.id, result);
    }
  }
  return result;
}
const dictionaries = { en: { ...flatten(en), ...flatten(extraEn) }, vi: { ...flatten(vi), ...flatten(extraVi) } };
const warned = new Set<string>();
export function createI18n(initialLocale: Locale = 'vi') {
  let locale = initialLocale;
  const listeners = new Set<() => void>();
  const t = (key: string) => {
    const label = dictionaries[locale][key];
    if (label !== undefined) return label;
    if (import.meta.env.DEV && !warned.has(key)) { warned.add(key); console.warn('Unknown UI label key.'); }
    return key;
  };
  const i18n = {
    get locale() { return locale; }, t,
    setLocale(next: Locale) { save({ locale: next }); if (next === locale) return; locale = next; listeners.forEach((listener) => listener()); },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    useT() { useSyncExternalStore(i18n.subscribe, () => locale, () => initialLocale); return t; },
  };
  return i18n;
}
export const i18n = createI18n(getPreferences().locale);
export const useT = () => i18n.useT();
let removeThemeListener: (() => void) | undefined;
export function applyTheme(theme: Theme): () => void {
  removeThemeListener?.(); removeThemeListener = undefined;
  save({ theme });
  if (typeof document === 'undefined') return () => {};
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined;
  const apply = () => { document.documentElement.dataset.theme = theme === 'system' ? (media?.matches ? 'dark' : 'light') : theme; };
  apply();
  if (theme !== 'system' || !media) return () => {};
  media.addEventListener('change', apply);
  const cleanup = () => { media.removeEventListener('change', apply); };
  removeThemeListener = cleanup;
  return cleanup;
}
