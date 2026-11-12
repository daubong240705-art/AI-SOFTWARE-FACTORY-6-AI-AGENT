import { useEffect, useId } from 'react';
import { Page } from '../components/Page';
import { RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { i18n, useT } from '../i18n';
import { M5ReadState } from './M5Shared';
import type { Store } from '../state/store';
import { AutonomySection } from './settings/AutonomySection';
import { ApprovalsSection } from './settings/ApprovalsSection';

function verdict(t: ReturnType<typeof useT>, value: string) { const styles = value === 'exceeded' ? 'border-info/30 bg-info/10 text-info' : value === 'warn' ? 'border-run/30 bg-run/10 text-run' : 'border-ok/30 bg-ok/10 text-ok'; return <Badge variant="outline" className={cn('font-normal', styles)}>{t(`settingsUi.verdict.${value}`)}</Badge>; }
function BudgetSection({ state, store, id }: { state: ReturnType<Store['getState']>; store: Store; id: string }) {
  const t = useT(); const budget = state.budget; const number = new Intl.NumberFormat(i18n.locale);
  const used = (value: number) => `${number.format(value)} ${t('settingsUi.tokens')}`;
  const flag = (value: 'ok' | 'warn' | 'exceeded') => value === 'ok' ? null : verdict(t, value);
  const tasks = [...(budget?.tasks ?? [])].sort((a, b) => b.used - a.used);
  return <Card role="region" aria-labelledby={id} className="gap-0 border-border py-0 shadow-none"><CardHeader className="border-b border-border px-5 py-4"><h3 id={id} className="font-display text-lg font-semibold">{t('settingsUi.budget')}</h3></CardHeader>
    <CardContent className="space-y-5 p-5"><M5ReadState store={store} area="budget" retry={store.loadBudget} empty={!budget} emptyKey="settingsUi.budgetUnavailable" />
      {budget && <><div className="flex flex-wrap items-center justify-between gap-3"><span className="font-medium">{t('settingsUi.day')}</span><span className="flex items-center gap-2 text-sm text-muted-foreground tabular-nums">{used(budget.day.used)}{flag(budget.day.verdict)}</span></div>
        {budget.project && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><span className="font-medium">{t('settingsUi.project')}</span><span className="flex items-center gap-2 text-sm text-muted-foreground tabular-nums">{used(budget.project.used)}{budget.project.limit !== null && flag(budget.project.verdict)}</span></div>}
        {tasks.length > 0 && <div className="overflow-x-auto"><Table><caption className="mb-3 text-left text-sm font-medium">{t('settingsUi.allTasks')}</caption><TableHeader><TableRow><TableHead>{t('settingsUi.task')}</TableHead><TableHead>{t('settingsUi.usedLimit')}</TableHead></TableRow></TableHeader>
          <TableBody>{tasks.map(item => <TableRow key={item.taskId}><TableCell className="font-mono text-xs">{item.code}</TableCell><TableCell className="text-sm tabular-nums"><span className="flex items-center gap-2">{used(item.used)}{flag(item.verdict)}</span></TableCell></TableRow>)}</TableBody></Table></div>}</>}
    </CardContent></Card>;
}
export function ProjectSettings({ store, projectId }: { store: Store; projectId: string }) { const t = useT(); const state = store.useStoreSelector(value => value); const id = useId(); const busy = state.loading.autonomy || state.loading.standingApprovals || state.loading.budget; useEffect(() => store.watchM5('settings', store.loadSettings), [store, projectId]); return <Page className="min-w-0 space-y-6"><header className="flex flex-wrap items-center justify-between gap-4"><h2 className="font-display text-2xl font-semibold">{t('projectUi.settings')}</h2><Button type="button" variant="ghost" disabled={busy} onClick={() => void store.loadSettings()}><RefreshCw />{t('m5Ui.refresh')}</Button></header><BudgetSection state={state} store={store} id={`${id}-budget`} /><AutonomySection key={projectId} projectId={projectId} state={state} store={store} id={`${id}-autonomy`} /><ApprovalsSection key={projectId} projectId={projectId} state={state} store={store} id={`${id}-approvals`} /></Page>; }
