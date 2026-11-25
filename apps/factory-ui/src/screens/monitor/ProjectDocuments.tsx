import { useMemo } from 'react';
import type { Store } from '@/state/store';
import { ProjectKnowledge } from '../ProjectKnowledge';
import { artifactHash } from '../shell/navigation';

export function ProjectDocuments({ store, projectId }: { store: Store; projectId: string }) {
  const routedStore = useMemo(() => ({ ...store, openKnowledgeArtifact: async (artifactId: string) => {
    location.hash = artifactHash(projectId, { id: artifactId });
  } }), [store, projectId]);
  return <ProjectKnowledge store={routedStore} projectId={projectId} />;
}
