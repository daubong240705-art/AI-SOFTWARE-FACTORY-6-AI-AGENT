import { deriveDisplayStatus, isLiveAttempt, type Task } from '@factory/contracts';
import { StatusDot } from '@/components/app';
import { toneOf } from '@/lib/status';
import { useT } from '../../i18n';
import type { StoreState } from '../../state/store';

export function TaskStatus({ task, state, dotOnly = false }: { task: Task; state: Pick<StoreState, 'liveAttempts'> & Partial<Pick<StoreState, 'inbox'>>; dotOnly?: boolean }) {
  const t = useT(); const attempt = state.liveAttempts[task.id];
  const display = deriveDisplayStatus({ ...task, liveAttempt: attempt && isLiveAttempt(attempt.state) ? attempt.state : null });
  const needsDecision = display.status === 'approval-required' || task.holds.some(hold => hold.needsAction);
  const pendingDecision = dotOnly && state.inbox?.approvals.some(item => item.taskId === task.id);
  const tone = pendingDecision ? toneOf('task', 'approval-required') : display.status === 'blocked' ? toneOf('task', display.status) : needsDecision ? 'need' : toneOf('task', display.status);
  return <StatusDot tone={tone} label={t(`taskUi.display.${pendingDecision ? 'approval-required' : display.status}`)} labelHidden={dotOnly} pulse />;
}
