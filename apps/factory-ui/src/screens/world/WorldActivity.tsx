import { useEffect, useId, useMemo, useState } from 'react';
import { meaningfulOfficeItems, type Office, type Party } from '@/api/officeModels';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useT } from '@/i18n';
import { FeedMessage } from '../office/FeedMessage';
import { activityTime } from '../office/presentation';

/** The Office exchange feed of the focused project, as a collapsible column on the right of the world. */
export function WorldActivity({ office, projectName, loading, error, embedded, onTask }: {
  office: Office | undefined; projectName: string | null; loading: boolean; error?: boolean; embedded?: boolean; onTask: (taskId: string) => void;
}) {
  const t = useT(); const id = useId();
  const [open, setOpen] = useState(() => typeof matchMedia !== 'function' || matchMedia('(min-width: 1280px)').matches);
  const [hideProgress, setHideProgress] = useState(true);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const items = useMemo(() => meaningfulOfficeItems(office?.items ?? []).filter(item => !hideProgress || item.kind !== 'progress'), [office?.items, hideProgress]);
  const party = (value: Party) => value.kind === 'seat' ? value.name : t(value.kind === 'operator' ? 'officeUi.you' : 'officeUi.knowledge');
  return <aside className={embedded ? undefined : `world-activity world-control ${open ? 'world-activity-open' : ''}`} aria-labelledby={`${id}-title`}>
    {embedded ? <h3 id={`${id}-title`} className="px-3 py-2 text-sm font-semibold">{t('officeUi.feed')}{projectName ? ` · ${projectName}` : ''}</h3> : <button className="world-roster-toggle w-full" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen(value => !value)}>
      <span id={`${id}-title`} className="min-w-0 flex-1 truncate text-left font-medium">{t('officeUi.feed')}{projectName ? ` · ${projectName}` : ''}</span>
      <span aria-hidden="true">{open ? '−' : '+'}</span>
    </button>}
    <div id={`${id}-body`} hidden={!open && !embedded} className="world-activity-body">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Checkbox id={`${id}-progress`} checked={hideProgress} onCheckedChange={value => setHideProgress(value === true)} />
        <Label htmlFor={`${id}-progress`} className="text-xs text-muted-foreground">{t('officeUi.hideProgress')}</Label>
      </div>
      {error && <p role="status" className="px-3 py-2 text-sm">{t('worldUi.sourceError')}</p>}
      {loading && !office ? <p role="status" className="p-4 text-center text-sm text-muted-foreground">{t('worldUi.loading')}</p>
        : error && !office ? null
        : !items.length ? <p className="p-4 text-sm text-muted-foreground">{t('officeUi.empty')}</p>
        : <ol className="divide-y divide-border overflow-y-auto">{items.map(item => <li key={item.id} className="space-y-1 p-3 text-xs">
          <div className="flex flex-wrap justify-between gap-1"><strong>{t(`officeUi.kinds.${item.kind}`)}</strong><span>{activityTime(item.at, now)}</span></div>
          <p className="break-words">{party(item.from)}{item.to ? ` → ${party(item.to)}` : ''}</p><FeedMessage text={item.text} />
          {item.taskId && <button type="button" className="underline" onClick={() => onTask(item.taskId!)}>{t('officeUi.openTask').replace('{code}', item.code ?? '')}</button>}
        </li>)}</ol>}
    </div>
  </aside>;
}
