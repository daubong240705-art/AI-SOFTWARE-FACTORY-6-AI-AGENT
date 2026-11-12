import { AnimatePresence } from 'motion/react';
import { Stagger, StaggerItem } from '@/components/motion/Stagger';
import { useState } from 'react';
import type { Task } from '@factory/contracts';
import { ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { i18n, useT } from '../i18n';
import type { Store } from '../state/store';
import { DecisionBadge, SeatChip, TaskTime } from './TaskPresentation';
import { TaskStatus } from './shell/TaskStatus';

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
const borders: Record<BoardColumn, string> = {
  proposed: 'border-t-muted-foreground/40', ready: 'border-t-info', running: 'border-t-run',
  review: 'border-t-info', done: 'border-t-ok', attention: 'border-t-need', closed: 'border-t-muted-foreground/40',
};

export function Board({ store, onOpen, tasks: visibleTasks, selectedTask }: {
  store: Store; onOpen: (taskId: string) => void; tasks?: Task[]; selectedTask?: string | null;
}) {
  const t = useT(); const state = store.useStoreSelector(value => value);
  const [closed, setClosed] = useState(false);
  const decisions = new Set(state.inbox.approvals.map(item => item.taskId));
  const tasks = visibleTasks ?? state.tasks;
  const inColumn = (column: BoardColumn) => tasks.filter(task => (decisions.has(task.id) ? 'attention' : taskColumn(task)) === column).sort((a, b) => a.code.localeCompare(b.code));
  function cards(items: Task[]) {
    return <><Stagger className="m-0 grid list-none gap-3 p-0"><AnimatePresence initial={false}>{items.map((task, index) => <StaggerItem key={task.id} index={index} collapse className="min-w-0">
      <Card className={cn('gap-0 rounded-xl border-border p-0 shadow-none transition-colors hover:bg-secondary', selectedTask === task.id && 'ring-1 ring-ring')}>
        <Button type="button" variant="ghost" data-task-id={task.id} aria-pressed={selectedTask === task.id} onClick={() => onOpen(task.id)} className="h-auto w-full min-w-0 flex-col items-stretch gap-3 rounded-xl border-0 bg-transparent p-4 text-left font-normal whitespace-normal hover:bg-secondary">
          <span className="flex items-center justify-between gap-2"><span className="font-mono text-xs text-muted-foreground">{task.code}</span><TaskStatus task={task} state={state} dotOnly /></span>
          <strong className="line-clamp-2 text-sm leading-relaxed font-medium [overflow-wrap:anywhere]">{task.title}</strong>
          <span className="flex items-center justify-between gap-2"><SeatChip name={state.team?.seats.find(seat => seat.id === task.ownerSeatId)?.name} /><TaskTime task={task} state={state} /></span>
          {decisions.has(task.id) && <DecisionBadge />}
        </Button>
      </Card>
    </StaggerItem>)}</AnimatePresence></Stagger>{!items.length && <div className="grid min-h-28 place-items-center rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">{t('ux4.empty')}</div>}</>;
  }
  const closedTasks = inColumn('closed');
  return <div className="min-w-0 max-w-full space-y-4" aria-label={t('workUi.board')}>
    <div className="w-full min-w-0 overflow-x-auto overscroll-x-contain pb-3 [scrollbar-color:var(--line)_transparent] [scrollbar-width:thin]">
      <div className="grid grid-flow-col auto-cols-[minmax(196px,1fr)] items-start gap-3 p-1">
        {boardColumns.filter(column => column !== 'closed').map(column => {
          const items = inColumn(column);
          return <section key={column} aria-label={t(`workUi.columns.${column}`)} className={cn('min-w-0 space-y-4 rounded-lg border-t-2 bg-muted/20 p-3', borders[column])}>
            <header className="flex min-w-0 items-center justify-between gap-3"><h3 className="text-sm font-medium">{t(`workUi.columns.${column}`)}</h3><Badge variant="secondary" className="tabular-nums">{new Intl.NumberFormat(i18n.locale).format(items.length)}</Badge></header>
            {cards(items)}
          </section>;
        })}
      </div>
    </div>
    <section aria-label={t('workUi.columns.closed')} className="space-y-3">
      <Button type="button" variant="ghost" size="sm" className="gap-2 text-muted-foreground" aria-expanded={closed} onClick={() => setClosed(!closed)}><ChevronDown className={cn('size-3.5 transition-transform', closed && 'rotate-180')} />{t('workUi.columns.closed')}<Badge variant="secondary">{new Intl.NumberFormat(i18n.locale).format(closedTasks.length)}</Badge></Button>
      {closed && <div className="max-w-sm p-1">{cards(closedTasks)}</div>}
    </section>
  </div>;
}
