export type MascotState = 'idle' | 'thinking' | 'working' | 'done' | 'typing' | 'attention' | 'error' | 'success' | 'offline';
export function mascotState(value: unknown): MascotState { const state = String(value ?? '').toLowerCase(); if (['running', 'working', 'in-progress', 'in_progress'].includes(state)) return 'working'; if (['waiting-input', 'waiting_input', 'waiting', 'needs-approval', 'needs-answer', 'approval', 'approval-required'].includes(state)) return 'attention'; if (['in-review', 'in_review', 'review'].includes(state)) return 'thinking'; if (['failed', 'error', 'problem'].includes(state)) return 'error'; if (['done', 'accepted', 'succeeded', 'success', 'completed'].includes(state)) return 'success'; if (['paused', 'offline', 'disconnected'].includes(state)) return 'offline'; return 'idle'; }
import type { Task } from '@factory/contracts';
import type { StoreState } from '@/state/store';
export function taskMascotState(task: Task, state: StoreState): MascotState {
  if (task.holds.some(hold => hold.needsAction) || state.inbox.approvals.some(approval => approval.taskId === task.id)) return 'attention';
  return mascotState(state.liveAttempts[task.id]?.state ?? state.details[task.id]?.attempts[0]?.state ?? task.state);
}
