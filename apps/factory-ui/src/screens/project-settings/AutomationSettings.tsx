import { Section as AppSection } from '@/components/app';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { relativeTime } from '@/lib/inbox';
import { M5ReadState, M5Status, TechnicalDetails } from '../M5Shared';
import type { Store } from '@/state/store';
import { AutomationConfirmation, AutomationEditor } from '../automation/AutomationDialogs';
import { RowActions, RowError } from '../automation/RowActions';
import { pendingKey, type Area, type Editor, type Target } from '../automation/types';

const triggers: Record<string, string> = { 'task.status-changed': 'task', 'artifact.status-changed': 'artifact', 'workflow.state-changed': 'workflow', 'monitor.changed': 'monitor' };
const outcomes = ['started', 'skipped', 'failed', 'done'] as const;
function Section({ title, count, id, children, action }: { title: string; count: number; id: string; children: ReactNode; action?: ReactNode }) {
  return <AppSection id={id} title={<>{title} <Badge variant="secondary">{count}</Badge></>} actions={action}>{children}</AppSection>;
}
function Row({ name, status, detail, time, technical, actions, error }: { name: string; status: string; detail?: ReactNode; time?: string | null; technical?: ReactNode; actions?: ReactNode; error?: ReactNode }) {
  return <li className="min-w-0 space-y-2 py-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1"><div className="flex items-start justify-between gap-3"><span className="min-w-0 font-medium break-words">{name}</span><div className="flex shrink-0 items-center gap-2"><M5Status value={status} />{actions}</div></div>{(detail || time) && <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">{detail && <span>{detail}</span>}{time && <time dateTime={time}>{relativeTime(time)}</time>}</div>}{technical}{error}</li>;
}
export function AutomationSettings({ store, projectId }: { store: Store; projectId: string }) {
  const t = useT(); const state = store.useStoreSelector(s => s); const id = useId();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [confirmation, setConfirmation] = useState<{ target: Target; action: 'delete' | 'run-now' } | null>(null);
  useEffect(() => store.watchM5('automation', store.loadAutomation), [store, projectId]);
  useEffect(() => { void store.loadWorkflowDefinitions(); }, [store, projectId]);
  useEffect(() => { setEditor(null); setConfirmation(null); }, [projectId]);
  const add = (area: Area) => <Button type="button" size="sm" variant="outline" disabled={Boolean(state.loading[pendingKey(area)])} onClick={() => setEditor({ area })}><Plus className="size-3.5" />{t(`automationWrite.add.${area}`)}</Button>;
  const rowActions = (target: Target) => ({ actions: <RowActions target={target} store={store} projectId={projectId} onEdit={setEditor} onConfirm={(value, action) => setConfirmation({ target: value, action })} />, error: <RowError store={store} target={target} /> });
  const { schedules, rules, monitors, breakers } = state.m5;
  const routes = breakers.routes.filter(item => item.state !== 'closed'); const teams = breakers.teams.filter(item => item.state !== 'closed');
  return <div className="min-w-0 space-y-6">
    <Section id={`${id}-schedules`} title={t('automationUi.schedules')} count={schedules.length} action={add('schedules')}>
      <M5ReadState store={store} area="schedules" retry={store.loadSchedules} empty={!schedules.length} emptyKey="automationUi.emptySchedules" />
      <ul className="m-0 list-none divide-y divide-border p-0">{schedules.map(item => <Row {...rowActions({ area: 'schedules', item })} key={item.id} name={item.name} status={item.state === 'active' ? 'enabled' : item.state} time={item.lastRunAt}
        detail={<>{item.nextRunAt ? <>{t('automationUi.nextRun')}: <time dateTime={item.nextRunAt}>{relativeTime(item.nextRunAt)}</time></> : item.kind === 'interval' ? t('automationUi.everySeconds').replace('{count}', item.expr) : item.kind === 'once' ? t('automationUi.once') : `${t('automationUi.cadence')}: ${item.expr}`}{item.lastStatus && <> · {t('automationUi.lastRun')}: {t(`automationUi.outcomes.${outcomes.find(outcome => outcome === item.lastStatus) ?? 'unknown'}`)}</>}</>}
        technical={<TechnicalDetails identifier={item.id}><dl className="grid gap-1"><dt>{t('automationUi.cadence')}</dt><dd className="font-mono">{item.expr}</dd>{item.timezone && <><dt>{t('automationUi.timezone')}</dt><dd>{item.timezone}</dd></>}</dl></TechnicalDetails>} />)}</ul>
    </Section>
    <Section id={`${id}-rules`} title={t('automationUi.rules')} count={rules.length} action={add('rules')}>
      <M5ReadState store={store} area="rules" retry={store.loadRules} empty={!rules.length} emptyKey="automationUi.emptyRules" />
      <ul className="m-0 list-none divide-y divide-border p-0">{rules.map(item => <Row {...rowActions({ area: 'rules', item })} key={item.id} name={item.name} status={item.state === 'active' ? 'enabled' : item.state} time={item.lastFiredAt} detail={<>{t(`automationUi.triggers.${triggers[item.eventType] ?? 'unknown'}`)}{item.firesInWindow !== undefined && <> · {t('automationUi.firesInWindow').replace('{count}', String(item.firesInWindow))}</>}</>} technical={<TechnicalDetails identifier={item.id} />} />)}</ul>
    </Section>
    <Section id={`${id}-monitors`} title={t('automationUi.monitors')} count={monitors.length} action={add('monitors')}>
      <M5ReadState store={store} area="monitors" retry={store.loadMonitors} empty={!monitors.length} emptyKey="automationUi.emptyMonitors" />
      <ul className="m-0 list-none divide-y divide-border p-0">{[...monitors].sort((a, b) => Number(b.status === 'tripped') - Number(a.status === 'tripped')).map(item => <Row {...rowActions({ area: 'monitors', item })} key={item.id} name={item.name} status={item.state === 'paused' ? 'paused' : item.status} detail={t('ux5.checked')} time={item.lastCheckedAt} technical={<TechnicalDetails identifier={item.id} />} />)}</ul>
    </Section>
    <Section id={`${id}-breakers`} title={t('automationUi.breakers')} count={routes.length + teams.length}>
      <M5ReadState store={store} area="breakers" retry={store.loadBreakers} empty={!routes.length && !teams.length} emptyKey="ux5.emptyBreakers" />
      <ul className="m-0 list-none divide-y divide-border p-0">{routes.map(item => <Row key={item.key} name={item.key} status={item.state} detail={t('automationUi.breakers')} time={item.openedAt} technical={<TechnicalDetails identifier={item.key} />} />)}{teams.map(item => <Row key={item.teamId} name={state.m3.teams.find(team => team.id === item.teamId)?.name ?? (state.team?.team.id === item.teamId ? state.team.team.name : t('automationUi.teamBreaker'))} status={item.state} detail={t('automationUi.teamBreaker')} time={item.openedAt} technical={<TechnicalDetails identifier={item.teamId} />} />)}</ul>
    </Section>
    {editor && <AutomationEditor editor={editor} store={store} projectId={projectId} onClose={() => setEditor(null)} />}
    {confirmation && <AutomationConfirmation {...confirmation} store={store} projectId={projectId} onClose={() => setConfirmation(null)} />}
  </div>;
}
