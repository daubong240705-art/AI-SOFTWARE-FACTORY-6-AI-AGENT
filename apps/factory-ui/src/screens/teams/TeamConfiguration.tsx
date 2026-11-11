import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '../../components/Select';
import { teamsCreateFromPack } from '../../api/commands';
import { useT } from '../../i18n';
import type { Store } from '../../state/store';
import { AreaState, useM3Command } from '../M3Shared';
import { TeamPanel } from '../TeamPanel';
import { TeamCard } from './TeamCard';

export function TeamConfiguration({ store }: { store: Store }) {
  const t = useT();
  const id = useId();
  const state = store.useStoreSelector((value) => value);
  const [pack, setPack] = useState('');
  const command = useM3Command(store, store.loadTeams);
  const projectId = state.selectedProjectId;
  const selected = state.m3.packs.find((item) => `${item.key}@${item.version}` === pack);

  return (
    <div className="min-w-0 space-y-6">
      {state.m3.disabled ? (
        <>
          <p role="status" className="text-sm text-muted-foreground">{t('m3.disabled')}</p>
          <TeamPanel store={store} />
        </>
      ) : (
        <>
          <Card className="gap-4 border-border py-5 shadow-none">
            <CardHeader className="px-5">
              <h2 className="font-display text-lg font-semibold">{t('ux4.createFromPack')}</h2>
            </CardHeader>
            <CardContent className="space-y-3 px-5">
              {!projectId && <p className="text-sm text-muted-foreground">{t('m3.selectProject')}</p>}
              <form
                className="flex flex-col gap-3 sm:flex-row sm:items-end"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!selected || !projectId || command.busy) return;
                  void command.run(teamsCreateFromPack({
                    projectId, teamId: crypto.randomUUID(),
                    packKey: selected.key, packVersion: selected.version,
                  }));
                }}
              >
                <div className="min-w-0 flex-1 space-y-2">
                  <Label htmlFor={`${id}-pack`}>{t('m3.pack')}</Label>
                  <Select
                    id={`${id}-pack`}
                    value={pack}
                    onValueChange={setPack}
                    options={[
                      { value: '', label: t('m3.choose') },
                      ...state.m3.packs.map((item) => ({ value: `${item.key}@${item.version}`, label: `${item.name} ${item.version}` })),
                    ]}
                  />
                </div>
                <Button type="submit" disabled={!selected || !projectId || command.busy}>
                  {t('m3.createTeam')}
                </Button>
              </form>
              {command.notice}
            </CardContent>
          </Card>
          <AreaState store={store} area="teams" empty={!state.m3.teams.length} />
        </>
      )}
      <div className="grid min-w-0 gap-5">
        {state.m3.teams.map((team) => <TeamCard key={team.id} store={store} team={team} />)}
      </div>
    </div>
  );
}
