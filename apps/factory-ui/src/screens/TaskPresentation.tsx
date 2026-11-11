import type { Task } from '@factory/contracts';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useT } from '../i18n';
import type { StoreState } from '../state/store';
import { relativeTime } from './Inbox';
import { taskTime } from './shell/taskTime';

export function SeatChip({ name }: { name: string | undefined }) {
  const t = useT();
  if (!name) return <span className="text-xs text-muted-foreground">{t('taskUi.dash')}</span>;
  const initials = name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('');
  return <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" title={name}>
    <Avatar className="size-5 rounded-md"><AvatarFallback className="rounded-md bg-muted font-mono text-[9px]">{initials}</AvatarFallback></Avatar>
    <span className="max-w-24 truncate">{name}</span>
  </span>;
}

export function TaskTime({ task, state }: { task: Task; state: StoreState }) {
  const t = useT(); const time = taskTime(task, state);
  return time ? <time dateTime={time} className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">{relativeTime(time)}</time>
    : <span className="text-xs text-muted-foreground">{t('taskUi.dash')}</span>;
}

export function DecisionBadge() {
  const t = useT();
  return <Badge variant="outline" className="max-w-full border-need/30 bg-need/10 text-[11px] whitespace-normal text-need">{t('inboxUi.needsDecision')}</Badge>;
}
