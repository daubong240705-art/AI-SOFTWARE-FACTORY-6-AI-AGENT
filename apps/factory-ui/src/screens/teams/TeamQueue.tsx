import { useId } from 'react';
import { Badge } from '@/components/ui/badge';
import { useT } from '../../i18n';
import type { Store } from '../../state/store';
import { relativeTime } from '../Inbox';
import { AreaState } from '../M3Shared';

export function TeamQueue({ store, teamId, readOnly }: { store: Store; teamId: string; readOnly: boolean }) {
  const t = useT();
  const id = useId();
  const items = store.useStoreSelector((state) => state.m3.queues[teamId]);

  return (
    <section className="min-w-0 space-y-3" aria-labelledby={`${id}-queue`}>
      <h3 id={`${id}-queue`} className="font-display text-base font-semibold">{t('m3.queue')}</h3>
      {!readOnly && <AreaState store={store} area={`queue:${teamId}`} empty={items?.length === 0} />}
      {!!items?.length && (
        <ol className="m-0 list-none space-y-2 p-0">
          {items.map((item) => (
            <li key={item.taskId} className="min-w-0 space-y-2 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">{item.code}</span>
                <span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{item.title}</span>
                <Badge variant="secondary">{t(`taskUi.lifecycle.${item.state}`)}</Badge>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{item.projectName}</span>
                {item.seatName && <span>{item.seatName}</span>}
                <span>{t('team.priority')}: {item.engagementPriority}</span>
                {item.liveAttemptState && <span>{t(`workUi.states.${item.liveAttemptState}`)}</span>}
                {item.queuedAt && <time dateTime={item.queuedAt} title={item.queuedAt}>{relativeTime(item.queuedAt)}</time>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
