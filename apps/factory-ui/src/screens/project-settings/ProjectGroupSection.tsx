import { useState } from 'react';
import { FolderSymlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Store } from '@/state/store';
import { viewHash } from '../shell/navigation';
import { MoveProjectDialog } from '../groups/GroupDialogs';
import { useGroupLabels, useGroups } from '../groups/GroupsContext';
import { ReadFeedback } from '../library/shared';

export function ProjectGroupSection({ store, projectId }: { store: Store; projectId: string }) {
  const t = useGroupLabels();
  const { list, refresh } = useGroups();
  const project = store.useStoreSelector(state => state.projects.find(value => value.id === projectId));
  const [moving, setMoving] = useState(false);
  if (!project) return null;
  const groupId = list.data ? list.data.membership[projectId] ?? null : project.groupId;
  const path = list.data?.groups.find(item => item.id === groupId)?.path;
  return <section className="space-y-3 rounded-xl border border-border p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 space-y-1">
      <h2 className="font-display text-lg">{t('projectGroup')}</h2>
      <p className="break-all text-sm text-muted-foreground">{groupId ? <a className="underline" href={viewHash(`group:${groupId}`)}>{path ?? t('openCurrent')}</a> : t('noGroup')}</p>
    </div><Button data-testid="project-group-move" type="button" variant="outline" onClick={() => setMoving(true)}><FolderSymlink aria-hidden="true" />{t('move')}</Button></div>
    <ReadFeedback error={list.error} loading={list.loading && !list.data} retry={refresh} />
    {moving && <MoveProjectDialog store={store} projectId={projectId} name={project.name} currentGroup={groupId} close={() => setMoving(false)} />}
  </section>;
}
