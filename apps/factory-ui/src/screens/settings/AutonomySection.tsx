import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { autonomyPendingKey } from '@/state/settingsCommands';
import { M5ReadState, TechnicalDetails } from '../M5Shared';
import { AutonomyDialog, type AutonomyTarget } from './AutonomyDialog';

export function AutonomySection({ state, store, projectId, id }: { state: ReturnType<Store['getState']>; store: Store; projectId: string; id: string }) {
  const t = useT(); const autonomy = state.settings.autonomy;
  const [target, setTarget] = useState<AutonomyTarget | null>(null);
  const teamName = (teamId: string) => state.m3.teams.find(team => team.id === teamId)?.name ?? (state.team?.team.id === teamId ? state.team.team.name : t('settingsUi.unknownTeam'));
  const edit = (item: AutonomyTarget) => <Button type="button" size="sm" variant="outline" aria-label={`${t('settingsWrite.changeLevel')}: ${item.name}`}
    disabled={Boolean(state.loading[autonomyPendingKey(item.subject, item.subjectRef)])} onClick={() => setTarget(item)}>{t('settingsWrite.changeLevel')}</Button>;
  return <Card className="gap-0 border-border py-0 shadow-none">
    <CardHeader className="border-b border-border px-5 py-4"><h3 id={id} className="font-display text-lg font-semibold">{t('settingsUi.autonomy')}</h3></CardHeader>
    <CardContent className="space-y-4 p-5"><M5ReadState store={store} area="autonomy" retry={store.loadAutonomy} empty={!autonomy} emptyKey="settingsUi.autonomyUnavailable" />
      {autonomy && <><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-muted-foreground">{t('settingsUi.project')}</p><p className="mt-1 font-display text-xl leading-snug">{t(`settingsUi.levels.${autonomy.project.level}`)}</p><div className="mt-2 flex flex-wrap items-center gap-2"><Badge variant="secondary">{t('ux5.levelNumber').replace('{level}', String(autonomy.project.level))}</Badge><span className="text-sm text-muted-foreground">{t(autonomy.project.source === 'explicit' ? 'ux5.explicitSource' : 'ux5.defaultSource')}</span></div></div>
        {edit({ subject: 'project', subjectRef: projectId, name: t('settingsUi.project'), ...autonomy.project })}</div>
        <ul>{autonomy.teams.map(team => <li key={team.teamId} className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3">
          <span className="font-medium">{teamName(team.teamId)}</span><div className="flex flex-wrap items-center gap-3"><span className="text-sm text-muted-foreground">{t(`settingsUi.levels.${team.level}`)} {typeof team.level === 'number' && <Badge variant="secondary">L{team.level}</Badge>}</span>{edit({ subject: 'team', subjectRef: team.teamId, name: teamName(team.teamId), ...team })}</div>
          {team.effectiveLevel !== team.level && <span className="w-full text-sm text-muted-foreground">{t('settingsUi.effective')}: {t(`settingsUi.levels.${team.effectiveLevel}`)}</span>}<TechnicalDetails identifier={team.teamId} />
        </li>)}</ul></>}
    </CardContent>
    {target && <AutonomyDialog target={target} store={store} projectId={projectId} onClose={() => setTarget(null)} />}
  </Card>;
}
