import { useEffect, useId } from 'react';
import { i18n, useT } from '../i18n';
import { relativeTime } from './Inbox';
import { M5ReadState } from './M5Shared';
import type { Store } from '../state/store';
import type { AutonomyTeam, StandingApproval } from '../api/settingsModels';

function verdictClass(verdict: string) { return `settings-verdict settings-verdict-${verdict}`; }

export function ProjectSettings({ store, projectId }: { store: Store; projectId: string }) {
  const t = useT(); const id = useId(); const state = store.useStoreSelector(value => value);
  useEffect(() => store.watchM5('settings', store.loadSettings), [store, projectId]);
  const busy = state.loading.autonomy || state.loading.standingApprovals || state.loading.budget;
  return <div className="m5-screen settings-screen">
    <header className="m5-toolbar"><h2>{t('projectUi.settings')}</h2><button type="button" disabled={busy} onClick={() => void store.loadSettings()}>{t('m5Ui.refresh')}</button></header>
    <BudgetSection state={state} store={store} id={`${id}-budget`} />
    <AutonomySection state={state} store={store} id={`${id}-autonomy`} />
    <ApprovalsSection state={state} store={store} id={`${id}-approvals`} />
  </div>;
}

function BudgetSection({ state, store, id }: { state: ReturnType<Store['getState']>; store: Store; id: string }) {
  const t = useT(); const budget = state.budget; const number = new Intl.NumberFormat(i18n.locale);
  const usage = (item: { used: number; limit: number }) => `${number.format(item.used)} / ${number.format(item.limit)}`;
  const rank = { exceeded: 0, warn: 1, ok: 2 };
  const tasks = [...(budget?.tasks ?? [])].sort((a, b) => rank[a.verdict] - rank[b.verdict]);
  return <section aria-labelledby={id}><h3 id={id}>{t('settingsUi.budget')}</h3>
    <M5ReadState store={store} area="budget" retry={store.loadBudget} empty={!budget} emptyKey="settingsUi.budgetUnavailable" />
    {budget && <><div className="settings-budget-row budget"><strong>{t('settingsUi.day')}</strong><meter min={0} max={budget.day.limit} value={Math.min(budget.day.used, budget.day.limit)} aria-label={t('settingsUi.day')} aria-valuetext={`${usage(budget.day)} ${t('settingsUi.tokens')}`} /><span>{usage(budget.day)} {t('settingsUi.tokens')}</span><span className={verdictClass(budget.day.verdict)}>{t(`settingsUi.verdict.${budget.day.verdict}`)}</span></div>
      {budget.project ? <div className="settings-row"><strong>{t('settingsUi.project')}</strong>{budget.project.limit === null ? <span>{t('settingsUi.noProjectLimit')}</span> : <><span>{usage({ ...budget.project, limit: budget.project.limit })} {t('settingsUi.tokens')}</span><span className={verdictClass(budget.project.verdict)}>{t(`settingsUi.verdict.${budget.project.verdict}`)}</span></>}</div> : <p>{t('settingsUi.projectBudgetUnavailable')}</p>}
      {!!budget.engagements?.length && <ul className="settings-list">{budget.engagements.map(item => <li className="settings-row" key={item.engagementId}><strong>{t('settingsUi.engagement')}</strong><span>{usage(item)} {t('settingsUi.tokens')}</span><span className={verdictClass(item.verdict)}>{t(`settingsUi.verdict.${item.verdict}`)}</span><TechnicalDetails identifier={item.engagementId} /></li>)}</ul>}
      {!!tasks.length && <div className="settings-table-wrap"><table className="settings-table"><caption>{t('settingsUi.allTasks')}</caption><thead><tr><th scope="col">{t('settingsUi.task')}</th><th scope="col">{t('settingsUi.usedLimit')}</th><th scope="col">{t('settingsUi.verdictWord')}</th></tr></thead><tbody>{tasks.map(item => <tr key={item.taskId}><th scope="row">{item.code}</th><td>{usage(item)}</td><td className={verdictClass(item.verdict)}>{t(`settingsUi.verdict.${item.verdict}`)}</td></tr>)}</tbody></table></div>}
    </>}
  </section>;
}

