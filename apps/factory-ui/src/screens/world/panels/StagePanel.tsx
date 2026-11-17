import { useEffect, useState } from 'react';
import type { Task } from '@factory/contracts';
import type { Store } from '@/state/store';
import type { WorkflowStage } from '@/api/client';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';

export function StagePanel({ store, projectId, instanceId, stageKey, onTask }: {
  store: Store; projectId: string; instanceId: string; stageKey: string; onTask: (projectId: string, taskId: string) => void;
}) {
  const t = useT(); const [stage, setStage] = useState<WorkflowStage | null>(); const [tasks, setTasks] = useState<Task[]>([]); const [error, setError] = useState(false); const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true; const controller = new AbortController();
    void Promise.all([store.getWorkflow(projectId, instanceId, controller.signal), store.listTasks(projectId, controller.signal)]).then(([value, allTasks]) => { if (active) { setTasks(allTasks.items); setStage(value.instance.stages.find(stage => stage.key === stageKey) ?? null); setError(false); } }, () => { if (active) setError(true); });
    return () => { active = false; controller.abort(); };
  }, [store, projectId, instanceId, stageKey, retry]);
  return <div className="space-y-3"><h2 className="font-semibold">{(['design', 'rules', 'art', 'client', 'qa'].includes(stageKey) ? t(`worldUi.workflow.stages.${stageKey}`) : stageKey)}</h2>{error ? <Button variant="outline" onClick={() => setRetry(value => value + 1)}>{t('errors.retry')}</Button> : stage === undefined ? <p role="status">{t('worldUi.loading')}</p> : stage === null ? <p>{t('worldUi.taskDetails.noTasks')}</p> : <><p>{t(`m5Ui.states.${stage.state}`)}</p>{stage.tasks.map(task => <Button key={task.taskId} className="w-full justify-start" variant="outline" onClick={() => onTask(projectId, task.taskId)}>{task.code} · {tasks.find(item => item.id === task.taskId)?.title} · {t(`taskUi.lifecycle.${task.state}`)}</Button>)}{!stage.tasks.length && <p>{t('worldUi.taskDetails.noTasks')}</p>}</>}</div>;
}
