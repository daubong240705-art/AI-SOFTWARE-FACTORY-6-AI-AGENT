import { ToyTray } from './scene/toys/ToyTray';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import type { WorldPreferences } from './preferences';
import { useCameraBridge, useCameraRig } from './cameraContext';
import type { ZoneKey } from './layout/camera';

export function WorldToolbar({ preferences, onChange, selected, quiet, canWalk, walking, onWalk, showActivity, onActivity }: { canWalk: boolean; walking: boolean; onWalk: () => void; showActivity: boolean; onActivity: () => void; selected: string | null; quiet: boolean; preferences: WorldPreferences; onChange: (patch: Partial<WorldPreferences>) => void }) {
  const t = useT(), camera = useCameraRig(), { state } = useCameraBridge();
  const [more, setMore] = useState(false);
  return <div className="world-toolbar world-control" role="toolbar" aria-label={t('worldUi.toolbar')}>
    <h1 className="px-1 font-display text-sm font-semibold whitespace-nowrap">{t('worldUi.title')}</h1>
    <Button disabled={walking} variant="ghost" size="sm" onClick={camera.home}>{t('worldUi.home')}</Button>
    {canWalk && <Button variant={walking ? 'default' : 'outline'} size="sm" aria-pressed={walking} title="V" onClick={onWalk}>{t('worldUi.walk.title')}</Button>}
    <ToyTray walking={walking} selected={walking ? null : selected} quiet={quiet} />
    <Button variant="outline" size="sm" aria-expanded={more} aria-label={t('worldUi.more')} onClick={() => setMore(value => !value)}>⋯</Button>
    {more && <div className="world-toolbar-more" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setMore(false); event.currentTarget.parentElement?.querySelector<HTMLButtonElement>('[aria-expanded]')?.focus(); } }}>
      {walking && <Button variant="outline" size="sm" aria-pressed={showActivity} onClick={onActivity}>{t('worldUi.walk.activity')}</Button>}
      <label className="flex items-center gap-2 text-sm">{t('worldUi.quality')}<select className="rounded border border-border bg-card p-1" value={preferences.quality} onChange={event => { const quality = event.target.value; if (quality === 'auto' || quality === 'high' || quality === 'low') onChange({ quality }); }}>
        {(['auto', 'high', 'low'] as const).map(q => <option key={q} value={q}>{t(`worldUi.qualityOptions.${q}`)}</option>)}
      </select></label>
      <label className="flex items-center gap-2 text-sm">{t('worldUi.effects')}<select className="rounded border border-border bg-card p-1" value={preferences.effects} onChange={event => { const effects = event.target.value; if (effects === 'full' || effects === 'lite' || effects === 'off') onChange({ effects }); }}>
        {(['full', 'lite', 'off'] as const).map(e => <option key={e} value={e}>{t(`worldUi.effectsOptions.${e}`)}</option>)}
      </select></label>
      <Button variant="outline" size="sm" aria-pressed={preferences.still} onClick={() => onChange({ still: !preferences.still })}>{t('worldUi.still')}</Button>
      <Button variant="outline" size="sm" aria-pressed={preferences.lineup} onClick={() => onChange({ lineup: !preferences.lineup })}>{t(preferences.lineup ? 'worldUi.backStudio' : 'worldUi.lineup')}</Button>
      <Button variant="ghost" size="sm" onClick={() => onChange({ mode: '2d' })}>{t('worldUi.view2d')}</Button>
      {(['A', 'B', 'C', 'D', 'E', 'F'] as ZoneKey[]).map(key => <Button key={key} variant={state.zone === key ? 'default' : 'outline'} size="sm" aria-pressed={state.zone === key} onClick={() => { camera.focusZone(key); setMore(false); }}>{key} · {t(`worldUi.zones.${key}`)}</Button>)}
      <p className="text-xs text-muted-foreground">{t('worldUi.dragHint')}</p>
    </div>}
  </div>;
}
