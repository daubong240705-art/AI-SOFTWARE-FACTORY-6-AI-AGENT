import { AnimatePresence } from 'motion/react';
import { Stagger, StaggerItem } from '@/components/motion/Stagger';
import { useState } from 'react';
import type { Task } from '@factory/contracts';
import { ChevronDown } from 'lucide-react';
import { StatusDot } from '@/components/app';
import { Mascot } from '@/components/mascot';
import { Button } from '@/components/ui/button';
import { toneOf } from '@/lib/status';
import { cn } from '@/lib/utils';
import { i18n, useT } from '../i18n';
import type { Store } from '../state/store';
import { shallowSelectionEqual } from '../state/storeSelector';
import { TaskStatus } from './shell/TaskStatus';

export const boardColumns = ['proposed', 'ready', 'running', 'review', 'done', 'attention', 'closed'] as const;
export type BoardColumn = typeof boardColumns[number];
export function taskColumn(task: Task): BoardColumn {
  if (task.state === 'failed' || task.holds.some(hold => hold.needsAction)) return 'attention';
  switch (task.state) {
    case 'draft': case 'proposed': return 'proposed';
    case 'accepted': case 'ready': case 'awaiting-go': return 'ready';
    case 'active': return 'running';
    case 'in-review': return 'review';
    case 'done': return 'done';
    default: return 'closed';
  }
}
const columnStates: Record<BoardColumn, string> = {
  proposed: 'proposed', ready: 'ready', running: 'running', review: 'ready',
  done: 'done', attention: 'approval-required', closed: 'closed',
};

export function Board({ store, onOpen, tasks: visibleTasks, selectedTask }: {
  store: Store; onOpen: (taskId: string) => void; tasks?: Task[]; selectedTask?: string | null;
}) {
  const t = useT(); const state = store.useStoreSelector(value => ({ tasks: value.tasks, team: value.team, inbox: value.inbox, liveAttempts: value.liveAttempts }), shallowSelectionEqual);
  const [closed, setClosed] = useState(false);
  const decisions = new Set(state.inbox.approvals.map(item => item.taskId));
  const tasks = visibleTasks ?? state.tasks;
  const inColumn = (column: BoardColumn) => tasks.filter(task => (decisions.has(task.id) ? 'attention' : taskColumn(task)) === column).sort((a, b) => a.code.localeCompare(b.code));
  function cards(items: Task[]) {
    return <><Stagger className="m-0 grid list-none gap-3 p-0"><AnimatePresence initial={false}>{items.map((task, index) => {
      const owner = state.team?.seats.find(seat => seat.id === task.ownerSeatId);
      return <StaggerItem key={task.id} index={index} collapse className="min-w-0">
        <Button type="button" variant="ghost" data-task-id={task.id} aria-pressed={selectedTask === task.id} onClick={() => onOpen(task.id)} className={cn('h-auto w-full min-w-0 flex-col items-stretch gap-3 rounded-lg border border-border bg-card p-4 text-left font-normal whitespace-normal hover:bg-secondary/60', selectedTask === task.id && 'ring-1 ring-ring')}>
          <span className="font-mono text-xs text-muted-foreground">{task.code}</span>
          <strong className="line-clamp-2 text-sm leading-relaxed font-medium [overflow-wrap:anywhere]">{task.title}</strong>
          <span className="flex items-center justify-between gap-2"><TaskStatus task={task} state={state} dotOnly />{owner && <span title={owner.name}><Mascot seat={owner.name} size={20} title={owner.name} /></span>}</span>
        </Button>
    </StaggerItem>;
    })}</AnimatePresence></Stagger>{!items.length && <p className="text-sm text-muted-foreground">{t('workUi.empty')}</p>}</>;
  }
  const closedTasks = inColumn('closed');
  return <div className="min-w-0 max-w-full space-y-4" aria-label={t('workUi.board')}>
    <div className="w-full min-w-0 overflow-x-auto overscroll-x-contain pb-3 [scrollbar-color:var(--line)_transparent] [scrollbar-width:thin]">
      <div className="grid grid-flow-col auto-cols-[minmax(196px,1fr)] items-start gap-3 p-1">
        {boardColumns.filter(column => column !== 'closed').map(column => {
          const items = inColumn(column);
          return <section key={column} aria-label={t(`workUi.columns.${column}`)} className="min-w-0 space-y-4 p-3">
            <header className="flex min-w-0 items-center gap-2"><StatusDot tone={toneOf('task', columnStates[column])} label={t(`workUi.columns.${column}`)} labelHidden /><h3 className="text-sm font-medium">{t(`workUi.columns.${column}`)} <span className="text-muted-foreground tabular-nums">{new Intl.NumberFormat(i18n.locale).format(items.length)}</span></h3></header>
            {cards(items)}
          </section>;
        })}
      </div>
    </div>
    <section aria-label={t('workUi.columns.closed')} className="space-y-3">
      <Button type="button" variant="ghost" size="sm" className="gap-2 text-muted-foreground" aria-expanded={closed} onClick={() => setClosed(!closed)}><ChevronDown className={cn('size-3.5 transition-transform', closed && 'rotate-180')} /><StatusDot tone={toneOf('task', columnStates.closed)} label={t('workUi.columns.closed')} labelHidden />{t('workUi.columns.closed')} <span className="tabular-nums">{new Intl.NumberFormat(i18n.locale).format(closedTasks.length)}</span></Button>
      {closed && <div className="max-w-sm p-1">{cards(closedTasks)}</div>}
    </section>
  </div>;
}
