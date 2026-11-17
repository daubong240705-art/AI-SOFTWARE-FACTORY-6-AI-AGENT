import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useT } from '@/i18n';
import type { WorldPreferences } from './preferences';
import { useCameraBridge, useCameraRig } from './cameraContext';
import type { ZoneKey } from './layout/camera';

export function WorldToolbar({ preferences, onChange }: { preferences: WorldPreferences; onChange: (patch: Partial<WorldPreferences>) => void }) {
  const t = useT(); const qualityId = useId(); const camera = useCameraRig(); const { state } = useCameraBridge();
  const [hint, setHint] = useState(true);
  useEffect(() => { const timer = setTimeout(() => setHint(false), 6000); return () => clearTimeout(timer); }, []);
  return <div className="world-toolbar rounded-lg border border-border bg-card/95 p-2 text-card-foreground shadow-sm" role="toolbar" aria-label={t('worldUi.toolbar')} style={{ maxWidth: 'min(560px, calc(100% - 24px))' }}>
    <h1 className="px-1 font-display text-sm font-semibold">{t('worldUi.title')}</h1>
    <Select value={preferences.quality} onValueChange={quality => { if (quality === 'auto' || quality === 'high' || quality === 'low') onChange({ quality }); }}>
      <SelectTrigger id={qualityId} size="sm" aria-label={t('worldUi.quality')}><SelectValue /></SelectTrigger>
      <SelectContent>{(['auto', 'high', 'low'] as const).map(q => <SelectItem key={q} value={q}>{t(`worldUi.qualityOptions.${q}`)}</SelectItem>)}</SelectContent>
    </Select>
    <Button variant="outline" size="sm" aria-pressed={preferences.still} onClick={() => onChange({ still: !preferences.still })}>{t('worldUi.still')}</Button>
    <Button variant="ghost" size="sm" onClick={() => onChange({ mode: '2d' })}>{t('worldUi.view2d')}</Button>
    <div className="flex w-full flex-wrap gap-1">{(['A', 'B', 'C', 'D', 'E', 'F'] as ZoneKey[]).map(key => <Button key={key} variant={state.zone === key ? 'default' : 'outline'} size="sm" className="h-7 px-2 text-xs" aria-pressed={state.zone === key} onClick={() => camera.focusZone(key)}>{key} · {t(`worldUi.zones.${key}`)}</Button>)}<Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={camera.home}>{t('worldUi.home')}</Button></div>
    <p aria-hidden="true" className="w-full px-1 text-xs text-muted-foreground transition-opacity duration-1000" style={{ opacity: hint ? 1 : 0 }}>{t('worldUi.dragHint')}</p>
  </div>;
}
