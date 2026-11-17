import { Section } from '@/components/app';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { i18n, useT } from '@/i18n';
import type { Store, StoreState } from '@/state/store';
import { M5ReadState } from '../M5Shared';

function verdict(t: ReturnType<typeof useT>, value: string) { const styles = value === 'exceeded' ? 'border-need/30 bg-need/10 text-need' : value === 'warn' ? 'border-run/30 bg-run/10 text-run' : 'border-ok/30 bg-ok/10 text-ok'; return <Badge variant="outline" className={cn('font-normal', styles)}>{t(`settingsUi.verdict.${value}`)}</Badge>; }
export function BudgetSection({ state, store, id }: { state: Pick<StoreState, 'budget'>; store: Store; id: string }) {
  const t = useT(); const budget = state.budget; const number = new Intl.NumberFormat(i18n.locale);
  const used = (value: number) => `${number.format(value)} ${t('settingsUi.tokens')}`;
  const flag = (value: 'ok' | 'warn' | 'exceeded') => value === 'ok' ? null : verdict(t, value);
  const tasks = [...(budget?.tasks ?? [])].sort((a, b) => b.used - a.used);
  return <Section id={id} title={t('shellUi.budget')}>
    <div className="space-y-5"><M5ReadState store={store} area="budget" retry={store.loadBudget} empty={!budget} emptyKey="settingsUi.budgetUnavailable" />
      {budget && <><div className="flex flex-wrap items-center justify-between gap-3"><span className="font-medium">{t('settingsUi.day')}</span><span className="flex items-center gap-2 text-sm text-muted-foreground tabular-nums">{used(budget.day.used)}{flag(budget.day.verdict)}</span></div>
        {budget.project && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><span className="font-medium">{t('settingsUi.project')}</span><span className="flex items-center gap-2 text-sm text-muted-foreground tabular-nums">{used(budget.project.used)}{budget.project.limit !== null && flag(budget.project.verdict)}</span></div>}
        {tasks.length > 0 && <div className="overflow-x-auto"><Table><caption className="mb-3 text-left text-sm font-medium">{t('settingsUi.allTasks')}</caption><TableHeader><TableRow><TableHead>{t('settingsUi.task')}</TableHead><TableHead>{t('settingsUi.usedLimit')}</TableHead></TableRow></TableHeader>
          <TableBody>{tasks.map(item => <TableRow key={item.taskId}><TableCell className="font-mono text-xs">{item.code}</TableCell><TableCell className="text-sm tabular-nums"><span className="flex items-center gap-2">{used(item.used)}{flag(item.verdict)}</span></TableCell></TableRow>)}</TableBody></Table></div>}</>}
    </div></Section>;
}
