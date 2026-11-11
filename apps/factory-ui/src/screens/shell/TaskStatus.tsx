import { deriveDisplayStatus, isLiveAttempt, type Task } from '@factory/contracts';
import { cn } from '@/lib/utils';
import { useT } from '../../i18n';
import type { StoreState } from '../../state/store';

export function TaskStatus({ task, state, dotOnly = false }: { task: Task; state: StoreState; dotOnly?: boolean }) {
  const t = useT(); const attempt = state.liveAttempts[task.id];
  const display = deriveDisplayStatus({ ...task, liveAttempt: attempt && isLiveAttempt(attempt.state) ? attempt.state : null });
  const needsDecision = display.status === 'approval-required' || task.holds.some(hold => hold.needsAction);
  const color = needsDecision ? 'bg-need' : display.status === 'running' ? 'bg-run' : display.status === 'completed' ? 'bg-ok' : display.status === 'blocked' ? 'bg-info' : 'bg-muted-foreground';
  return <span className={cn('inline-flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground', needsDecision && 'text-need')} aria-label={dotOnly ? t(`taskUi.display.${display.status}`) : undefined}>
    <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', color, display.status === 'running' && 'animate-[pulse_2s_ease-out_infinite] motion-reduce:animate-none')} />
    {!dotOnly && t(`taskUi.display.${display.status}`)}
  </span>;
}
