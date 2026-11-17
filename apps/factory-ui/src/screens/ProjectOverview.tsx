import { useEffect } from 'react';
import { Section } from '@/components/app';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { i18n, useT } from '../i18n';
import type { Store } from '../state/store';
import { relativeTime } from '@/lib/inbox';
import type { SettingsSection } from './shell/navigation';
import { Requests } from './Requests';
import { TaskStatus } from './shell/TaskStatus';
import { taskTime } from './shell/taskTime';
import { Page } from '../components/Page';
import { IntegrationCard } from './overview/IntegrationCard';
import { StudioGameOverview } from './studio/StudioGameOverview';

export function ProjectOverview({ store, onOpenTask, onOpenSettings }: { store: Store; onOpenTask: (id: string) => void; onOpenSettings?: (section: SettingsSection) => void }) {
  const t = useT(); const state = store.useStoreSelector(value => value);
  useEffect(() => store.watchM5('workflows', store.loadWorkflows), [store, state.selectedProjectId]);
  const gameWorkflow = state.m5.workflows.filter(workflow => workflow.key === 'game-build').sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const project = state.projects.find(item => item.id === state.selectedProjectId);
  const counts = [
    ['running', state.tasks.filter(task => task.state === 'active').length],
    ['review', state.tasks.filter(task => task.state === 'in-review').length],
    ['waiting', state.tasks.filter(task => task.state === 'awaiting-go').length],
    ['done', state.tasks.filter(task => task.state === 'done').length],
  ] as const;
  const approvals = new Set(state.inbox.approvals.map(item => item.taskId));
  const tasks = state.tasks.filter(task => ['active', 'awaiting-go', 'in-review'].includes(task.state) || task.holds.some(hold => hold.needsAction) || approvals.has(task.id));
  if (gameWorkflow && project) return <StudioGameOverview key={project.id} store={store} projectId={project.id} gameName={project.name} workflow={gameWorkflow} />;
  return <Page className="space-y-6">
    <Section title={t('projectUi.summaryTitle')}>
      <p className="text-sm tabular-nums text-muted-foreground">{counts.map(([key, value], index) => <span key={key}>{index > 0 && ' · '}<span className={cn(key === 'waiting' && value > 0 && 'text-need')}>{t(`projectUi.summary.${key}`).replace('{count}', new Intl.NumberFormat(i18n.locale).format(value))}</span></span>)}</p>
      {!state.loading.budget && state.budget?.day && <p className="flex flex-wrap items-baseline gap-1 text-sm text-muted-foreground"><span className="tabular-nums">{t('projectUi.tokensToday').replace('{count}', new Intl.NumberFormat(i18n.locale).format(state.budget.day.used))}</span><span>·</span><Button type="button" variant="link" className="h-auto p-0 text-muted-foreground" onClick={() => onOpenSettings?.('budget')}>{t('projectUi.budgetSettings')}</Button></p>}
    </Section>
    <Section title={t('projectUi.activeTasks')}>
      {!tasks.length ? <p className="text-sm text-muted-foreground">{t('projectUi.noActiveTasks')}</p> : <ul className="m-0 list-none p-0">{tasks.map(task => { const time = taskTime(task, state); return <li key={task.id}><Button type="button" variant="ghost" className="flex h-auto w-full flex-wrap justify-start gap-3 px-2 py-3 text-left font-normal whitespace-normal hover:bg-secondary" onClick={() => onOpenTask(task.id)}><TaskStatus task={task} state={state} /><span className="font-mono text-xs">{task.code}</span><strong className="min-w-0 flex-1 text-sm font-medium [overflow-wrap:anywhere]">{task.title}</strong>{time && <time dateTime={time} className="text-xs text-muted-foreground">{relativeTime(time)}</time>}</Button></li>; })}</ul>}
    </Section>
    <Requests store={store} hideEmpty />
    <IntegrationCard store={store} />
  </Page>;
}
