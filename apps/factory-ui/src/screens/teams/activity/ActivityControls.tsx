import { useId } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { activityTime } from './presentation';

export function ActivityControls({ store, now, onlyMine, onFilter }: {
  store: Store; now: number; onlyMine: boolean; onFilter: (value: boolean) => void;
}) {
  const t = useT(); const id = useId();
  const { activity, loading } = store.useStoreSelector(state => state);
  return <div className="flex flex-wrap items-center gap-3 text-sm">
    {activity && <span className="text-xs text-muted-foreground">{t('activityUi.updated')} <time dateTime={activity.generatedAt}>{activityTime(activity.generatedAt, now)}</time></span>}
    <Button variant="ghost" size="sm" onClick={() => { void store.loadActivity(); }} disabled={loading.activity} aria-label={t('activityUi.refresh')}>
      <RefreshCw aria-hidden="true" className="size-4" />{t('activityUi.refresh')}
    </Button>
    <div className="flex items-center gap-2">
      <Switch id={id} checked={onlyMine} onCheckedChange={onFilter} />
      <Label htmlFor={id} className="text-sm font-normal text-muted-foreground">{t('activityUi.onlyMine')}</Label>
    </div>
  </div>;
}
