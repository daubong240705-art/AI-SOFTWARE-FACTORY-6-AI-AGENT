import { lazy, Suspense, useEffect, useId, useState } from 'react';
import { Download, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorNotice } from '@/components/ErrorNotice';
import { i18n, useT } from '../i18n';
import type { Store } from '../state/store';
import { relativeTime } from './Inbox';
import { KnowledgeKindIcon, KnowledgeStatus, KnowledgeText, KnowledgeTitle } from './KnowledgePresentation';
import { documentSize, documentType } from './documents/presentation';
import { UploadDialog } from './documents/UploadDialog';
import { ShareDocument } from './documents/ShareDocument';
import { StaleReasons } from './documents/StaleReasons';
import { ExtractionChip, ExtractionTechnicalDetails } from './documents/ExtractionStatus';
import { useExtraction } from './documents/useExtraction';
const DocumentPreview = lazy(() => import('./documents/preview/DocumentPreview').then(module => ({ default: module.DocumentPreview })));

export function KnowledgeArtifact({ store, artifactId, initialVersion = null, onClose }: { store: Store; artifactId: string; initialVersion?: number | null; onClose: () => void }) {
  const t = useT(); const state = store.useStoreSelector(value => value); const id = useId(); const [versionNumber, setVersionNumber] = useState<number | null>(initialVersion); const [upload, setUpload] = useState(false);
  useEffect(() => { void store.openKnowledgeArtifact(artifactId); return () => store.closeKnowledgeArtifact(artifactId); }, [store, artifactId]);
  const artifact = state.knowledge.detail[artifactId]; const area = `knowledge-detail:${artifactId}`; const latest = artifact?.versions[0]; const selected = artifact?.versions.find(value => value.version === versionNumber) ?? latest; const number = (value: number) => new Intl.NumberFormat(i18n.locale).format(value);
  const { extraction, error: extractionError, reload } = useExtraction({ store, projectId: state.selectedProjectId ?? '', artifactId, version: selected?.version ?? 1 }, selected?.extraction ?? null, selected?.extraction?.status !== 'pending' && selected?.extraction?.status !== 'running');
  if (state.session !== 'authenticated') return null;
  return <Sheet open onOpenChange={open => { if (!open) onClose(); }}><SheetContent side="right" showCloseButton={false} aria-labelledby={`${id}-title`} aria-describedby={undefined} className="w-full gap-0 overflow-y-auto border-border bg-card sm:max-w-2xl">
    <SheetHeader className="sticky top-0 z-10 flex-row items-start justify-between gap-4 border-b border-border bg-card p-5"><div className="min-w-0 space-y-3"><SheetTitle id={`${id}-title`} className="font-display text-2xl leading-tight [overflow-wrap:anywhere]"><KnowledgeTitle title={artifact?.title ?? t('knowledgeUi.detail')} /></SheetTitle>{artifact && <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary"><KnowledgeKindIcon kind={artifact.kind} />{t(`knowledgeUi.kinds.${artifact.kind}`)}</Badge>{selected && <KnowledgeStatus status={selected.status} />}</div>}{artifact && selected && <ShareDocument key={`${artifactId}:${selected.version}`} store={store} projectId={state.selectedProjectId ?? ''} artifactId={artifactId} title={artifact.title} version={selected} />}<ExtractionTechnicalDetails extraction={extraction} /></div><Button variant="ghost" size="icon" onClick={onClose} aria-label={t('knowledgeUi.close')}><X className="size-4" /></Button></SheetHeader>
    <div className="mx-auto w-full max-w-2xl space-y-6 p-5">
      {artifact && selected && <StaleReasons key={`${artifactId}:${selected.version}`} store={store} projectId={state.selectedProjectId ?? ''} artifact={artifact} version={selected} />}
      {state.knowledge.loading[area] && <div role="status" aria-label={t('viewStates.loading')} className="space-y-3"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-32" /></div>}
      {state.knowledge.errors[area] && <div className="space-y-3"><ErrorNotice error={state.knowledge.errors[area]} /><Button variant="outline" onClick={() => { void store.openKnowledgeArtifact(artifactId); }}>{t('errors.retry')}</Button></div>}
      {artifact && selected && <>
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{t(`knowledgeUi.types.${documentType(selected.mediaType)}`)}</Badge><span className="text-xs text-muted-foreground">{documentSize(selected.sizeBytes)}</span><ExtractionChip store={store} projectId={state.selectedProjectId ?? ''} artifactId={artifactId} version={selected.version} summary={selected.extraction} /><time className="text-xs text-muted-foreground" dateTime={selected.createdAt}>{relativeTime(selected.createdAt)}</time></div><div className="flex gap-2"><Button variant="outline" size="sm" asChild><a href={store.rawDocumentUrl(state.selectedProjectId ?? '', artifactId, selected.version, { download: true })}><Download className="size-4" />{t('knowledgeUi.download')}</a></Button>{selected.origin === 'upload' && <Button size="sm" onClick={() => setUpload(true)}>{t('knowledgeUi.uploadNewVersion')}</Button>}</div></div>
        {artifact.versions.length > 1 && <div className="space-y-2"><label htmlFor={`${id}-version`} className="text-xs font-medium text-muted-foreground">{t('knowledgeUi.versions')}</label><select id={`${id}-version`} className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm" value={selected.version} onChange={event => setVersionNumber(Number(event.target.value))}>{artifact.versions.map(value => <option key={value.version} value={value.version}>{t('knowledgeUi.version')} {number(value.version)} · {value.origin === 'upload' ? t('knowledgeUi.upload') : t('knowledgeUi.agent')}</option>)}</select></div>}
        <Suspense fallback={<Skeleton role="status" aria-label={t('viewStates.loading')} className="h-64 w-full" />}><DocumentPreview key={`${state.selectedProjectId}:${artifactId}:${selected.version}`} store={store} projectId={state.selectedProjectId ?? ''} artifact={artifact} version={selected} extraction={extraction} extractionError={extractionError} onReloadExtraction={reload} /></Suspense>
        <Card className="gap-3 rounded-xl border-border p-5 shadow-none"><div className="flex flex-wrap items-center gap-2"><strong className="font-mono text-sm">{t('knowledgeUi.version')} {number(selected.version)}</strong><KnowledgeStatus status={selected.status} /></div><section className="space-y-2"><h3 className="text-xs font-medium text-muted-foreground">{t('knowledgeUi.l0')}</h3><KnowledgeText text={selected.abstractL0} /></section>{selected.abstractL1 && <section className="space-y-2"><h3 className="text-xs font-medium text-muted-foreground">{t('knowledgeUi.l1')}</h3><KnowledgeText text={selected.abstractL1} /></section>}{/^text\/(plain|markdown|x-diff)(?:;|$)/i.test(selected.mediaType) && <Button variant="outline" onClick={() => { void store.loadArtifactContent('', artifactId, selected.version); }}>{t('knowledgeUi.read')}</Button>}</Card>
      </>}
      {artifact && <section className="space-y-4 border-t border-border pt-5"><h3 className="font-display text-lg font-semibold">{t('knowledgeUi.provenance')}</h3>{(['inputs', 'dependants'] as const).map(relation => <div key={relation} className="space-y-2"><h4 className="text-sm font-medium">{t(`knowledgeUi.${relation}`)}</h4>{!artifact[relation].length && <p className="text-sm text-muted-foreground">{t('knowledgeUi.noRefs')}</p>}<ul className="space-y-2 text-sm text-muted-foreground">{artifact[relation].map(ref => <li key={`${ref.artifactId}:${ref.version}`} className="[overflow-wrap:anywhere]"><KnowledgeTitle title={ref.title} /> · <span className="font-mono">{t('knowledgeUi.version')} {number(ref.version)}</span></li>)}</ul></div>)}</section>}
    </div>
    {upload && artifact && selected && <UploadDialog store={store} target={{ artifactId, kind: artifact.kind, title: artifact.title }} onClose={() => setUpload(false)} onUploaded={() => { setUpload(false); void store.openKnowledgeArtifact(artifactId); }} />}
  </SheetContent></Sheet>;
}
