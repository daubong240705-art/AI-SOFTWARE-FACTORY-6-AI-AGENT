import { useId, useRef, useState } from 'react';
import { applyTheme, getPreferences, i18n, useT, type Theme } from '../../i18n';
import type { Store } from '../../state/store';
import { Icon } from './Icon';
import { Select } from '../../components/Select';

export function Settings({ store }: { store: Store }) {
  const t = useT(); const id = useId(); const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false); const [theme, setTheme] = useState(getPreferences().theme);
  function close() { setOpen(false); trigger.current?.focus(); }
  return <div className="sidebar-settings" onBlur={event => {
    const target = event.relatedTarget;
    const inSelect = Array.from(event.currentTarget.querySelectorAll('[role="combobox"][aria-controls]')).some(control => document.getElementById(control.getAttribute('aria-controls') ?? '')?.contains(target));
    if (!event.currentTarget.contains(target) && !inSelect) setOpen(false);
  }} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <button ref={trigger} className="shell-nav" type="button" aria-label={t('nav.settings')} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}><Icon name="settings" /><span className="nav-label">{t('nav.settings')}</span></button>
    {open && <section id={id} className="settings-popover stack" aria-label={t('nav.preferences')}>
      <div className="field"><label htmlFor={`${id}-theme`}>{t('shell.theme')}</label><Select autoFocus id={`${id}-theme`} value={theme} onValueChange={value => { const next = value as Theme; setTheme(next); applyTheme(next); }} options={['light', 'dark', 'system'].map(value => ({ value, label: t(`shell.${value}`) }))} /></div>
      <div className="field"><label htmlFor={`${id}-language`}>{t('shell.language')}</label><Select id={`${id}-language`} value={i18n.locale} onValueChange={value => i18n.setLocale(value === 'vi' ? 'vi' : 'en')} options={[{ value: 'en', label: t('shell.english') }, { value: 'vi', label: t('shell.vietnamese') }]} /></div>
      <button type="button" onClick={() => { void store.signOut(); }}>{t('auth.signOut')}</button>
      <button type="button" onClick={close}>{t('inboxUi.close')}</button>
    </section>}
  </div>;
}
