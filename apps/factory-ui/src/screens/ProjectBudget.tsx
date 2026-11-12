import { ErrorNotice } from '../components/ErrorNotice';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { i18n, useT } from '../i18n';
import type { Store } from '../state/store';

export function ProjectBudget({ store }: { store: Store }) {
  const t = useT();
  const state = store.useStoreSelector(value => value);
  const day = state.budget?.day;
  const number = new Intl.NumberFormat(i18n.locale);
  const percentage = day && day.limit > 0 ? Math.min(100, day.used / day.limit * 100) : 0;
  const colors = day?.verdict === 'exceeded'
    ? { progress: '[&_[data-slot=progress-indicator]]:bg-need', badge: 'border-need/30 bg-need/10 text-need' }
    : day?.verdict === 'warn'
      ? { progress: '[&_[data-slot=progress-indicator]]:bg-run', badge: 'border-run/30 bg-run/10 text-run' }
      : { progress: '[&_[data-slot=progress-indicator]]:bg-ok', badge: 'border-ok/30 bg-ok/10 text-ok' };
  return <Card className="gap-0 rounded-xl border-border py-0 shadow-none">
    <CardHeader className="px-5 py-4"><h2 className="font-display text-lg font-semibold">{t('projectUi.budgetTitle')}</h2></CardHeader>
    <CardContent className="space-y-3 px-5 pb-5">
      {day ? <>
        <Progress value={percentage} aria-label={t('chatUi.budget')} aria-valuemin={0} aria-valuemax={day.limit} aria-valuenow={Math.min(day.used, day.limit)} aria-valuetext={`${number.format(day.used)} / ${number.format(day.limit)} ${t('chatUi.tokens')}`} className={cn('h-2 rounded-full bg-muted', colors.progress)} />
        <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-muted-foreground tabular-nums">{number.format(day.used)} / {number.format(day.limit)} {t('chatUi.tokens')}</span><Badge variant="outline" className={cn('font-normal', colors.badge)}>{t(`chatUi.verdict.${day.verdict}`)}</Badge></div>
      </> : <p className="m-0 text-sm text-muted-foreground">{t('chatUi.budgetLoading')}</p>}
      {state.errors.budget && <ErrorNotice error={state.errors.budget} />}
    </CardContent>
  </Card>;
}

