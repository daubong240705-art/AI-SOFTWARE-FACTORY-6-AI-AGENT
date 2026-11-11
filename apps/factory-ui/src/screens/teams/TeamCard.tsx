import { Stagger } from '@/components/motion/Stagger';
import { useEffect, useId } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { OrgTeam } from '../../api/m3Models';
import { useT } from '../../i18n';
import type { Store } from '../../state/store';
import { useM3Command } from '../M3Shared';
import { EngagementRow } from './EngagementRow';
import { SeatRow } from './SeatRow';
import { TeamActions } from './TeamActions';
import { TeamQueue } from './TeamQueue';

export function TeamCard({ store, team }: { store: Store; team: OrgTeam }) {
  const t = useT();
  const id = useId();
  const state = store.useStoreSelector((value) => value);
  const readOnly = state.m3.disabled;
  useEffect(() => {
    if (!readOnly) return store.watchM3(`queue:${team.id}`, () => store.loadQueue(team.id));
  }, [readOnly, store, team.id]);
  const command = useM3Command(store, async () => {
    await Promise.all([store.loadTeams(), store.loadQueue(team.id)]);
  });

  return (
    <Card className="min-w-0 gap-0 overflow-hidden border-border py-0 shadow-none" aria-labelledby={`${id}-name`}>
      <CardHeader className="gap-3 px-5 py-5">
        <div className="space-y-2">
          <h2 id={`${id}-name`} className="font-display text-lg font-semibold [overflow-wrap:anywhere]">{team.name}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{t(`m3.values.${team.lifecycle}`)}</Badge>
            {team.packKey && <Badge variant="outline" className="font-mono text-xs">{team.packKey} {team.packVersion}</Badge>}
          </div>
        </div>
        <CardDescription className="line-clamp-2 whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]">
          {team.charter}
        </CardDescription>
        {!readOnly && <TeamActions team={team} projectId={state.selectedProjectId} command={command} />}
      </CardHeader>
      <Separator />
      <CardContent className="space-y-6 px-5 py-5">
        <section className="space-y-3" aria-labelledby={`${id}-seats`}>
          <h3 id={`${id}-seats`} className="font-display text-base font-semibold">{t('team.seats')}</h3>
          {team.seats.length ? (
            <Stagger className="m-0 list-none divide-y divide-border p-0">
              {team.seats.map((seat, index) => (
                <SeatRow index={index} key={`${seat.id}:${seat.revision}`} seat={seat} projectId={state.selectedProjectId} readOnly={readOnly} command={command} />
              ))}
            </Stagger>
          ) : <p className="text-sm text-muted-foreground">{t('team.emptySeats')}</p>}
        </section>
        <Separator />
        <section className="space-y-3" aria-labelledby={`${id}-engagements`}>
          <h3 id={`${id}-engagements`} className="font-display text-base font-semibold">{t('ux4.engagements')}</h3>
          {team.engagements.length ? (
            <ul className="m-0 list-none divide-y divide-border p-0">
              {team.engagements.map((engagement) => (
                <EngagementRow key={`${engagement.engagementId}:${engagement.revision}`} engagement={engagement} readOnly={readOnly} command={command} />
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">{t('m3.empty')}</p>}
        </section>
        {!readOnly && command.notice}
        <Separator />
        <TeamQueue store={store} teamId={team.id} readOnly={readOnly} />
      </CardContent>
    </Card>
  );
}
