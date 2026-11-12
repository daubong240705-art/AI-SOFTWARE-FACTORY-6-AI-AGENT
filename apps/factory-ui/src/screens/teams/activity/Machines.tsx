import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import type { ActivityNode } from '@/api/activityModels';

export function Machines({ nodes, now }: { nodes: ActivityNode[]; now: number }) {
  const t = useT();
  if (!nodes.length) return null;
  return <Card aria-label={t('activityUi.machines')} className="gap-0 rounded-xl border-border py-0 shadow-none">
    <ul className="m-0 list-none divide-y divide-border p-0">
      {nodes.map(node => <li key={node.id} className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 text-sm">
        <span className="flex min-w-0 items-center gap-2 font-medium">
          <span aria-label={t(node.state === 'online' ? 'shell.live' : node.state === 'offline' ? 'shell.offline' : 'm5Ui.states.unknown')} className={cn('size-2 shrink-0 rounded-full', node.state === 'online' ? 'bg-ok' : 'bg-info')} />
          <span className="truncate">{node.name}</span>
        </span>
        <span className="text-muted-foreground">{node.platform === 'unknown' ? t('m5Ui.states.unknown') : node.platform}</span>
        <span className="text-muted-foreground tabular-nums">{t('activityUi.slots').replace('{used}', String(node.slots.used)).replace('{total}', String(node.slots.total))}</span>
        <span className="text-xs text-muted-foreground">{node.lastHeartbeatAt ? t('activityUi.heartbeat').replace('{count}', String(Math.max(0, Math.floor((now - Date.parse(node.lastHeartbeatAt)) / 1000)))) : t('activityUi.noHeartbeat')}</span>
      </li>)}
    </ul>
  </Card>;
}
