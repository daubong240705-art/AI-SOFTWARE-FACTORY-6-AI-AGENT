import { Section } from '@/components/app';
import { useCallback, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoadingState } from '@/components/LoadingState';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { ProjectTile } from '../shell/ProjectTile';
import { gameStatus } from '../studio/presentation';
import { useStudioRead } from '../studio/useStudioRead';

export function ProjectGrid({ store, onProject, children }: { store: Store; onProject: (id: string) => void; children?: ReactNode }) {
  const t = useT(); const projects = store.useStoreSelector(state => state.projects);
  const read = useCallback((signal: AbortSignal) => store.listGames(signal), [store]);
  const { data, error, reload } = useStudioRead(read, 15_000);
  return <Section title={t('gameSummary.games')}>
    {error && <div role="alert" className="flex flex-wrap items-center gap-3"><p>{t('studioUi.loadError')}</p><Button variant="outline" onClick={reload}>{t('errors.retry')}</Button></div>}
    {!data && !error && <LoadingState inline />}
    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {children}
      {data?.games.map(game => {
        const project = projects.find(item => item.id === game.projectId);
        if (!project) return null;
        const released = game.release?.state === 'done' ? game.release : null;
        const status = gameStatus(game.workflow?.state, game.workflow?.currentStage, t);
        return <div key={project.id} className="relative min-w-0 rounded-xl border border-border bg-card p-4 hover:bg-secondary/50">
          <button type="button" className="absolute inset-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" onClick={() => onProject(project.id)} aria-label={`${t('studioUi.open')}: ${project.name}`} />
          <div className="pointer-events-none flex min-w-0 items-start gap-3">
            <ProjectTile id={project.id} name={project.name} className="size-10 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-2">
              <h3 className="text-base font-medium [overflow-wrap:anywhere]">{project.name}</h3>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={status.className}>{status.label}</Badge>
                {released?.version != null && released.playUrl && /^https?:\/\//i.test(released.playUrl) && <a href={released.playUrl} target="_blank" rel="noopener noreferrer" aria-label={`${t('gameUi.openGame')} v${released.version}`} className="pointer-events-auto relative rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">v{released.version}</a>}
              </div>
            </div>
          </div>
        </div>;
      })}
    </div>
  </Section>;
}
