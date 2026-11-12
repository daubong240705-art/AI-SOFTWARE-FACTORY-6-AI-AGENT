import { ErrorNotice } from '../components/ErrorNotice';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { i18n, useT } from '../i18n';
import type { Store } from '../state/store';

export function ProjectBudget({ store }: { store: Store }) {
  const t = useT();
  const state = store.useStoreSelector(value => value);
  const day = state.budget?.day;
  const number = new Intl.NumberFormat(i18n.locale);
  const colors = day?.verdict === 'exceeded'
    ? { badge: 'border-need/30 bg-need/10 text-need' }
    : day?.verdict === 'warn'
      ? { badge: 'border-run/30 bg-run/10 text-run' }
      : null;
  return <Card className="gap-0 rounded-xl border-border py-0 shadow-none">
    <CardHeader className="px-5 py-4"><h2 className="font-display text-lg font-semibold">{t('projectUi.budgetTitle')}</h2></CardHeader>
    <CardContent className="space-y-3 px-5 pb-5">
      {day ? <>
        <p className="m-0 flex flex-wrap items-baseline gap-2"><span className="font-display text-3xl font-semibold tabular-nums">{number.format(day.used)}</span><span className="text-sm text-muted-foreground">{t('chatUi.tokens')} · {t('settingsUi.day')}</span></p>
        {colors && <Badge variant="outline" className={cn('font-normal', colors.badge)}>{t(`chatUi.verdict.${day.verdict}`)}</Badge>}
      </> : <p className="m-0 text-sm text-muted-foreground">{t('chatUi.budgetLoading')}</p>}
      {state.errors.budget && <ErrorNotice error={state.errors.budget} />}
    </CardContent>
  </Card>;
}

