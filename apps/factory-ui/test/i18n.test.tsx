import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { applyTheme, plural, createI18n, getPreferences, PREFERENCES_KEY } from '../src/i18n';
import en from '../../../design/factory-v2/labels.en.json';
import viLabels from '../../../design/factory-v2/labels.vi.json';
import { extra as extraEn } from '../src/i18n/extra.en';
import { extra as extraVi } from '../src/i18n/extra.vi';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); applyTheme('light'); });
function keys(value: unknown, prefix = ''): string[] {
  return value && typeof value === 'object' ? Object.entries(value).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key)).sort() : [prefix];
}
it('defaults to Vietnamese chrome labels', () => { expect(createI18n().locale).toBe('vi'); expect(createI18n().t('global.projects')).toBe(viLabels.global.projects); });
it('switches to Vietnamese and persists locale', () => {
  const i18n = createI18n('en'); i18n.setLocale('vi'); expect(i18n.t('global.projects')).toBe(viLabels.global.projects); expect(getPreferences().locale).toBe('vi');
});
it('unknown keys fall back to themselves and warn once in development', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); const i18n = createI18n('en');
  expect(i18n.t('missing.unique.label')).toBe('missing.unique.label'); i18n.t('missing.unique.label'); expect(warn).toHaveBeenCalledOnce();
});
it('design English and Vietnamese key sets match, including array entries', () => { expect(keys(en)).toEqual(keys(viLabels)); });
it('extra English and Vietnamese key sets match', () => { expect(keys(extraEn)).toEqual(keys(extraVi)); });
it('extra labels are available under dotted keys', () => { expect(createI18n('en').t('auth.signIn')).toBe('Sign in'); expect(createI18n('vi').t('tasks.proposed')).toBe(extraVi.tasks.proposed); });
it('array design labels are accessible by stable ID and numeric index', () => { expect(createI18n('en').t('projectTabs.board.label')).toBe('Board'); expect(createI18n('en').t('projectTabs.1.label')).toBe('Board'); });
it('blocked localStorage falls back to memory without throwing', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  const i18n = createI18n('en'); expect(() => { i18n.setLocale('vi'); applyTheme('dark'); }).not.toThrow(); expect(getPreferences()).toEqual({ locale: 'vi', theme: 'dark' });
});
it('blocked access to localStorage itself never throws', () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('blocked'); });
  expect(() => { createI18n('en').setLocale('vi'); applyTheme('dark'); getPreferences(); }).not.toThrow();
});
it('failed writes do not let old persisted preferences replace the memory fallback', () => {
  applyTheme('light');
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ locale: 'en', theme: 'light' }));
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  const i18n = createI18n('en'); i18n.setLocale('vi'); applyTheme('dark');
  expect(getPreferences()).toEqual({ locale: 'vi', theme: 'dark' });
});
it.each(['broken', '{}', '{"locale":"xx","theme":"dark"}'])('invalid stored preferences %s never throw', (value) => {
  localStorage.setItem(PREFERENCES_KEY, value); expect(() => getPreferences()).not.toThrow(); expect(['en', 'vi']).toContain(getPreferences().locale);
});
it.each(['light', 'dark'] as const)('explicit %s theme updates html and storage', (theme) => {
  applyTheme(theme); expect(document.documentElement.dataset.theme).toBe(theme); expect(getPreferences().theme).toBe(theme);
});
it('system theme follows media changes and unregisters on explicit changes', () => {
  const media = new EventTarget(); const query = Object.assign(media, { matches: false }); const remove = vi.spyOn(query, 'removeEventListener');
  vi.stubGlobal('matchMedia', vi.fn(() => query)); applyTheme('system'); expect(document.documentElement.dataset.theme).toBe('light');
  query.matches = true; query.dispatchEvent(new Event('change')); expect(document.documentElement.dataset.theme).toBe('dark');
  applyTheme('light'); query.dispatchEvent(new Event('change')); expect(document.documentElement.dataset.theme).toBe('light'); expect(remove).toHaveBeenCalled();
});
it('missing matchMedia uses a light system fallback', () => { vi.stubGlobal('matchMedia', undefined); expect(() => applyTheme('system')).not.toThrow(); expect(document.documentElement.dataset.theme).toBe('light'); });
it('useT reacts when locale switches', () => {
  const i18n = createI18n('en'); const hook = renderHook(() => { const t = i18n.useT(); return t('global.projects'); });
  expect(hook.result.current).toBe('Projects'); act(() => i18n.setLocale('vi')); expect(hook.result.current).toBe(viLabels.global.projects);
});
it('user content is never passed through the translation function', () => { const content = 'My task: hello / Xin chào'; expect(createI18n('vi').t(content)).toBe(content); });

it.each([
  ['en', 0, 'other'], ['en', 1, 'one'], ['en', 2, 'other'],
  ['vi', 0, 'other'], ['vi', 1, 'other'], ['vi', 2, 'other'],
  ['unknown', 0, 'other'], ['unknown', 1, 'one'], ['unknown', 2, 'other'],
] as const)('selects %s plural category for %s', (locale, count, category) => {
  const t = vi.fn((key: string) => key);
  expect(plural(t, locale, count, 'taskUi.awaiting')).toBe('taskUi.awaiting.' + category);
  expect(t).toHaveBeenCalledExactlyOnceWith('taskUi.awaiting.' + category);
});
it.each([0, 1, 2])('uses Vietnamese plural labels for %s', (count) => {
  expect(plural(createI18n('vi').t, 'vi', count, 'taskUi.awaiting')).toBe(extraVi.taskUi.awaiting.other);
});
