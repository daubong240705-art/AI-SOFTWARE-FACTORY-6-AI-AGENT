import { Users } from 'lucide-react';
import { MascotEmpty } from '@/components/mascot';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty';
import { LoadingState } from '@/components/LoadingState';
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
    {!activity && !errors.activity && <LoadingState />}
    {activity && <>
      <Machines nodes={activity.nodes} now={now} />
      {!teams.length ? <Empty className="border border-border py-12"><MascotEmpty seat="Lead" state={onlyMine ? 'success' : 'idle'} fallback={<EmptyHeader><EmptyMedia variant="icon"><Users aria-hidden="true" /></EmptyMedia><EmptyDescription>{t(onlyMine ? 'activityUi.noNeeds' : 'activityUi.noTeams')}</EmptyDescription></EmptyHeader>}><EmptyDescription>{t(onlyMine ? 'activityUi.noNeeds' : 'activityUi.noTeams')}</EmptyDescription></MascotEmpty></Empty>
        : <Stagger className="m-0 grid min-w-0 list-none items-start gap-5 p-0 xl:grid-cols-2">{teams.map((team, index) => <StaggerItem key={team.id} index={index} className="min-w-0"><ActivityTeamCard store={store} team={team} nodes={activity.nodes} onlyMine={onlyMine} now={now} onTask={onTask} /></StaggerItem>)}</Stagger>}
    </>}
  </div>;
}
