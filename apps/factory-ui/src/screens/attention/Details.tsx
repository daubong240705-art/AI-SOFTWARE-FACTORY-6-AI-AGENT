import { Section } from '@/components/app';
import { Button } from '@/components/ui/button';
import { useT } from '../../i18n';
import { shallowSelectionEqual } from '../../state/storeSelector';
import type { Store } from '../../state/store';
import type { AttentionItem } from '../shell/attention';
import { TaskActions } from '../TaskDetail';
import { AttentionPane } from './AttentionPane';
export { IntegrationConflictPanel } from './IntegrationConflictPanel';

export function GatePanel({ store, row, taskId, onSuccess }: { store: Store; row: AttentionItem; taskId: string; onSuccess: () => void }) {
  const t = useT();
  const { task, projectName } = store.useStoreSelector(value => ({ task: value.tasks.find(item => item.id === taskId), projectName: value.projects.find(project => project.id === row.projectId)?.name }), shallowSelectionEqual);
  // TaskActions also serves task details; keep its confirmation and error above the buttons here.
  const actions = task ? <div className="contents [&>[role=group]]:order-first [&>[role=group]]:mt-0 [&>[role=group]]:basis-full [&>[role=group]]:rounded-lg [&>[role=group]]:border-0 [&>[role=group]]:bg-need/10 [&>[role=group]]:p-3 [&>[role=alert]]:order-first [&>[role=alert]]:basis-full">
    <TaskActions store={store} task={task} attempt={undefined} attention onSuccess={onSuccess} />
  </div> : undefined;
  return <AttentionPane kind={t('attention.kinds.start-gate')} projectId={row.projectId} projectName={row.projectName ?? projectName ?? t('overview.project')} code={task?.code ?? row.code} since={row.since} title={row.title} actions={actions}>
    {task ? <>
      <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{task.title}</p>
      <Section title={t('taskUi.goal')}><p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{task.goal}</p></Section>
      <Section title={t('taskUi.acceptance')}><ul className="list-disc space-y-1 pl-5">{task.acceptance.map((criterion, index) => <li key={index} className="whitespace-pre-wrap [overflow-wrap:anywhere]">{criterion}</li>)}</ul></Section>
    </> : <><p>{t('attention.taskUnavailable')}</p><Button type="button" variant="outline" onClick={() => { void store.loadTasks(); }}>{t('errors.retry')}</Button></>}
  </AttentionPane>;
}

export function ReadOnlyPanel({ store, row }: { store: Store; row: AttentionItem }) {
  const t = useT();
  const inbox = store.useStoreSelector(state => ({ breakers: state.globalInbox.teamBreakers, conflicts: state.globalInbox.integrationConflicts, monitors: state.globalInbox.monitors, projectName: state.projects.find(project => project.id === row.projectId)?.name }), shallowSelectionEqual);
  const breaker = inbox.breakers?.find(item => `breaker:${item.teamId}` === row.key);
  const conflict = inbox.conflicts?.find(item => `conflict:${item.taskId}` === row.key);
  const monitor = inbox.monitors?.find(item => `monitor:${item.monitorId}` === row.key);
  const description = row.kind === 'team-breaker' ? breaker?.reason : row.kind === 'integration-conflict' ? conflict?.branch : row.kind === 'monitor' && monitor?.value !== null ? `${monitor?.kind}: ${monitor?.value}` : row.title;
  return <AttentionPane kind={t(`attention.kinds.${row.kind}`)} projectId={row.projectId} projectName={row.projectName ?? inbox.projectName ?? t('overview.project')} code={row.code} since={row.since} title={row.title}>
    <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{description || row.title}</p>
    <Button variant="link" className="h-auto w-fit p-0" asChild><a href={`#/project/${encodeURIComponent(row.projectId)}`}>{t('attention.open')}</a></Button>
  </AttentionPane>;
}
