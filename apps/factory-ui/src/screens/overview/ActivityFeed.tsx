import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Section } from '@/components/app';
import { useT } from '../../i18n';
import type { Store } from '../../state/store';
import { relativeTime } from '@/lib/inbox';
import { taskTime } from '../shell/taskTime';

export function ActivityFeed({ store, onTask }: {
  store: Store; onTask: (projectId: string, taskId: string) => void;
}) {
  const t = useT(); const state = store.useStoreSelector(value => value);
  const [expanded, setExpanded] = useState(false);
  const rows = state.tasks.map(task => ({ task, time: taskTime(task, state) }))
    .sort((a, b) => (b.time ? Date.parse(b.time) : 0) - (a.time ? Date.parse(a.time) : 0) || b.task.code.localeCompare(a.task.code, undefined, { numeric: true }));
  return <Section title={t('overview.activity')} className="min-w-0">
    {!rows.length && <p className="text-sm text-muted-foreground">{t('overview.activityEmpty')}</p>}
    <ul className="m-0 list-none divide-y divide-border p-0">{rows.slice(0, expanded ? 20 : 6).map(({ task, time }) => {
      const project = state.projects.find(item => item.id === task.projectId);
      return <li key={task.id}><Button variant="ghost" className="grid h-auto w-full grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-2 py-2 text-left font-normal sm:grid-cols-[6rem_9rem_minmax(0,1fr)]" onClick={() => onTask(task.projectId, task.id)}>
        <span className="text-xs text-muted-foreground">{time ? <time dateTime={time}>{relativeTime(time)}</time> : null}</span>
        <span className="truncate text-xs text-muted-foreground">{project?.name ?? t('overview.project')}</span>
        <span className="col-span-2 line-clamp-1 min-w-0 text-sm whitespace-normal sm:col-span-1">{task.title}</span>
      </Button></li>;
    })}</ul>
    {rows.length > 6 && <Button variant="link" className="h-auto justify-self-start px-0" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{t(expanded ? 'overview.showLess' : 'overview.showMore')}</Button>}
  </Section>;
}
