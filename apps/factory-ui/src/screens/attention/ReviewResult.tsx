import { useEffect } from 'react';
import { useT } from '../../i18n';
import { Button } from '../../components/Button';
import { ErrorNotice } from '../../components/ErrorNotice';
import type { Store } from '../../state/store';
import { summariseEvent } from '../../state/attemptView';
import { Results } from '../TaskDetail';

export function ReviewResult({ store, taskId }: { store: Store; taskId: string }) {
  const t = useT(); const state = store.useStoreSelector(value => value);
  useEffect(() => { void store.openTask(taskId); return () => store.closeTask(taskId); }, [store, taskId]);
  const task = state.tasks.find(item => item.id === taskId); const detail = state.details[taskId]; const attempt = detail?.attempts[0];
  const events = attempt ? detail?.events[attempt.id] ?? [] : [];
  const checks = events.filter(event => event.kind === 'evidence').map(summariseEvent).filter(event => event.text);
  const conflict = state.globalInbox.integrationConflicts?.find(item => item.taskId === taskId);
  return <div className="attention-result-grid"><div className="attention-result stack">
    {state.loading[`detail:${taskId}`] && <p role="status">{t('viewStates.loading')}</p>}
    {state.errors[`detail:${taskId}`] && <><ErrorNotice error={state.errors[`detail:${taskId}`]!} /><Button onClick={() => { void store.loadTaskDetail(taskId); }}>{t('errors.retry')}</Button></>}
    {task && detail && <Results store={store} task={task} detail={detail} attempt={attempt} />}
    {attempt && <details><summary>{t('attention.technicalDetails')}</summary><dl><dt>{t('workUi.epoch')}</dt><dd>{attempt.epoch}</dd><dt>{t('attention.identifier')}</dt><dd>{attempt.id}</dd></dl></details>}
  </div><aside className="attention-facts stack" aria-label={t('attention.facts')}>
    <section><h3>{t('taskUi.acceptance')}</h3><ul className="attention-criteria">{task?.acceptance.map((criterion, index) => <li key={index}><span aria-hidden="true">○ </span>{criterion}</li>)}</ul></section>
    <section><h3>{t('attention.checks')}</h3>{checks.length ? <ul>{checks.map((check, index) => <li key={index}>{check.text}</li>)}</ul> : <p>{t('attention.noChecks')}</p>}</section>
    {conflict && <section><h3>{t('attention.integration')}</h3><p>{t('attention.kinds.integration-conflict')}: {conflict.branch}</p></section>}
  </aside></div>;
}
