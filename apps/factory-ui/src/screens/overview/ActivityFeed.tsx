import { Stagger, StaggerItem } from '@/components/motion/Stagger';
import { useState } from 'react';
import { Activity } from 'lucide-react';
import { MascotEmpty } from '@/components/mascot';
import { Button } from '@/components/ui/button';
import { Section } from '@/components/app';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { i18n, useT } from '../../i18n';
import type { Store } from '../../state/store';
import { relativeTime } from '@/lib/inbox';
import { ProjectTile } from '../shell/ProjectTile';
import { TaskStatus } from '../shell/TaskStatus';
import { taskTime } from '../shell/taskTime';

export function ActivityFeed({ store, onTask }: {
  store: Store; onTask: (projectId: string, taskId: string) => void;
}) {
  const t = useT();
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
  return <Section title={t('overview.activity')} className="min-w-0">
    {state.projects.length > 1 && <div>
      <ToggleGroup type="single" value={activeFilter} onValueChange={value => { if (value) setFilter(value); }} aria-label={t('overview.activityFilters')} spacing={2} className="w-full flex-wrap justify-start">
        {[{ id: 'all', name: t('overview.allProjects') }, ...state.projects].map(project => <ToggleGroupItem key={project.id} value={project.id} className="h-8 min-h-8 rounded-full border border-border bg-transparent px-3 text-sm font-normal text-muted-foreground data-[state=on]:bg-secondary data-[state=on]:text-foreground">{project.name}</ToggleGroupItem>)}
      </ToggleGroup>
    </div>}
    <div>
      {!rows.length ? <Empty className="px-5 py-10"><MascotEmpty seat="PM" compact fallback={<EmptyHeader><EmptyMedia variant="icon"><Activity aria-hidden="true" /></EmptyMedia><EmptyDescription>{t('overview.activityEmpty')}</EmptyDescription></EmptyHeader>}><EmptyDescription>{t('overview.activityEmpty')}</EmptyDescription></MascotEmpty></Empty> : [...groups].map(([key, group]) => <section key={key} aria-label={group.label}>
        <h3 className="px-2 pt-3 pb-1 font-sans text-xs font-normal tracking-wide text-muted-foreground uppercase">{group.label}</h3>
        <Stagger className="m-0 list-none p-0">{group.rows.map(({ task, time }) => {
          const project = state.projects.find(item => item.id === task.projectId);
          return <StaggerItem key={task.id} index={rows.findIndex(row => row.task.id === task.id)}><Button variant="ghost" className="flex h-auto w-full flex-wrap justify-start gap-3 px-2 py-3 text-left font-normal whitespace-normal hover:bg-secondary" onClick={() => onTask(task.projectId, task.id)}>
            <TaskStatus task={task} state={state} />
            <span className="shrink-0 font-mono text-xs">{task.code}</span>
            <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">{task.title}</span>
            <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><ProjectTile id={task.projectId} name={project?.name ?? t('overview.project')} className="size-6 rounded-md" /><span className="max-w-40 truncate">{project?.name ?? t('overview.project')}</span></span>
            {time && <time dateTime={time} className="shrink-0 text-xs text-muted-foreground">{relativeTime(time)}</time>}
          </Button></StaggerItem>;
        })}</Stagger>
      </section>)}
    </div>
  </Section>;
}
