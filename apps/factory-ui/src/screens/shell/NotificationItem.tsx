import { useRef } from 'react';
import { Check, X } from 'lucide-react';
import { notificationsDismiss, notificationsMarkRead } from '@/api/commands';
import type { NotificationItem as Notification } from '@/api/notificationModels';
import { ErrorNotice } from '@/components/ErrorNotice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { notificationPendingKey, type NotificationCommand } from '@/state/notifications';
import type { Store } from '@/state/store';
import { relativeTime } from '../Inbox';

export function NotificationItem({ store, item, projectId, onOpen }: { store: Store; item: Notification; projectId: string; onOpen: (item: Notification) => void }) {
  const t = useT(); const key = notificationPendingKey(item.id);
  const { busy, error } = store.useStoreSelector(s => ({ busy: s.loading[key] || !!s.notificationProgress, error: s.errors[key] }));
  const previous = useRef<NotificationCommand | null>(null);
  async function act(dismiss: boolean, navigate = false) {
    if (busy || store.getState().selectedProjectId !== projectId) return;
    if (!dismiss && item.state !== 'unread') { if (navigate) onOpen(item); return; }
    const type = dismiss ? 'notifications.dismiss' : 'notifications.mark-read';
    const command = previous.current?.type === type && store.getState().pending[previous.current.commandId]?.status === 'failed'
      ? previous.current : (dismiss ? notificationsDismiss : notificationsMarkRead)({ projectId, notificationId: item.id });
    previous.current = command;
    const result = await store.sendNotification(command);
    if (result && store.getState().selectedProjectId === projectId && navigate) onOpen(item);
  }
  return <li className="space-y-2 border-t border-border p-4">
    <Button variant="ghost" disabled={Boolean(busy)} className="h-auto w-full items-start justify-start gap-2 rounded-lg border-transparent bg-transparent p-0 text-left whitespace-normal hover:bg-transparent" onClick={() => { void act(false, true); }}>
      <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', item.urgency === 'urgent' && item.state === 'unread' ? 'bg-need' : 'bg-muted-foreground')} aria-label={t(`notificationsUi.urgency.${item.urgency}`)} />
      <span className="min-w-0 flex-1 space-y-1"><span className={cn('block text-sm leading-relaxed', item.state === 'unread' ? 'font-semibold' : 'font-medium')}>{item.title}</span><span className="line-clamp-2 text-xs leading-relaxed font-normal text-muted-foreground">{item.body}</span></span>
    </Button>
    <div className="flex items-center gap-2 pl-3.5"><Badge variant="secondary" className="text-[10px] font-normal">{t(`notificationsUi.category.${item.category}`)}</Badge><time dateTime={item.createdAt} className="text-xs text-muted-foreground">{relativeTime(item.createdAt)}</time><div className="ml-auto flex gap-1">
      {item.state === 'unread' && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="size-7" disabled={Boolean(busy)} aria-label={t('notificationsUi.markRead')} onClick={() => { void act(false); }}><Check className="size-3.5" /></Button></TooltipTrigger><TooltipContent>{t('notificationsUi.markRead')}</TooltipContent></Tooltip>}
      {item.state !== 'dismissed' && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="size-7" disabled={Boolean(busy)} aria-label={t('notificationsUi.dismiss')} onClick={() => { void act(true); }}><X className="size-3.5" /></Button></TooltipTrigger><TooltipContent>{t('notificationsUi.dismiss')}</TooltipContent></Tooltip>}
    </div></div>{error && <ErrorNotice error={error} />}
  </li>;
}
