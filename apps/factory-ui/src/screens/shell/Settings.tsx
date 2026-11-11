import { useId, useRef, useState } from 'react';
import { applyTheme, getPreferences, i18n, useT, type Theme } from '../../i18n';
import type { Store } from '../../state/store';
import { Icon } from './Icon';

export function Settings({ store }: { store: Store }) {
  const t = useT(); const id = useId(); const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false); const [theme, setTheme] = useState(getPreferences().theme);
  function close() { setOpen(false); trigger.current?.focus(); }
  return <div className="sidebar-settings" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <button ref={trigger} className="shell-nav" type="button" aria-label={t('nav.settings')} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}><Icon name="settings" /><span className="nav-label">{t('nav.settings')}</span></button>
    {open && <section id={id} className="settings-popover stack" aria-label={t('nav.preferences')}>
      <div className="field"><label htmlFor={`${id}-theme`}>{t('shell.theme')}</label><select autoFocus id={`${id}-theme`} value={theme} onChange={event => { const next = event.target.value as Theme; setTheme(next); applyTheme(next); }}>
        <option value="light">{t('shell.light')}</option><option value="dark">{t('shell.dark')}</option><option value="system">{t('shell.system')}</option>
      </select></div>
      <div className="field"><label htmlFor={`${id}-language`}>{t('shell.language')}</label><select id={`${id}-language`} value={i18n.locale} onChange={event => i18n.setLocale(event.target.value === 'vi' ? 'vi' : 'en')}>
        <option value="en">{t('shell.english')}</option><option value="vi">{t('shell.vietnamese')}</option>
      </select></div>
      <button type="button" onClick={() => { void store.signOut(); }}>{t('auth.signOut')}</button>
      <button type="button" onClick={close}>{t('inboxUi.close')}</button>
    </section>}
  </div>;
}
