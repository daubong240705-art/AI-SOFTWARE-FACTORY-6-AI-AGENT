import { Section, StatusDot } from '@/components/app';
import { useCallback } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { useT } from '@/i18n';
import { toneOf } from '@/lib/status';
import type { Store } from '@/state/store';
import { ProjectTile } from '../shell/ProjectTile';
import { stageName } from '../studio/presentation';
import { useStudioRead } from '../studio/useStudioRead';

export function ProjectGrid({ store, onProject }: { store: Store; onProject: (id: string) => void }) {
  const t = useT(); const projects = store.useStoreSelector(state => state.projects);
  const read = useCallback((signal: AbortSignal) => store.listGames(signal), [store]);
  const { data, error, reload } = useStudioRead(read, 15_000);
  if (!projects.length) return null;
  return <Section title={t('shellUi.projects')}>
    {error && <div role="alert" className="flex flex-wrap items-center gap-3"><p>{t('studioUi.loadError')}</p><Button variant="outline" onClick={reload}>{t('errors.retry')}</Button></div>}
    {!data && !error && <p role="status">{t('viewStates.loading')}</p>}
    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {projects.map(project => {
        const game = data?.games.find(item => item.projectId === project.id);
        const released = game?.release?.state === 'done' ? game.release : null;
        return <div key={project.id} className="group relative min-w-0 rounded-lg p-3 hover:bg-secondary/50">
          <button type="button" className="absolute inset-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" onClick={() => onProject(project.id)} aria-label={`${t('studioUi.open')}: ${project.name}`} />
          <div className="pointer-events-none flex min-w-0 items-start gap-3">
            <ProjectTile id={project.id} name={project.name} className="size-10 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-1">
              <h3 className="text-base font-medium [overflow-wrap:anywhere]">{project.name}</h3>
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
                {game ? <><span>{t('studioUi.build')}:</span><StatusDot tone={toneOf('workflow', game.workflow?.state ?? 'draft')} label={game.workflow ? t(`studioUi.states.${game.workflow.state}`) : t('studioUi.noBuild')} />{game.workflow?.currentStage && <span>· {stageName(game.workflow.currentStage, t)}</span>}</> : <StatusDot tone="idle" label={t(`overview.projectStates.${project.disposition}`)} />}
                {released && <><span>·</span>{released.playUrl && /^https?:\/\//i.test(released.playUrl) ? <a href={released.playUrl} target="_blank" rel="noopener noreferrer" className="pointer-events-auto relative rounded-sm underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('studioUi.liveVersion')}: {released.version === null ? t('gameUi.unassignedVersion') : t('gameUi.version').replace('{version}', String(released.version))}</a> : <span>{t('studioUi.liveVersion')}: {released.version === null ? t('gameUi.unassignedVersion') : t('gameUi.version').replace('{version}', String(released.version))}</span>}</>}
              </div>
            </div>
            <span className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'group-hover:bg-accent' })}>{t('studioUi.open')}</span>
          </div>
        </div>;
      })}
    </div>
  </Section>;
}
