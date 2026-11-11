import { useId } from 'react';
import { deriveDisplayStatus, isLiveAttempt } from '@factory/contracts';
import { i18n, useT } from '../i18n';
import type { Store } from '../state/store';
import { ProjectBudget } from './ProjectBudget';
import { Requests } from './Requests';

export function ProjectOverview({ store, onOpenTask }: { store: Store; onOpenTask: (id: string) => void }) {
  const t = useT(); const id = useId();
  const state = store.useStoreSelector(value => value);
  const counts = [
    ['running', state.tasks.filter(task => task.state === 'active').length],
    ['review', state.tasks.filter(task => task.state === 'in-review').length],
    ['waiting', state.tasks.filter(task => task.state === 'awaiting-go').length],
    ['done', state.tasks.filter(task => task.state === 'done').length],
  ] as const;
  const approvals = new Set(state.inbox.approvals.map(item => item.taskId));
  const tasks = state.tasks.filter(task => ['active', 'awaiting-go', 'in-review'].includes(task.state) || task.holds.some(hold => hold.needsAction) || approvals.has(task.id));
  return <div className="project-overview stack">
    <dl className="project-numbers">{counts.map(([key, value]) => <div key={key}><dt>{t(`projectUi.${key}`)}</dt><dd>{new Intl.NumberFormat(i18n.locale).format(value)}</dd></div>)}</dl>
    <ProjectBudget store={store} />
    <section className="stack" aria-labelledby={`${id}-activity`}><h2 id={`${id}-activity`}>{t('projectUi.activeTasks')}</h2>
      {!tasks.length && <p className="muted">{t('projectUi.noActiveTasks')}</p>}
      <ul className="task-list">{tasks.map(task => {
        const attempt = state.liveAttempts[task.id];
        const display = deriveDisplayStatus({ ...task, liveAttempt: attempt && isLiveAttempt(attempt.state) ? attempt.state : null });
        return <li key={task.id}><button type="button" className="project-task-link" onClick={() => onOpenTask(task.id)}><span className="task-code">{task.code}</span><strong>{task.title}</strong><span className="project-status">{t(`taskUi.display.${display.status}`)}</span></button></li>;
      })}</ul>
    </section>
    <Requests store={store} hideEmpty />
  </div>;
}

