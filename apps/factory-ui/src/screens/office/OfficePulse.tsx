import { Activity, CheckCircle2, Coffee, ListChecks, Radio, Sparkles, Sprout, Users } from 'lucide-react';
import type { Office } from '@/api/officeModels';
import type { Store } from '@/state/store';
import { i18n, useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { activityTime } from '../teams/activity/presentation';

export function OfficePulse({ store, office, now, lively, onLivelyChange }: { store: Store; office: Office; now: number; lively: boolean; onLivelyChange: (value: boolean) => void }) {
  const t = useT(); const tasks = store.useStoreSelector(state => state.tasks);
  const working = office.seats.filter(seat => seat.status === 'working' || seat.chat).length;
  const pending = new Set(office.seats.flatMap(seat => seat.needsYou.map(need => need.approvalId))).size;
  const done = tasks.filter(task => task.state === 'done').length;
  const stats = [
    { label: t('officeUi.teamCount'), value: office.seats.length, icon: Users, tone: 'text-info' },
    { label: t('officeUi.activeCount'), value: working, icon: Activity, tone: 'text-run' },
    { label: t('officeUi.reviewCount'), value: pending, icon: ListChecks, tone: 'text-need' },
    { label: t('officeUi.doneCount'), value: `${done}/${tasks.length}`, icon: CheckCircle2, tone: 'text-ok' },
  ];
  return <section aria-label={t('officeUi.pulse')} className="office-pulse overflow-hidden rounded-2xl border border-border bg-card">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
      <div className="flex items-center gap-3"><span className="office-pulse-icon rounded-xl bg-run/10 p-2.5 text-run"><Radio className="size-5" aria-hidden="true" /></span><div><h3 className="font-display text-base font-semibold">{t('officeUi.pulse')}</h3><p className="text-xs text-muted-foreground">{t(working ? 'officeUi.busyMood' : pending ? 'officeUi.waitingMood' : 'officeUi.calmMood')}</p></div></div>
      <div className="flex flex-wrap items-center gap-3"><span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-1.5 rounded-full bg-ok" />{t('officeUi.updated')} {activityTime(office.generatedAt, now)}</span><button type="button" aria-pressed={lively} onClick={() => onLivelyChange(!lively)} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"><Sparkles className={cn('size-3.5', lively && 'text-run')} />{t(lively ? 'officeUi.lively' : 'officeUi.calm')}</button></div>
    </div>
    <dl className="grid grid-cols-2 divide-x divide-border lg:grid-cols-4">{stats.map(({ label, value, icon: Icon, tone }) => <div key={label} className="flex min-w-0 items-center gap-3 px-5 py-4"><Icon className={cn('size-5 shrink-0', tone)} aria-hidden="true" /><div className="min-w-0"><dd className="m-0 font-mono text-xl font-semibold tabular-nums">{value}</dd><dt className="text-xs text-muted-foreground">{label}</dt></div></div>)}</dl>
  </section>;
}

export function OfficeRoomTrim({ now }: { now: number }) {
  const t = useT();
  return <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3 text-[11px] text-muted-foreground">
    <span className="inline-flex items-center gap-2"><Sprout className="office-plant size-5 text-ok" aria-hidden="true" /><span className="font-mono uppercase tracking-widest">{t('officeUi.teamRoom')}</span></span>
    <span className="inline-flex items-center gap-1.5 font-mono tabular-nums"><span className="office-clock-dot size-1 rounded-full bg-run" />{new Intl.DateTimeFormat(i18n.locale, { hour: '2-digit', minute: '2-digit' }).format(now)}</span>
  </div>;
}

export function CoffeeCorner() {
  const t = useT();
  return <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-border pt-4 text-[11px] text-muted-foreground"><span className="inline-flex items-center gap-2"><Coffee className="office-coffee size-4" aria-hidden="true" />{t('officeUi.coffeeCorner')}<Sprout className="size-4 text-ok" aria-hidden="true" /></span><span className="inline-flex items-center gap-1.5"><Sparkles className="size-3.5 text-run" aria-hidden="true" />{t('officeUi.smallSteps')}</span></div>;
}