function levelText(t: ReturnType<typeof useT>, level: number | 'unknown') { return t(`settingsUi.levels.${level}`); }
function AutonomySection({ state, store, id }: { state: ReturnType<Store['getState']>; store: Store; id: string }) {
  const t = useT(); const autonomy = state.settings.autonomy;
  const teamName = (teamId: string) => state.m3.teams.find(team => team.id === teamId)?.name ?? (state.team?.team.id === teamId ? state.team.team.name : t('settingsUi.unknownTeam'));
  const level = autonomy?.project.level ?? 'unknown';
  return <section aria-labelledby={id}><h3 id={id}>{t('settingsUi.autonomy')}</h3><M5ReadState store={store} area="autonomy" retry={store.loadAutonomy} empty={!autonomy} emptyKey="settingsUi.autonomyUnavailable" />
    {autonomy && <><p className="settings-level"><strong>{levelText(t, level)}</strong> {level !== 'unknown' && <span>{t('settingsUi.levelNumber').replace('{level}', String(level))}</span>}</p><p className="settings-source">{t(`settingsUi.source.${autonomy.project.source}`)}</p><ul className="settings-list">{autonomy.teams.map(team => <TeamRow key={team.teamId} team={team} name={teamName(team.teamId)} />)}</ul></>}
  </section>;
}

function TeamRow({ team, name }: { team: AutonomyTeam; name: string }) {
  const t = useT();
  return <li className="settings-row"><strong>{name}</strong><span>{levelText(t, team.level)} {typeof team.level === 'number' && `(L${team.level})`}</span>{team.effectiveLevel !== team.level && <span>{t('settingsUi.effective')}: {levelText(t, team.effectiveLevel)} {typeof team.effectiveLevel === 'number' && `(L${team.effectiveLevel})`}</span>}<TechnicalDetails identifier={team.teamId} /></li>;
}

function TechnicalDetails({ identifier, scopeRef }: { identifier: string; scopeRef?: string }) {
  const t = useT();
  return <details><summary>{t('m5Ui.technicalDetails')}</summary><dl><dt>{t('m5Ui.identifier')}</dt><dd>{identifier}</dd>{scopeRef && <><dt>{t('settingsUi.scopeRef')}</dt><dd>{scopeRef}</dd></>}</dl></details>;
}

function actionText(t: ReturnType<typeof useT>, action: string) { return t(`settingsUi.actions.${action}`); }
function ApprovalRow({ item, scope }: { item: StandingApproval; scope: string }) {
  const t = useT();
  return <li className="settings-row"><strong>{actionText(t, item.actionKind)}</strong><span className="m5-status">{t(`settingsUi.states.${item.state}`)}</span><span>{scope}</span><span>{t('settingsUi.uses').replace('{used}', String(item.usedToday)).replace('{limit}', String(item.limitPerDay))}</span><time dateTime={item.expiresAt}>{t('settingsUi.expires')} {relativeTime(item.expiresAt)}</time><TechnicalDetails identifier={item.id} scopeRef={item.scope.ref} /></li>;
}
function ApprovalsSection({ state, store, id }: { state: ReturnType<Store['getState']>; store: Store; id: string }) {
  const t = useT(); const approvals = state.settings.standingApprovals?.items ?? [];
  const active = approvals.filter(item => item.state !== 'revoked' && item.state !== 'expired').sort((a, b) => Number(b.state === 'active') - Number(a.state === 'active'));
  const inactive = approvals.filter(item => item.state === 'revoked' || item.state === 'expired');
  const scope = (item: StandingApproval) => item.scope.kind === 'team' ? state.m3.teams.find(team => team.id === item.scope.ref)?.name ?? (state.team?.team.id === item.scope.ref ? state.team.team.name : t('settingsUi.unknownTeam')) : t(`settingsUi.scope.${item.scope.kind}`);
  return <section aria-labelledby={id}><h3 id={id}>{t('settingsUi.standingApprovals')}</h3><M5ReadState store={store} area="standingApprovals" retry={store.loadStandingApprovals} empty={!approvals.length} emptyKey="settingsUi.emptyApprovals" />{active.length > 0 && <ul className="settings-list">{active.map(item => <ApprovalRow key={item.id} item={item} scope={scope(item)} />)}</ul>}{inactive.length > 0 && <details><summary>{t('settingsUi.inactiveApprovals')}</summary><ul className="settings-list">{inactive.map(item => <ApprovalRow key={item.id} item={item} scope={scope(item)} />)}</ul></details>}</section>;
}
