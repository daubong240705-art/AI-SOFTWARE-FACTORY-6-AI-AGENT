import { useRef, useState } from 'react';
import { TASK_TRANSITIONS, type Command, type Task, type TaskState } from '@factory/contracts';
import { tasksTransition } from '../api/commands';
import type { Store } from '../state/store';
import { shallowSelectionEqual } from '../state/storeSelector';

const supported: readonly TaskState[] = ['accepted', 'declined', 'cancelled'];

export function useTaskTransition(store: Store, projectId: string | null, task: Task | undefined) {
  const state = store.useStoreSelector(value => ({ pending: value.pending, session: value.session }), shallowSelectionEqual);
  const [confirm, setConfirm] = useState<'declined' | 'cancelled' | null>(null);
  const [command, setCommand] = useState<Command | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const pending = command ? state.pending[command.commandId] : undefined;
  const allowed = task ? TASK_TRANSITIONS[task.state] : [];
  const targets = allowed.filter(target => supported.includes(target));
  // The list's existing Propose command remains available for draft tasks.
  const canPropose = allowed.includes('proposed');
  const disabled = busy || !!command || state.session !== 'authenticated';

  async function execute(created: Command, retry = false) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setConfirm(null);
    try {
      const result = await (retry ? store.retry(created.commandId) : store.send(created));
      if (result && store.getState().session === 'authenticated') { await store.loadTasks(); setCommand(null); }
      else if (store.getState().pending[created.commandId]?.error?.code === 'conflict') await store.loadTasks();
    } finally { inFlight.current = false; setBusy(false); }
  }
  function run(to: TaskState) {
    if (disabled || inFlight.current || !projectId || !task || !(targets.includes(to) || (to === 'proposed' && canPropose))) return;
    const created = tasksTransition({ projectId, taskId: task.id, expectedRevision: task.revision, to });
    setCommand(created); void execute(created);
  }
  function retry() { if (command) void execute(command, true); }

  return { targets, canPropose, run, confirm, setConfirm, pending, error: pending?.error, busy, disabled, retry, retryDisabled: busy || state.session !== 'authenticated' };
}
