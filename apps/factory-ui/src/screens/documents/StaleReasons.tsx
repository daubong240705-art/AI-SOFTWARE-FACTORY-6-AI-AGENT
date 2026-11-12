import { useState } from 'react';
import { artifactsClearStale } from '@/api/commands';
import type { KnowledgeArtifact } from '@/api/readModels';
import { CommandFormFrame } from '@/components/CommandFormFrame';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { knowledgePendingKey } from '@/state/knowledgeCommands';
import type { Store } from '@/state/store';
import { artifactTitle } from '../artifactPresentation';
import { relativeTime } from '../Inbox';

type Version = KnowledgeArtifact['versions'][number];
type Reason = Version['stale'][number];

export function StaleReasons({ store, projectId, artifact, version }: {
  store: Store; projectId: string; artifact: KnowledgeArtifact; version: Version;
}) {
  const t = useT(); const [reviewing, setReviewing] = useState<Reason | null>(null);
  const state = store.useStoreSelector(value => value);
  const pendingKey = knowledgePendingKey(artifact.artifactId, version.version);
  const reasonText = (reason: Reason) => {
    const known = [...state.knowledge.list, ...state.knowledge.results, ...Object.values(state.knowledge.detail), ...artifact.inputs]
      .find(item => item.artifactId === reason.becauseArtifactId);
    return t('knowledgeWrite.staleReason')
      .replace('{title}', known ? artifactTitle(known.title) : reason.becauseArtifactId.slice(0, 8))
      .replace('{version}', String(reason.becauseVersion)).replace('{time}', relativeTime(reason.since));
  };
  if (!version.isStale && !version.stale.length) return null;
  return <section aria-label={t('knowledgeWrite.stale')} className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
    <Badge variant="outline" className="gap-1.5 font-normal text-muted-foreground"><span aria-hidden="true" className="size-1.5 rounded-full bg-run" />{t('knowledgeWrite.stale')}</Badge>
    {version.stale.length ? <ul className="m-0 list-none divide-y divide-border p-0">{version.stale.map(reason => <li key={`${reason.becauseArtifactId}:${reason.becauseVersion}`} className="flex flex-wrap items-start justify-between gap-2 py-2 first:pt-0 last:pb-0">
      <p className="min-w-0 flex-1 basis-48 text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{reasonText(reason)}</p>
      <Button type="button" variant="ghost" size="sm" disabled={Boolean(state.loading[pendingKey])} aria-label={`${t('knowledgeWrite.markReviewed')}: ${reasonText(reason)}`} onClick={() => setReviewing(reason)}>{t('knowledgeWrite.markReviewed')}</Button>
    </li>)}</ul> : <p className="text-sm text-muted-foreground">{t('knowledgeWrite.hiddenReason')}</p>}
    {reviewing && <CommandFormFrame store={store} pendingKey={pendingKey} send={store.sendKnowledge}
      onClose={() => setReviewing(null)} title={t('knowledgeWrite.reviewTitle')} description={t('knowledgeWrite.reviewDescription')}
      submitLabel={t('knowledgeWrite.markReviewed')} invalidKey="knowledgeWrite.reviewInvalid"
      onSubmit={() => artifactsClearStale({ projectId, artifactId: artifact.artifactId, version: version.version,
        becauseArtifactId: reviewing.becauseArtifactId, becauseVersion: reviewing.becauseVersion })}>
      <p className="rounded-lg border border-border bg-muted/30 p-4 text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{reasonText(reviewing)}</p>
    </CommandFormFrame>}
  </section>;
}
