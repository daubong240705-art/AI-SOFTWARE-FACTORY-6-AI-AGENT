import { lazy, Suspense, useCallback, useReducer, useState } from 'react';
import { ApiClientError, createApiClient } from '@/api/client';
import { LoadingState } from '@/components/LoadingState';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { KnowledgeArtifact } from '../KnowledgeArtifact';
import { useRead } from '../agents/shared';
import { useExtraction } from '../documents/useExtraction';
import { artifactHash, traceHash, viewHash } from '../shell/navigation';
import { baseUrl } from './live';
import { formatNumber, useTraceLabels } from './presentation';
const DocumentPreview = lazy(() => import('../documents/preview/DocumentPreview').then(module => ({ default: module.DocumentPreview })));

export default function ArtifactDetail({ store, projectId, target }: { store: Store; projectId: string; target: { id: string; version?: number | undefined } }) {
  const t = useT();
  const label = useTraceLabels();
  const [api] = useState(() => createApiClient({ baseUrl }));
  const [open, setOpen] = useState(false);
  const [epoch, refresh] = useReducer((value: number) => value + 1, 0);
  const readArtifact = useCallback((signal: AbortSignal) => api.getKnowledgeArtifact(projectId, target.id, signal), [api, projectId, target.id]);
  const artifact = useRead(readArtifact, epoch);
  const versions = artifact.data?.artifact.versions ?? [];
  const current = target.version === undefined ? versions[0] : versions.find(version => version.version === target.version);
  const readTrace = useCallback((signal: AbortSignal) => api.getArtifactTrace(projectId, target.id, current?.version, signal), [api, projectId, target.id, current?.version]);
  const trace = useRead(current ? readTrace : null, epoch);
  const { extraction, error: extractionError, reload } = useExtraction({ store, projectId, artifactId: target.id, version: current?.version ?? 1 }, current?.extraction ?? null, current?.extraction?.status !== 'pending' && current?.extraction?.status !== 'running');
  const missingTrace = trace.error instanceof ApiClientError && trace.error.code === 'not-found';
  const hasError = !!artifact.error || !!trace.error && !missingTrace;
  return <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
    <Button asChild variant="outline"><a data-testid="trace-back-documents" href={viewHash(`project:${projectId}`, 'knowledge')}>{t('projectUi.knowledge')}</a></Button>
    {(artifact.loading || trace.loading) && <LoadingState inline />}
    {hasError && <div className="flex items-center gap-2" role="alert"><p className="text-sm text-destructive">{label(artifact.error ? 'readError' : 'artifactTraceError')}</p><Button variant="outline" data-testid="trace-retry-artifact" onClick={refresh}>{label('refresh')}</Button></div>}
    {artifact.data && <section className="space-y-3 rounded-xl border bg-card p-4 [overflow-wrap:anywhere]">
      <h2 className="font-display text-2xl">{artifact.data.artifact.title}</h2>
      {current && <p className="whitespace-pre-wrap">{current.abstractL0}</p>}
      {!!versions.length && <label className="flex flex-wrap items-center gap-2">{t('knowledgeUi.version')}<select className="rounded-md border bg-background px-3 py-1.5" data-testid="trace-artifact-version" value={current?.version ?? ''} onChange={event => { location.hash = artifactHash(projectId, { id: target.id, version: Number(event.target.value) }); }}>
        {!current && <option disabled value="">{label('unknown')}</option>}{versions.map(version => <option key={version.version} value={version.version}>{formatNumber(version.version)}</option>)}
      </select></label>}
      <div className="flex flex-wrap gap-2">
        {current && <>
          <Button variant="outline" data-testid="trace-artifact-preview" onClick={() => setOpen(true)}>{label('documentDetails')}</Button>
          <Button asChild variant="outline"><a data-testid="trace-artifact-download" href={store.rawDocumentUrl(projectId, target.id, current.version, { download: true })}>{t('knowledgeUi.download')}</a></Button>
        </>}
        {trace.data && <Button asChild variant="outline"><a href={traceHash(projectId, trace.data.traceId)} data-testid="trace-why-artifact">{label('whyArtifact')}</a></Button>}
      </div>
      {missingTrace && <p className="text-sm text-muted-foreground">{label('noArtifactTrace')}</p>}
      {current && <Suspense fallback={<LoadingState inline />}><DocumentPreview key={current.version} store={store} projectId={projectId} artifact={artifact.data.artifact} version={current} extraction={extraction} extractionError={extractionError} onReloadExtraction={reload} /></Suspense>}
    </section>}
    {open && current && <KnowledgeArtifact store={store} artifactId={target.id} initialVersion={current.version} onClose={() => { setOpen(false); refresh(); }} />}
  </div>;
}
