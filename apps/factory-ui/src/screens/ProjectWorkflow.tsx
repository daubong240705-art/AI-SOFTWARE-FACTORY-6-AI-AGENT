import { useEffect, useId, useState } from 'react';
import { useT } from '../i18n';
import { relativeTime } from './Inbox';
import { M5ReadState, M5Status } from './M5Shared';
import type { Store } from '../state/store';

export function ProjectWorkflow({ store, projectId, onOpenTask }: { store: Store; projectId: string; onOpenTask?: (taskId: string) => void }) {
  const t = useT(); const state = store.useStoreSelector(s => s); const id = useId();
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => store.watchM5('workflows', store.loadWorkflows), [store, projectId]);
  const selectedItem = state.m5.workflows.find(item => item.id === selected);
  const detail = selectedItem ? state.m5.workflowDetails[selectedItem.id] : undefined;
  return <div className="m5-screen">
    <header className="m5-toolbar"><h2>{t('workflowUi.title')}</h2><button type="button" disabled={state.loading.workflows} onClick={() => void store.loadWorkflows()}>{t('m5Ui.refresh')}</button></header>
    <div className={`workflow-layout${selectedItem ? ' has-selection' : ''}`}>
      <section className="m5-list" aria-label={t('workflowUi.list')}>
        <M5ReadState store={store} area="workflows" retry={store.loadWorkflows} empty={!state.m5.workflows.length} emptyKey="workflowUi.empty" />
        <ul>{state.m5.workflows.map(item => {
          const info = state.m5.workflowDetails[item.id];
          const current = info?.stages.filter(stage => stage.state === 'active');
          const loops = info?.stages.filter(stage => stage.loopCount !== undefined);
          const at = info?.lastProgressAt ?? item.createdAt;
          return <li key={item.id}><button type="button" className="m5-row" aria-current={selected === item.id} aria-controls={`${id}-detail`} onClick={() => {
            setSelected(item.id); if (!info) void store.loadWorkflow(item.id);
          }}>
            <strong>{item.title}</strong><M5Status value={item.state} />
            {!!current?.length && <span>{t('workflowUi.currentStage')}: {current.map(stage => stage.key).join(', ')}</span>}
            {!!loops?.length && <span>{t('workflowUi.loop')}: {Math.max(...loops.map(stage => stage.loopCount ?? 0))}</span>}
            <time dateTime={at}>{relativeTime(at)}</time>
          </button></li>;
        })}</ul>
      </section>
      {selectedItem && <section className="m5-detail" id={`${id}-detail`} aria-label={t('workflowUi.detail')}>
        <header className="m5-toolbar"><h2>{selectedItem.title}</h2><button type="button" onClick={() => setSelected(null)}>{t('m5Ui.close')}</button></header>
        <M5ReadState store={store} area={`workflow:${selectedItem.id}`} retry={() => store.loadWorkflow(selectedItem.id)} />
        {detail && <>
          <ol className="workflow-stages" aria-label={t('workflowUi.stages')}>{detail.stages.map(stage => <li key={stage.key}>
            <strong>{stage.key}</strong><M5Status value={stage.state} />
            {stage.loopCount !== undefined && <span>{t('workflowUi.loop')}: {stage.loopCount}</span>}
            {stage.iteration !== undefined && stage.iteration > 1 && <span>{t('workflowUi.iteration')}: {stage.iteration}</span>}
            {stage.tasks.length > 0 && <div className="m5-task-links">{stage.tasks.map(task => onOpenTask
              ? <button type="button" key={task.taskId} className="m5-task-code" onClick={() => onOpenTask(task.taskId)}>{task.code}</button>
              : <span key={task.taskId} className="m5-task-code">{task.code}</span>)}</div>}
            {stage.blockedReason && <details><summary>{t('m5Ui.technicalDetails')}</summary><p>{stage.blockedReason}</p></details>}
          </li>)}</ol>
          {!detail.stages.length && <p className="m5-empty">{t('workflowUi.noStages')}</p>}
          <details><summary>{t('m5Ui.technicalDetails')}</summary><dl><dt>{t('m5Ui.identifier')}</dt><dd>{detail.id}</dd><dt>{t('workflowUi.definition')}</dt><dd>{detail.key}</dd></dl></details>
        </>}
      </section>}
    </div>
  </div>;
}
