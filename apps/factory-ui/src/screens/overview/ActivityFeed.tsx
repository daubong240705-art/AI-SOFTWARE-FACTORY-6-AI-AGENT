import { useId, useState } from 'react';
import { Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { i18n, useT } from '../../i18n';
import type { Store } from '../../state/store';
import { relativeTime } from '../Inbox';
import { ProjectTile } from '../shell/ProjectTile';
import { TaskStatus } from '../shell/TaskStatus';
import { taskTime } from '../shell/taskTime';

export function ActivityFeed({ store, onCreate, onTask }: {
  store: Store; onCreate: () => void; onTask: (projectId: string, taskId: string) => void;
}) {
  const t = useT(); const id = useId();
  const state = store.useStoreSelector(value => value);
  const [filter, setFilter] = useState('all');
  const activeFilter = filter === 'all' || state.projects.some(project => project.id === filter) ? filter : 'all';
  const rows = state.tasks.filter(task => activeFilter === 'all' || task.projectId === activeFilter)
    .map(task => ({ task, time: taskTime(task, state) }))
    .sort((a, b) => (b.time ? Date.parse(b.time) : 0) - (a.time ? Date.parse(a.time) : 0) || a.task.code.localeCompare(b.task.code));
  const date = new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'medium' });
  const dayKey = (value: Date) => `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;
  const now = new Date(); const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const groups = new Map<string, { label: string; rows: typeof rows }>();
  for (const row of rows) {
    const at = row.time ? new Date(row.time) : undefined;
    const key = at ? dayKey(at) : 'undated';
    const label = key === dayKey(now) ? t('overview.today') : key === dayKey(yesterday) ? t('overview.yesterday') : at ? date.format(at) : t('overview.undated');
    if (!groups.has(key)) groups.set(key, { label, rows: [] });
    groups.get(key)!.rows.push(row);
  }
  return <Card aria-labelledby={`${id}-title`} className="min-w-0 gap-0 overflow-hidden rounded-xl border-border py-0 shadow-none">
    <CardHeader className="px-5 py-4"><h2 id={`${id}-title`} className="font-display text-lg font-semibold">{t('overview.activity')}</h2></CardHeader>
    <div className="border-b border-border px-5 py-3">
      <ToggleGroup type="single" value={activeFilter} onValueChange={value => { if (value) setFilter(value); }} aria-label={t('overview.activityFilters')} spacing={2} className="w-full flex-wrap justify-start">
        {[{ id: 'all', name: t('overview.allProjects') }, ...state.projects].map(project => <ToggleGroupItem key={project.id} value={project.id} className="h-8 min-h-8 rounded-full border border-border bg-transparent px-3 text-sm font-normal text-muted-foreground data-[state=on]:bg-secondary data-[state=on]:text-foreground">{project.name}</ToggleGroupItem>)}
      </ToggleGroup>
    </div>
    <CardContent className="p-0">
      {!rows.length ? <Empty className="px-5 py-10"><EmptyHeader><EmptyMedia variant="icon"><Activity aria-hidden="true" /></EmptyMedia><EmptyDescription>{t('overview.activityEmpty')}</EmptyDescription></EmptyHeader>{!state.projects.length && <EmptyContent><Button onClick={onCreate}>{t('projects.create')}</Button></EmptyContent>}</Empty> : [...groups].map(([key, group]) => <section key={key} aria-label={group.label}>
        <h3 className="px-5 pt-3 pb-1 font-sans text-xs font-normal tracking-wide text-muted-foreground uppercase">{group.label}</h3>
        <ul className="m-0 list-none p-0">{group.rows.map(({ task, time }) => {
          const project = state.projects.find(item => item.id === task.projectId);
          return <li key={task.id}><Button variant="ghost" className="grid h-auto w-full grid-cols-[30px_minmax(0,1fr)_auto] items-start gap-3 rounded-none border-0 border-t border-border bg-transparent px-5 py-3 text-left font-normal whitespace-normal hover:bg-secondary" onClick={() => onTask(task.projectId, task.id)}>
            <ProjectTile id={task.projectId} name={project?.name ?? t('overview.project')} className="size-[30px] rounded-lg" />
            <span className="min-w-0"><span className="text-sm leading-relaxed [overflow-wrap:anywhere]"><span className="mr-2 font-mono text-xs font-medium">{task.code}</span>{task.title}</span><span className="mt-1 block"><TaskStatus task={task} state={state} /></span></span>
            {time && <time dateTime={time} className="pt-0.5 text-xs whitespace-nowrap text-muted-foreground">{relativeTime(time)}</time>}
          </Button></li>;
        })}</ul>
      </section>)}
    </CardContent>
  </Card>;
}
