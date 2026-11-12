import { useEffect, useId, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import type { NotificationItem as Notification } from '@/api/notificationModels';
import { ErrorNotice } from '@/components/ErrorNotice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import type { Store } from '@/state/store';
import { attentionHash } from '../Attention';
import { NotificationItem } from './NotificationItem';
import { attentionItems } from './attention';
import { MascotEmpty } from '@/components/mascot';

export function NotificationsBell({ store, projectId, onTask }: { store: Store; projectId: string; onTask: (projectId: string, taskId: string) => void }) {
  const t = useT(); const id = useId(); const state = store.useStoreSelector(s => s);
  const [open, setOpen] = useState(false); const [filter, setFilter] = useState('unread');
  useEffect(() => { void store.loadNotifications(); }, [store, projectId]);
  const items = state.notifications.items.filter(item => filter === 'all' || item.state === 'unread').sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const urgent = state.notifications.items.some(item => item.state === 'unread' && item.urgency === 'urgent');
  const progress = state.notificationProgress;
  function navigate(item: Notification) {
    if (!item.entityId) return;
    if (item.entityKind === 'task') { setOpen(false); onTask(projectId, item.entityId); }
    else if (item.entityKind === 'approval') {
      const row = attentionItems(store.getState().globalInbox).find(row => row.projectId === projectId && row.key === `approval:${item.entityId}`);
      if (row) { setOpen(false); location.hash = attentionHash(row.key); }
    } else if (item.entityKind === 'workflow') { setOpen(false); location.hash = `#/project/${encodeURIComponent(projectId)}/workflow`; }
  }
  return <Popover open={open} onOpenChange={value => { setOpen(value); if (value) void store.loadNotifications(); }}>
    <PopoverTrigger asChild><Button variant="ghost" size="icon" className="relative shrink-0" aria-label={t('notificationsUi.title')}><Bell className="size-4" />{state.notifications.unread > 0 && <Badge className={cn('pointer-events-none absolute -top-1 -right-1 h-4 min-w-4 justify-center rounded-full border-0 px-1 text-[10px]', urgent ? 'bg-need text-need-foreground' : 'bg-primary text-primary-foreground')}>{state.notifications.unread > 99 ? '99+' : state.notifications.unread}</Badge>}</Button></PopoverTrigger>
    <PopoverContent align="end" sideOffset={10} aria-labelledby={id} className="w-[380px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border-border bg-popover p-0">
      <header className="space-y-3 p-4"><h2 id={id} className="font-display text-lg font-semibold">{t('notificationsUi.title')}</h2><ToggleGroup type="single" value={filter} onValueChange={value => { if (value) setFilter(value); }} variant="outline" size="sm" aria-label={t('notificationsUi.filter')}><ToggleGroupItem value="unread">{t('notificationsUi.unread')}</ToggleGroupItem><ToggleGroupItem value="all">{t('notificationsUi.all')}</ToggleGroupItem></ToggleGroup></header>
      {state.errors.notifications && <div className="space-y-2 px-4 pb-4"><ErrorNotice error={state.errors.notifications} /><Button variant="outline" size="sm" onClick={() => { void store.loadNotifications(); }}>{t('errors.retry')}</Button></div>}
      {state.loading.notifications && !state.notifications.items.length ? <div role="status" aria-label={t('viewStates.loading')} className="space-y-2 p-4"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-10 w-full" /></div> : <ScrollArea className="max-h-[min(420px,55dvh)] [&_[data-slot=scroll-area-viewport]]:max-h-[min(420px,55dvh)]">
        {items.length ? <ul className="m-0 list-none p-0">{items.map(item => <NotificationItem key={item.id} store={store} item={item} projectId={projectId} onOpen={navigate} />)}</ul> : !state.errors.notifications && <Empty className="py-10"><MascotEmpty seat="Lead" state="success" compact fallback={<EmptyHeader><EmptyMedia variant="icon"><CheckCheck /></EmptyMedia><EmptyDescription>{t('notificationsUi.empty')}</EmptyDescription></EmptyHeader>}><EmptyDescription>{t('notificationsUi.empty')}</EmptyDescription></MascotEmpty></Empty>}
      </ScrollArea>}
      <footer className="space-y-2 border-t border-border p-3">{progress && <div role="status" className="space-y-2 text-xs text-muted-foreground"><span>{t('notificationsUi.progress').replace('{done}', String(progress.done)).replace('{total}', String(progress.total))}</span><Progress value={progress.done / progress.total * 100} aria-label={t('notificationsUi.markAll')} /></div>}<Button variant="ghost" size="sm" className="w-full text-xs" disabled={!state.notifications.unread || !!progress || state.notifications.items.some(item => state.loading[`notifications:${item.id}`])} onClick={() => { void store.markAllNotificationsRead(); }}><CheckCheck />{t('notificationsUi.markAll')}</Button></footer>
    </PopoverContent>
  </Popover>;
}
