import type { Task } from '@factory/contracts';
import type { StoreState } from '../../state/store';

// Tasks have no createdAt/updatedAt in the current contract. Use only observed times.
export function taskTime(task: Task, state: StoreState): string | undefined {
  const live = state.liveAttempts[task.id];
  const attempts = state.details[task.id]?.attempts ?? [];
  const approvals = [...state.inbox.approvals, ...state.globalInbox.approvals]
    .filter(item => item.taskId === task.id && item.projectId === task.projectId);
  return [
    ...task.holds.map(hold => hold.since), live?.endedAt, live?.startedAt,
    ...attempts.flatMap(attempt => [attempt.endedAt, attempt.startedAt]),
    ...approvals.map(item => item.requestedAt),
  ].filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}
