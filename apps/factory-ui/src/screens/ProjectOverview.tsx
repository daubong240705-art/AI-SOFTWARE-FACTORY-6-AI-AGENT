import { useId } from 'react';
import { CheckCircle2, CircleDashed, Play, ShieldAlert } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader } from '@/components/ui/empty';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { i18n, useT } from '../i18n';
import type { Store } from '../state/store';
import { relativeTime } from './Inbox';
import { ProjectBudget } from './ProjectBudget';
import { Requests } from './Requests';
import { TaskStatus } from './shell/TaskStatus';
import { taskTime } from './shell/taskTime';
import { Page } from '../components/Page';

export function ProjectOverview({ store, onOpenTask }: { store: Store; onOpenTask: (id: string) => void }) {
  const t = useT(); const id = useId(); const state = store.useStoreSelector(value => value);
  const counts = [
    ['running', state.tasks.filter(task => task.state === 'active').length, Play],
    ['review', state.tasks.filter(task => task.state === 'in-review').length, CircleDashed],
    ['waiting', state.tasks.filter(task => task.state === 'awaiting-go').length, ShieldAlert],
    ['done', state.tasks.filter(task => task.state === 'done').length, CheckCircle2],
  ] as const;
  const approvals = new Set(state.inbox.approvals.map(item => item.taskId));
  const tasks = state.tasks.filter(task => ['active', 'awaiting-go', 'in-review'].includes(task.state) || task.holds.some(hold => hold.needsAction) || approvals.has(task.id));
  return <Page className="grid gap-6">
    <dl className="m-0 grid grid-cols-2 gap-4 xl:grid-cols-4">
      {counts.map(([key, value, Icon]) => <Card key={key} className="gap-0 rounded-xl border-border p-5 shadow-none"><div className="flex items-start justify-between gap-3"><div className="flex flex-col-reverse gap-1.5"><dt className="text-sm text-muted-foreground">{t(`projectUi.${key}`)}</dt><dd className={cn('m-0 font-display text-4xl leading-none font-bold tabular-nums', key === 'waiting' && value > 0 && 'text-need')}>{new Intl.NumberFormat(i18n.locale).format(value)}</dd></div><span className="grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground"><Icon aria-hidden="true" className="size-4" /></span></div></Card>)}
    </dl>
    <ProjectBudget store={store} />
    <section aria-labelledby={`${id}-activity`}><Card className="gap-0 overflow-hidden rounded-xl border-border py-0 shadow-none"><CardHeader className="px-5 py-4"><h2 id={`${id}-activity`} className="font-display text-lg font-semibold">{t('projectUi.activeTasks')}</h2></CardHeader><Separator /><CardContent className="p-0">
      {!tasks.length ? <Empty className="py-10"><EmptyHeader><EmptyDescription>{t('projectUi.noActiveTasks')}</EmptyDescription></EmptyHeader></Empty> : <ul className="m-0 list-none p-0">{tasks.map((task, index) => { const time = taskTime(task, state); return <li key={task.id}>{index > 0 && <Separator />}<Button type="button" variant="ghost" className="flex h-auto w-full flex-wrap justify-start gap-3 rounded-none border-0 bg-transparent px-5 py-3 text-left font-normal whitespace-normal hover:bg-secondary" onClick={() => onOpenTask(task.id)}><span className="font-mono text-xs">{task.code}</span><strong className="min-w-0 flex-1 text-sm font-medium [overflow-wrap:anywhere]">{task.title}</strong><TaskStatus task={task} state={state} />{time && <time dateTime={time} className="text-xs whitespace-nowrap text-muted-foreground">{relativeTime(time)}</time>}</Button></li>; })}</ul>}
    </CardContent></Card></section>
    <Requests store={store} hideEmpty />
  </Page>;
}
