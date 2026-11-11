import { Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { Stagger, StaggerItem } from '@/components/motion/Stagger';
import { ErrorNotice } from '@/components/ErrorNotice';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { ActivityTeamCard } from './ActivityTeamCard';
import type { OpenActivityTask } from './AgentRow';
import { Machines } from './Machines';

export function TeamActivity({ store, onlyMine, now, onTask }: { store: Store; onlyMine: boolean; now: number; onTask: OpenActivityTask }) {
  const t = useT();
  const { activity, errors } = store.useStoreSelector(state => state);
  const teams = activity?.teams.filter(team => !onlyMine || team.seats.some(seat => seat.status === 'waiting')) ?? [];
  return <div className="min-w-0 space-y-6">
    {errors.activity && <div className="space-y-3"><ErrorNotice error={errors.activity} /><Button variant="outline" size="sm" onClick={() => { void store.loadActivity(); }}>{t('errors.retry')}</Button></div>}
    {!activity && !errors.activity && <div role="status" aria-label={t('viewStates.loading')} className="grid gap-5 xl:grid-cols-2">
      {[0, 1].map(index => <Card key={index} className="space-y-4 rounded-xl border-border p-5 shadow-none"><Skeleton className="h-5 w-2/5" />{[0, 1, 2].map(row => <div key={row} className="flex items-center gap-3"><Skeleton className="size-8 rounded-md" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-3 w-4/5" /></div></div>)}</Card>)}
    </div>}
    {activity && <>
      <Machines nodes={activity.nodes} now={now} />
      {!teams.length ? <Empty className="border border-border py-12"><EmptyHeader><EmptyMedia variant="icon"><Users aria-hidden="true" /></EmptyMedia><EmptyDescription>{t(onlyMine ? 'activityUi.noNeeds' : 'activityUi.noTeams')}</EmptyDescription></EmptyHeader></Empty>
        : <Stagger className="m-0 grid min-w-0 list-none items-start gap-5 p-0 xl:grid-cols-2">{teams.map((team, index) => <StaggerItem key={team.id} index={index} className="min-w-0"><ActivityTeamCard team={team} nodes={activity.nodes} onlyMine={onlyMine} now={now} onTask={onTask} /></StaggerItem>)}</Stagger>}
    </>}
  </div>;
}
