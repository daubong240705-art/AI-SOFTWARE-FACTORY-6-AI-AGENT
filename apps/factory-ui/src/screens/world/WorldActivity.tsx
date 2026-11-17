import { useEffect, useId, useMemo, useState } from 'react';
import { meaningfulOfficeItems, type Office, type Party } from '@/api/officeModels';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useT } from '@/i18n';
import { Feed } from '../office/ProjectOffice';

/** The Office exchange feed of the focused game, as a collapsible column on the right of the world. */
export function WorldActivity({ office, gameName, loading, onTask }: {
  office: Office | undefined; gameName: string | null; loading: boolean; onTask: (taskId: string) => void;
}) {
  const t = useT(); const id = useId();
  const [open, setOpen] = useState(() => typeof matchMedia !== 'function' || matchMedia('(min-width: 1280px)').matches);
  const [hideProgress, setHideProgress] = useState(true);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const items = useMemo(() => meaningfulOfficeItems(office?.items ?? []), [office?.items]);
  const party = (value: Party) => value.kind === 'seat' ? value.name : t(value.kind === 'operator' ? 'officeUi.you' : 'officeUi.knowledge');
  return <aside className={`world-activity world-control ${open ? 'world-activity-open' : ''}`} aria-labelledby={`${id}-title`}>
    <button className="world-roster-toggle w-full" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen(value => !value)}>
      <span id={`${id}-title`} className="min-w-0 flex-1 truncate text-left font-medium">{t('officeUi.feed')}{gameName ? ` · ${gameName}` : ''}</span>
      <span aria-hidden="true">{open ? '−' : '+'}</span>
    </button>
    <div id={`${id}-body`} hidden={!open} className="world-activity-body">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Checkbox id={`${id}-progress`} checked={hideProgress} onCheckedChange={value => setHideProgress(value === true)} />
        <Label htmlFor={`${id}-progress`} className="text-xs text-muted-foreground">{t('officeUi.hideProgress')}</Label>
      </div>
      {loading && !office ? <p role="status" className="p-4 text-center text-sm text-muted-foreground">{t('worldUi.loading')}</p>
        : <Feed items={items.filter(item => !hideProgress || item.kind !== 'progress')} now={now} party={party} onOpenTask={onTask} />}
    </div>
  </aside>;
}
