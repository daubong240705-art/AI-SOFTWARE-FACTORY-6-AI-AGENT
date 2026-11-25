import { Section } from '@/components/app';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { ProjectTile } from '../shell/ProjectTile';

export function ProjectGrid({ store, onProject }: { store: Store; onProject: (id: string) => void }) {
  const t = useT();
  const projects = store.useStoreSelector(state => state.projects);
  return <Section title={t('global.projects')}>
    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {projects.filter(project => project.disposition !== 'archived').map(project => <Button key={project.id} variant="outline" className="h-auto min-w-0 justify-start gap-3 p-4" onClick={() => onProject(project.id)}>
        <ProjectTile id={project.id} name={project.name} className="size-10 rounded-lg" />
        <span className="truncate">{project.name}</span>
      </Button>)}
    </div>
  </Section>;
}
