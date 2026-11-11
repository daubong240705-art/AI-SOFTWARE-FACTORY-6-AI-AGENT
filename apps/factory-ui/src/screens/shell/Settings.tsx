import { useId, useRef, useState } from 'react';
import { applyTheme, getPreferences, i18n, useT, type Theme } from '../../i18n';
import type { Store } from '../../state/store';
import { Settings as SettingsIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { NavButton } from './NavButton';
import { Select } from '../../components/Select';

export function Settings({ store, collapsed = false }: { store: Store; collapsed?: boolean }) {
  const t = useT(); const id = useId(); const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false); const [theme, setTheme] = useState(getPreferences().theme);
  function close() { setOpen(false); trigger.current?.focus(); }
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><NavButton ref={trigger} collapsed={collapsed} aria-label={t('nav.settings')} aria-expanded={open} aria-controls={id}><SettingsIcon /><span className={collapsed ? 'hidden' : ''}>{t('nav.settings')}</span></NavButton></PopoverTrigger>
    <PopoverContent id={id} side="top" align="start" className="grid w-[228px] gap-4 rounded-lg border-border bg-popover p-4" aria-label={t('nav.preferences')}>
      <div className="field"><label htmlFor={`${id}-theme`}>{t('shell.theme')}</label><Select autoFocus id={`${id}-theme`} value={theme} onValueChange={value => { const next = value as Theme; setTheme(next); applyTheme(next); }} options={['light', 'dark', 'system'].map(value => ({ value, label: t(`shell.${value}`) }))} /></div>
      <div className="field"><label htmlFor={`${id}-language`}>{t('shell.language')}</label><Select id={`${id}-language`} value={i18n.locale} onValueChange={value => i18n.setLocale(value === 'vi' ? 'vi' : 'en')} options={[{ value: 'en', label: t('shell.english') }, { value: 'vi', label: t('shell.vietnamese') }]} /></div>
      <Button variant="outline" onClick={() => { void store.signOut(); }}>{t('auth.signOut')}</Button>
      <Button variant="ghost" onClick={close}>{t('inboxUi.close')}</Button>
    </PopoverContent>
  </Popover>;
}
