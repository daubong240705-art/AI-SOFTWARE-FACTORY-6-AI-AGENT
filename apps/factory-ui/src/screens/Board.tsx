import { useState } from 'react';
import { deriveDisplayStatus, isLiveAttempt, type Task } from '@factory/contracts';
import { Badge } from '../components/Badge';
import { i18n, plural, useT } from '../i18n';
import type { Store } from '../state/store';

export const boardColumns = ['proposed', 'ready', 'running', 'review', 'done', 'attention', 'closed'] as const;
export type BoardColumn = typeof boardColumns[number];
export function taskColumn(task: Task): BoardColumn {
  if (task.state === 'failed' || task.holds.some(hold => hold.needsAction)) return 'attention';
  switch (task.state) {
    case 'proposed': return 'proposed';
    case 'accepted': case 'ready': case 'awaiting-go': return 'ready';
    case 'active': return 'running';
    case 'in-review': return 'review';
    case 'done': return 'done';
    default: return 'closed';
  }
}
export function Board({ store, onOpen, tasks: visibleTasks }: { store: Store; onOpen: (taskId: string) => void; tasks?: Task[] }) {
  const t = useT();
  const state = store.useStoreSelector(value => value);
  const [closed, setClosed] = useState(false);
  const decisions = new Set(state.inbox.approvals.map(item => item.taskId));
  const number = (v: number) => new Intl.NumberFormat(i18n.locale).format(v);
  return <div className="board" aria-label={t('workUi.board')}>
    {boardColumns.map(column => {
      const tasks = (visibleTasks ?? state.tasks).filter(task => (decisions.has(task.id) ? 'attention' : taskColumn(task)) === column).sort((a, b) => a.code.localeCompare(b.code));
      const count = <span>{number(tasks.length)} {plural(t, i18n.locale, tasks.length, 'workUi.count')}</span>;
      return <section className="board-column stack" key={column} aria-label={t(`workUi.columns.${column}`)}>
        <h3>{column === 'closed' ? <button type="button" aria-expanded={closed} onClick={() => setClosed(!closed)}>{t('workUi.columns.closed')} {count}</button> : <>{t(`workUi.columns.${column}`)} {count}</>}</h3>
        {(column !== 'closed' || closed) && (tasks.length ? <ul className="task-list stack">{tasks.map(task => {
          const attempt = state.details[task.id]?.attempts.find(a => isLiveAttempt(a.state)) ?? state.liveAttempts[task.id];
          const live = attempt && isLiveAttempt(attempt.state) ? attempt : null;
          const display = deriveDisplayStatus({ ...task, liveAttempt: live?.state ?? null });
          const owner = state.team?.seats.find(seat => seat.id === task.ownerSeatId)?.name;
          return <li key={task.id}><button type="button" data-task-id={task.id} className="board-card card stack" onClick={() => onOpen(task.id)}>
            <span className="task-code">{task.code}</span><strong>{task.title}</strong>
            {decisions.has(task.id) && <Badge className="project-needs-decision">{t('inboxUi.needsDecision')}</Badge>}
            <span className={`project-status project-status-${display.status}`}>{t(`taskUi.display.${display.status}`)}</span>
            {owner && <span className="muted">{owner}</span>}
          </button></li>;
        })}</ul> : <p className="muted">{t('workUi.empty')}</p>)}
      </section>;
    })}
  </div>;
}
