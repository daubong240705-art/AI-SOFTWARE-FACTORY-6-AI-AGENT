import { useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { readableText } from './presentation';

export function isReferenceImage(mediaType: string): boolean {
  return ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mediaType);
}

export function TaskInputs({ store, taskId }: { store: Store; taskId: string }) {
  const t = useT();
  const state = store.useStoreSelector(value => value);
  const task = state.tasks.find(item => item.id === taskId);
  const hasInputs = !!task?.inputs.length;
  useEffect(() => {
    if (!hasInputs || state.session !== 'authenticated') return;
    store.openKnowledgeList();
    void store.loadKnowledgeList();
    return () => store.closeKnowledgeList();
  }, [store, taskId, hasInputs, state.session]);
  if (!task || !hasInputs) return null;

  return <Card className="gap-3 border-border p-5 shadow-none">
    <h3 className="text-sm font-semibold">{t('taskInputs.title')}</h3>
    <ul className="space-y-4">
      {task.inputs.map(ref => {
        const document = state.knowledge.list.find(item => item.artifactId === ref.artifactId);
        const title = document ? readableText(document.title) : ref.artifactId;
        const url = store.rawDocumentUrl(task.projectId, ref.artifactId, ref.version);
        return <li key={`${ref.artifactId}:${ref.version}`} className="space-y-2 text-sm [overflow-wrap:anywhere]">
          <p className="font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{t('workUi.version')} {ref.version}</p>
          {document?.abstractL0 && <p className="whitespace-pre-wrap text-muted-foreground">{readableText(document.abstractL0)}</p>}
          {document && isReferenceImage(document.mediaType) && <a href={url} target="_blank" rel="noopener noreferrer" className="block w-fit max-w-full rounded focus-visible:outline-2 focus-visible:outline-ring" aria-label={`${t('reviewUi.openInTab')}: ${title}`}>
            <img src={url} alt={title} loading="lazy" className="max-h-40 max-w-full rounded object-contain" />
          </a>}
        </li>;
      })}
    </ul>
  </Card>;
}
