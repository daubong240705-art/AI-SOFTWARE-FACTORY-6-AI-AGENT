import type { AttemptState, TaskState } from '@factory/contracts';

export type StatusTone = 'need' | 'run' | 'ok' | 'error' | 'idle';
export type StatusKind = 'task' | 'attempt' | 'automation' | 'activity';

export const toneDot: Record<StatusTone, string> = {
  need: 'bg-need', run: 'bg-run', ok: 'bg-ok', error: 'bg-need', idle: 'bg-muted-foreground',
};
export const toneText: Record<StatusTone, string> = {
  need: 'text-need', run: 'text-muted-foreground', ok: 'text-muted-foreground', error: 'text-need', idle: 'text-muted-foreground',
};

// Keep wire enum members explicit; satisfies makes contract additions a type error.
const task = {
  draft: 'idle', proposed: 'idle', accepted: 'idle', ready: 'idle', 'awaiting-go': 'need',
  active: 'run', 'in-review': 'need', done: 'ok', failed: 'error', cancelled: 'idle', declined: 'idle', superseded: 'idle',
  'approval-required': 'need', 'awaiting-approval': 'need', waiting: 'need', question: 'need',
  running: 'run', 'in-progress': 'run', completed: 'ok', blocked: 'error', stalled: 'error',
  rejected: 'error', 'cancelled-with-error': 'error', unknown: 'error', closed: 'idle',
} satisfies Record<TaskState, StatusTone> & Record<string, StatusTone>;
const attempt = {
  queued: 'idle', leased: 'run', preparing: 'run', running: 'run', 'waiting-input': 'need',
  parked: 'idle', stopping: 'run', stopped: 'idle', submitting: 'run', succeeded: 'ok', failed: 'error',
  'lease-expired': 'error', unknown: 'error', reconciling: 'error', requeued: 'idle',
  starting: 'run', 'in-progress': 'run', 'cancelled-with-error': 'error',
} satisfies Record<AttemptState, StatusTone> & Record<string, StatusTone>;
const automation = {
  active: 'run', enabled: 'ok', paused: 'idle', disabled: 'idle', quarantined: 'error', unknown: 'error',
  ok: 'ok', tripped: 'error', open: 'error', 'half-open': 'error', closed: 'idle',
  pending: 'idle', ready: 'idle', running: 'run', completed: 'ok', done: 'ok', failed: 'error', blocked: 'error',
} as const;
const activity = {
  waiting: 'need', problem: 'error', working: 'run', queued: 'idle', done: 'ok', idle: 'idle',
} as const;
const tones: Record<StatusKind, Readonly<Record<string, StatusTone>>> = { task, attempt, automation, activity };

export function toneOf(kind: StatusKind, state: string): StatusTone {
  const table = tones[kind];
  return Object.hasOwn(table, state) ? table[state]! : 'idle';
}
