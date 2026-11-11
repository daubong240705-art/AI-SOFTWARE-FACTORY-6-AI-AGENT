import { useEffect, useId } from 'react';
import { useT } from '../i18n';
import { relativeTime } from './Inbox';
import { M5ReadState, M5Status } from './M5Shared';
import type { Store } from '../state/store';

const triggers: Record<string, string> = { 'task.status-changed': 'task', 'artifact.status-changed': 'artifact', 'workflow.state-changed': 'workflow', 'monitor.changed': 'monitor' };
const outcomes = ['started', 'skipped', 'failed', 'done'] as const;
export function ProjectAutomation({ store, projectId }: { store: Store; projectId: string }) {
  const t = useT(); const state = store.useStoreSelector(s => s); const id = useId();
  useEffect(() => store.watchM5('automation', store.loadAutomation), [store, projectId]);
  const { schedules, rules, monitors, breakers } = state.m5;
  const routes = breakers.routes.filter(item => item.state !== 'closed');
  const teams = breakers.teams.filter(item => item.state !== 'closed');
  const busy = ['schedules', 'rules', 'monitors', 'breakers'].some(area => state.loading[area]);
  const technical = (identifier: string) => <details><summary>{t('m5Ui.technicalDetails')}</summary><dl><dt>{t('m5Ui.identifier')}</dt><dd>{identifier}</dd></dl></details>;
  return <div className="m5-screen automation-screen">
    <header className="m5-toolbar"><h2>{t('projectUi.automation')}</h2><button type="button" disabled={busy} onClick={() => void store.loadAutomation()}>{t('m5Ui.refresh')}</button></header>
    <section aria-labelledby={`${id}-schedules`}><h3 id={`${id}-schedules`}>{t('automationUi.schedules')}</h3>
      <M5ReadState store={store} area="schedules" retry={store.loadSchedules} empty={!schedules.length} emptyKey="automationUi.emptySchedules" />
      <ul>{schedules.map(item => <li className="automation-row" key={item.id}>
        <strong>{item.name}</strong><M5Status value={item.state === 'active' ? 'enabled' : item.state} />
        {item.nextRunAt ? <span>{t('automationUi.nextRun')}: <time dateTime={item.nextRunAt}>{relativeTime(item.nextRunAt)}</time></span>
          : item.kind === 'interval' ? <span>{t('automationUi.everySeconds').replace('{count}', item.expr)}</span>
          : item.kind === 'once' ? <span>{t('automationUi.once')}</span> : <span>{t('automationUi.cadence')}: {item.expr}</span>}
        {item.lastStatus && <span>{t('automationUi.lastRun')}: {t(`automationUi.outcomes.${outcomes.find(outcome => outcome === item.lastStatus) ?? 'unknown'}`)}</span>}
        {item.lastRunAt && <time dateTime={item.lastRunAt}>{relativeTime(item.lastRunAt)}</time>}
        <details><summary>{t('m5Ui.technicalDetails')}</summary><dl><dt>{t('m5Ui.identifier')}</dt><dd>{item.id}</dd><dt>{t('automationUi.cadence')}</dt><dd>{item.expr}</dd>{item.timezone && <><dt>{t('automationUi.timezone')}</dt><dd>{item.timezone}</dd></>}</dl></details>
      </li>)}</ul>
    </section>
    <section aria-labelledby={`${id}-rules`}><h3 id={`${id}-rules`}>{t('automationUi.rules')}</h3>
      <M5ReadState store={store} area="rules" retry={store.loadRules} empty={!rules.length} emptyKey="automationUi.emptyRules" />
      <ul>{rules.map(item => <li className="automation-row" key={item.id}>
        <strong>{item.name}</strong><M5Status value={item.state === 'active' ? 'enabled' : item.state} />
        <span>{t(`automationUi.triggers.${triggers[item.eventType] ?? 'unknown'}`)}</span>
        {item.lastFiredAt ? <span>{t('automationUi.lastFire')}: <time dateTime={item.lastFiredAt}>{relativeTime(item.lastFiredAt)}</time></span>
          : item.firesInWindow !== undefined && <span>{t('automationUi.firesInWindow').replace('{count}', String(item.firesInWindow))}</span>}
        {technical(item.id)}
      </li>)}</ul>
    </section>
    <section aria-labelledby={`${id}-monitors`}><h3 id={`${id}-monitors`}>{t('automationUi.monitors')}</h3>
      <M5ReadState store={store} area="monitors" retry={store.loadMonitors} empty={!monitors.length} emptyKey="automationUi.emptyMonitors" />
      <ul>{[...monitors].sort((a, b) => Number(b.status === 'tripped') - Number(a.status === 'tripped')).map(item => <li className="automation-row" key={item.id}>
        <strong>{item.name}</strong><M5Status value={item.state === 'paused' ? 'paused' : item.status} />{technical(item.id)}
      </li>)}</ul>
    </section>
    {(routes.length > 0 || teams.length > 0 || state.loading.breakers || state.errors.breakers) && <section aria-labelledby={`${id}-breakers`}><h3 id={`${id}-breakers`}>{t('automationUi.breakers')}</h3>
      <M5ReadState store={store} area="breakers" retry={store.loadBreakers} />
      <ul>{routes.map(item => <li className="automation-row" key={item.key}><strong>{item.key}</strong><M5Status value={item.state} />{item.openedAt && <time dateTime={item.openedAt}>{relativeTime(item.openedAt)}</time>}</li>)}
        {teams.map(item => <li className="automation-row" key={item.teamId}><strong>{state.m3.teams.find(team => team.id === item.teamId)?.name ?? (state.team?.team.id === item.teamId ? state.team.team.name : t('automationUi.teamBreaker'))}</strong><M5Status value={item.state} />{technical(item.teamId)}</li>)}</ul>
    </section>}
  </div>;
}
