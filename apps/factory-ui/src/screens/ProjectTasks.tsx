import { MascotEmpty } from '@/components/mascot';
import { Skeleton } from '@/components/ui/skeleton';
import { PanelPresence, usePanelLayout } from '@/components/motion/PanelPresence';
import { useId, useRef, useState } from 'react';
import { deriveDisplayStatus } from '@factory/contracts';
import { useT } from '../i18n';
import type { Store } from '../state/store';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { ErrorNotice } from '../components/ErrorNotice';
import { Board } from './Board';
import { NewTask } from './NewTask';
import { TaskRow } from './TaskRow';
import { TaskDetail } from './TaskDetail';
import { Select } from '../components/Select';

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
  const [paneVisible, paneExited] = usePanelLayout(!!selected);
  const id = useId(); const board = useRef<HTMLDivElement>(null);
  const tasks = [...state.tasks].sort((a, b) => a.code.localeCompare(b.code)).filter(task => filter === 'all' || (filter === 'closed'
    ? deriveDisplayStatus({ ...task, liveAttempt: null }).status === 'closed' : task.state === filter));
  function open(taskId: string) { if (onOpenTask) onOpenTask(taskId); else setSelected(taskId); }
  function close() { if (onCloseTask) onCloseTask(); else setSelected(null); }
  function fallbackFocus() { return Array.from(board.current?.querySelectorAll<HTMLButtonElement>('[data-task-id]') ?? []).find(node => node.dataset.taskId === selected) ?? null; }
  return <div className={cn('project-tasks relative grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] overflow-hidden', paneVisible && 'has-task-pane min-[1180px]:grid-cols-[minmax(0,32fr)_minmax(0,68fr)]')}>
    <div className="project-board-area min-h-0 min-w-0 space-y-5 overflow-x-hidden overflow-y-auto px-8 py-6 2xl:px-12" ref={board}>
      {state.errors.tasks && <ErrorNotice error={state.errors.tasks} />}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <ToggleGroup type="single" variant="outline" spacing={2} value={view} onValueChange={value => { if (value === 'board' || value === 'list') { setView(value); viewChoices.set(store, value); } }} role="group" aria-label={t('workUi.views')} className="flex-wrap gap-2 rounded-none bg-transparent p-0 shadow-none">
          {(['board', 'list'] as const).map(value => <ToggleGroupItem type="button" key={value} value={value} aria-pressed={view === value} className="h-9 rounded-lg border border-border bg-transparent px-4 text-sm font-medium text-muted-foreground shadow-none hover:bg-secondary/50 hover:text-foreground data-[state=on]:border-foreground/25 data-[state=on]:bg-secondary data-[state=on]:text-foreground">{t(`workUi.${value}`)}</ToggleGroupItem>)}
        </ToggleGroup>
        <div className="flex min-w-0 items-center gap-3"><Label htmlFor={id} className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">{t('taskUi.filter')}</Label><Select id={id} className="w-36 min-w-0" value={filter} onValueChange={next => setFilter(next as Filter)} options={filters.map(value => ({ value, label: t(`taskUi.filters.${value}`) }))} /></div>
      </div>
      <NewTask store={store} projectId={projectId} {...(newTaskOpen === undefined ? {} : { open: newTaskOpen })} {...(newTaskId === undefined ? {} : { formId: newTaskId })} />
      {state.loading.tasks && !state.tasks.length ? <div role="status" aria-label={t('viewStates.loading')} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><span className="sr-only">{t('viewStates.loading')}</span>{[0,1,2,3,4,5].map(key => <Skeleton key={key} className="h-36 rounded-xl" />)}</div> : view === 'board' ? <Board store={store} tasks={tasks} onOpen={open} selectedTask={selected} /> : tasks.length ? <Card className="min-w-0 gap-0 overflow-hidden border-border py-0 shadow-none"><Table aria-label={t('workUi.list')} className="min-w-[800px]"><TableHeader><TableRow>{['taskUi.code', 'taskUi.title', 'team.state', 'team.seats', 'ux4.updated', 'workUi.actions'].map((key, index) => <TableHead key={key} className={cn('text-xs text-muted-foreground', index === 0 && 'pl-4', index === 5 && 'pr-4 text-right')}>{t(key)}</TableHead>)}</TableRow></TableHeader><TableBody>{tasks.map(task => <TaskRow key={task.id} store={store} projectId={projectId} task={task} onOpen={open} selected={selected === task.id} />)}</TableBody></Table></Card> : <Card className="border-border p-5 text-sm text-muted-foreground shadow-none"><MascotEmpty seat="Lead" state={state.tasks.length ? 'thinking' : 'idle'} compact={!!state.tasks.length}><p>{t(state.tasks.length ? 'taskUi.noMatches' : 'tasks.empty')}</p></MascotEmpty></Card>}
    </div>
    <PanelPresence className="project-task-pane min-h-0 min-w-0" fallbackFocus={fallbackFocus} onExitComplete={paneExited}>{selected && <TaskDetail key={selected} store={store} taskId={selected} inline initialTab="progress" onClose={close} fallbackFocus={fallbackFocus} />}</PanelPresence>
  </div>;
}

