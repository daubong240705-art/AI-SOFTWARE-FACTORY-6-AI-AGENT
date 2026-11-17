import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import type { WorldPreferences } from './preferences';

export function WorldToolbar({ preferences, onChange }: { preferences: WorldPreferences; onChange: (patch: Partial<WorldPreferences>) => void }) {
  const t = useT(); const qualityId = useId();
  return <div className="world-toolbar rounded-lg border border-border bg-card/95 p-2 text-card-foreground shadow-sm" role="toolbar" aria-label={t('worldUi.toolbar')}>
    <h1 className="px-1 font-display text-sm font-semibold">{t('worldUi.title')}</h1>
    <label htmlFor={qualityId} className="sr-only">{t('worldUi.quality')}</label>
    <select id={qualityId} className="rounded-md border border-input bg-background px-2 py-1 text-xs" value={preferences.quality} onChange={event => {
      const quality = event.target.value;
      if (quality === 'auto' || quality === 'high' || quality === 'low') onChange({ quality });
    }}>
      <option value="auto">{t('worldUi.qualityOptions.auto')}</option>
      <option value="high">{t('worldUi.qualityOptions.high')}</option>
      <option value="low">{t('worldUi.qualityOptions.low')}</option>
    </select>
    <Button variant="outline" size="sm" aria-pressed={preferences.still} onClick={() => onChange({ still: !preferences.still })}>{t('worldUi.still')}</Button>
    <Button variant="ghost" size="sm" onClick={() => onChange({ mode: '2d' })}>{t('worldUi.view2d')}</Button>
  </div>;
}
