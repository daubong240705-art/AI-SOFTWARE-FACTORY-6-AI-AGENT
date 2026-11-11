import { useId, useRef, useState } from 'react';
import { deriveDisplayStatus } from '@factory/contracts';
import { useT } from '../i18n';
import type { Store } from '../state/store';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ErrorNotice } from '../components/ErrorNotice';
import { Board } from './Board';
import { NewTask } from './NewTask';
import { TaskRow } from './TaskRow';
import { TaskDetail } from './TaskDetail';

const viewChoices = new WeakMap<Store, 'board' | 'list'>();
const filters = ['all', 'proposed', 'accepted', 'done', 'closed'] as const;
type Filter = typeof filters[number];

export function ProjectTasks({ store, projectId, selectedTask, onOpenTask, onCloseTask, newTaskOpen, newTaskId }: {
  store: Store; projectId: string; selectedTask?: string | null; onOpenTask?: (id: string) => void; onCloseTask?: () => void; newTaskOpen?: boolean; newTaskId?: string;
}) {
  const t = useT();
  const state = store.useStoreSelector(value => value);
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setView] = useState<'board' | 'list'>(() => viewChoices.get(store) ?? 'board');
  const [localSelected, setSelected] = useState<string | null>(null);
  const selected = selectedTask === undefined ? localSelected : selectedTask;
  const id = useId(); const board = useRef<HTMLDivElement>(null);
  const tasks = [...state.tasks].sort((a, b) => a.code.localeCompare(b.code)).filter(task => filter === 'all' || (filter === 'closed'
    ? deriveDisplayStatus({ ...task, liveAttempt: null }).status === 'closed' : task.state === filter));
  function open(taskId: string) { if (onOpenTask) onOpenTask(taskId); else setSelected(taskId); }
  function close() { if (onCloseTask) onCloseTask(); else setSelected(null); }
  function fallbackFocus() { return Array.from(board.current?.querySelectorAll<HTMLButtonElement>('[data-task-id]') ?? []).find(node => node.dataset.taskId === selected) ?? null; }
  return <div className={`project-tasks${selected ? ' has-task-pane' : ''}`}>
    <div className="project-board-area stack" ref={board}>
      {state.errors.tasks && <ErrorNotice error={state.errors.tasks} />}
      <div className="project-board-toolbar">
        <div className="task-actions" role="group" aria-label={t('workUi.views')}>{(['board', 'list'] as const).map(value => <Button key={value} aria-pressed={view === value} onClick={() => { setView(value); viewChoices.set(store, value); }}>{t(`workUi.${value}`)}</Button>)}</div>
        <div className="field task-filter"><label htmlFor={id}>{t('taskUi.filter')}</label><select id={id} value={filter} onChange={event => setFilter(event.target.value as Filter)}>{filters.map(value => <option key={value} value={value}>{t(`taskUi.filters.${value}`)}</option>)}</select></div>
      </div>
      <NewTask store={store} projectId={projectId} {...(newTaskOpen === undefined ? {} : { open: newTaskOpen })} {...(newTaskId === undefined ? {} : { formId: newTaskId })} />
      {state.loading.tasks && !state.tasks.length ? <p role="status">{t('viewStates.loading')}</p> : view === 'board' ? <Board store={store} tasks={tasks} onOpen={open} /> : tasks.length ? <ul className="task-list stack">{tasks.map(task => <li key={task.id}><TaskRow store={store} projectId={projectId} task={task} /></li>)}</ul> : <Card><p>{t(state.tasks.length ? 'taskUi.noMatches' : 'tasks.empty')}</p></Card>}
    </div>
    {selected && <TaskDetail key={selected} store={store} taskId={selected} inline initialTab="progress" onClose={close} fallbackFocus={fallbackFocus} />}
  </div>;
}

