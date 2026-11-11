import { Stagger, StaggerItem } from '@/components/motion/Stagger';
import { useEffect, useId, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useT } from '../i18n';
import { relativeTime } from './Inbox';
import { M5ReadState, M5Status, TechnicalDetails } from './M5Shared';
import type { Store } from '../state/store';
import { Page } from '../components/Page';

const triggers: Record<string, string> = { 'task.status-changed': 'task', 'artifact.status-changed': 'artifact', 'workflow.state-changed': 'workflow', 'monitor.changed': 'monitor' };
const outcomes = ['started', 'skipped', 'failed', 'done'] as const;
function Section({ title, count, id, children }: { title: string; count: number; id: string; children: ReactNode }) {
  return <Card role="region" aria-labelledby={id} className="min-w-0 gap-0 border-border py-0 shadow-none"><CardHeader className="flex flex-row items-center gap-2 border-b border-border px-5 py-4"><h3 id={id} className="font-display text-lg font-semibold">{title}</h3><Badge variant="secondary">{count}</Badge></CardHeader><CardContent className="px-5 py-1">{children}</CardContent></Card>;
}
function Row({ name, status, detail, time, technical, index }: { index: number; name: string; status: string; detail?: ReactNode; time?: string | null; technical?: ReactNode }) {
  return <StaggerItem index={index} className="min-w-0 space-y-2 py-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium break-words">{name}</span><M5Status value={status} /></div>{(detail || time) && <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">{detail && <span>{detail}</span>}{time && <time dateTime={time}>{relativeTime(time)}</time>}</div>}{technical}</StaggerItem>;
}
export function ProjectAutomation({ store, projectId }: { store: Store; projectId: string }) {
  const t = useT(); const state = store.useStoreSelector(s => s); const id = useId();
  useEffect(() => store.watchM5('automation', store.loadAutomation), [store, projectId]);
  const { schedules, rules, monitors, breakers } = state.m5;
  const routes = breakers.routes.filter(item => item.state !== 'closed'); const teams = breakers.teams.filter(item => item.state !== 'closed');
  const busy = ['schedules', 'rules', 'monitors', 'breakers'].some(area => state.loading[area]);
  return <Page className="min-w-0 space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-4"><div className="space-y-1"><h2 className="font-display text-2xl font-semibold">{t('projectUi.automation')}</h2><p className="text-sm text-muted-foreground">{t('ux5.automationDescription')}</p></div><Button type="button" variant="ghost" disabled={busy} onClick={() => void store.loadAutomation()}><RefreshCw />{t('m5Ui.refresh')}</Button></header>
    <Section id={`${id}-schedules`} title={t('automationUi.schedules')} count={schedules.length}>
      <M5ReadState store={store} area="schedules" retry={store.loadSchedules} empty={!schedules.length} emptyKey="automationUi.emptySchedules" />
      <Stagger className="divide-y divide-border">{schedules.map((item, index) => <Row index={index} key={item.id} name={item.name} status={item.state === 'active' ? 'enabled' : item.state} time={item.lastRunAt}
        detail={<>{item.nextRunAt ? <>{t('automationUi.nextRun')}: <time dateTime={item.nextRunAt}>{relativeTime(item.nextRunAt)}</time></> : item.kind === 'interval' ? t('automationUi.everySeconds').replace('{count}', item.expr) : item.kind === 'once' ? t('automationUi.once') : `${t('automationUi.cadence')}: ${item.expr}`}{item.lastStatus && <> · {t('automationUi.lastRun')}: {t(`automationUi.outcomes.${outcomes.find(outcome => outcome === item.lastStatus) ?? 'unknown'}`)}</>}</>}
        technical={<TechnicalDetails identifier={item.id}><dl className="grid gap-1"><dt>{t('automationUi.cadence')}</dt><dd className="font-mono">{item.expr}</dd>{item.timezone && <><dt>{t('automationUi.timezone')}</dt><dd>{item.timezone}</dd></>}</dl></TechnicalDetails>} />)}</Stagger>
    </Section>
    <Section id={`${id}-rules`} title={t('automationUi.rules')} count={rules.length}>
      <M5ReadState store={store} area="rules" retry={store.loadRules} empty={!rules.length} emptyKey="automationUi.emptyRules" />
      <Stagger className="divide-y divide-border">{rules.map((item, index) => <Row index={index} key={item.id} name={item.name} status={item.state === 'active' ? 'enabled' : item.state} time={item.lastFiredAt} detail={<>{t(`automationUi.triggers.${triggers[item.eventType] ?? 'unknown'}`)}{item.firesInWindow !== undefined && <> · {t('automationUi.firesInWindow').replace('{count}', String(item.firesInWindow))}</>}</>} technical={<TechnicalDetails identifier={item.id} />} />)}</Stagger>
    </Section>
    <Section id={`${id}-monitors`} title={t('automationUi.monitors')} count={monitors.length}>
      <M5ReadState store={store} area="monitors" retry={store.loadMonitors} empty={!monitors.length} emptyKey="automationUi.emptyMonitors" />
      <Stagger className="divide-y divide-border">{[...monitors].sort((a, b) => Number(b.status === 'tripped') - Number(a.status === 'tripped')).map((item, index) => <Row index={index} key={item.id} name={item.name} status={item.state === 'paused' ? 'paused' : item.status} detail={t('ux5.checked')} time={item.lastCheckedAt} technical={<TechnicalDetails identifier={item.id} />} />)}</Stagger>
    </Section>
    <Section id={`${id}-breakers`} title={t('automationUi.breakers')} count={routes.length + teams.length}>
      <M5ReadState store={store} area="breakers" retry={store.loadBreakers} empty={!routes.length && !teams.length} emptyKey="ux5.emptyBreakers" />
      <Stagger className="divide-y divide-border">{routes.map((item, index) => <Row index={index} key={item.key} name={item.key} status={item.state} detail={t('automationUi.breakers')} time={item.openedAt} technical={<TechnicalDetails identifier={item.key} />} />)}{teams.map((item, index) => <Row index={index} key={item.teamId} name={state.m3.teams.find(team => team.id === item.teamId)?.name ?? (state.team?.team.id === item.teamId ? state.team.team.name : t('automationUi.teamBreaker'))} status={item.state} detail={t('automationUi.teamBreaker')} time={item.openedAt} technical={<TechnicalDetails identifier={item.teamId} />} />)}</Stagger>
    </Section>
  </Page>;
}
