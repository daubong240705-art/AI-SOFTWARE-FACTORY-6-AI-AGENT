import { useState } from 'react';
import { FileText, NotebookText, FileCode, FileImage, ExternalLink } from 'lucide-react';
import type { TaskArtifact } from '../../api/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useT } from '../../i18n';
import type { Store } from '../../state/store';
import { MarkdownContent } from '@/components/MarkdownContent';
import { CsvTable } from '@/components/CsvTable';
import { readableText } from './presentation';

type Version = TaskArtifact['versions'][number];
// Raster images the Host serves inline from the knowledge raw route; SVG is never rendered inline.
const IMAGE = /^image\/(png|jpeg|gif|webp)(?:;|$)/i;
const TEXT = /^(text\/(plain|markdown|csv)|application\/json)(?:;|$)/i;

export function ReviewDocuments({ store, taskId, documents, attemptId }: { store: Store; taskId: string; documents: TaskArtifact[]; attemptId: string | undefined }) {
  const t = useT();
  const current = documents.flatMap(document => {
    const version = [...document.versions].sort((a, b) => b.version - a.version).find(item => item.producedByAttemptId === attemptId);
    return document.kind !== 'code-ref' && version ? [{ document, version }] : [];
  });
  const images = current.filter(({ version }) => IMAGE.test(version.mediaType));
  const others = current.filter(({ version }) => !IMAGE.test(version.mediaType));
  return <Card className="gap-3 border-border p-4 shadow-none"><h3 className="text-sm font-semibold">{t('reviewUi.documents')}</h3>
    {images.length > 0 && <ImageGallery store={store} images={images} />}
    {others.length > 0 && <ItemGroup className="divide-y divide-border">{others.map(({ document, version }) => <DocumentRow key={document.artifactId} store={store} taskId={taskId} document={document} version={version} />)}</ItemGroup>}
    {!current.length && <p className="text-sm text-muted-foreground">{t('reviewUi.noDocuments')}</p>}
  </Card>;
}

function ImageGallery({ store, images }: { store: Store; images: { document: TaskArtifact; version: Version }[] }) {
  const t = useT(); const projectId = store.useStoreSelector(value => value.selectedProjectId);
  const [open, setOpen] = useState<number | null>(null);
  if (!projectId) return null;
  const url = (item: { document: TaskArtifact; version: Version }) => store.rawDocumentUrl(projectId, item.document.artifactId, item.version.version);
  const selected = open === null ? undefined : images[open];
  return <section aria-label={t('reviewUi.images')} className="space-y-2">
    <h4 className="text-xs font-medium text-muted-foreground">{t('reviewUi.images')} ({images.length})</h4>
    <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3">
      {images.map((item, index) => <li key={item.document.artifactId} className="min-w-0">
        <button type="button" onClick={() => setOpen(index)} className="group block w-full overflow-hidden rounded-lg border border-border bg-muted/20 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" aria-label={`${t('reviewUi.openImage')}: ${readableText(item.document.title)}`}>
          <img src={url(item)} alt={readableText(item.document.title)} loading="lazy" className="aspect-[4/3] w-full object-contain transition-transform group-hover:scale-[1.02]" />
          <span className="block truncate px-2 py-1.5 text-xs text-muted-foreground">{readableText(item.document.title)}</span>
        </button>
      </li>)}
    </ul>
    <Dialog open={selected !== undefined} onOpenChange={value => { if (!value) setOpen(null); }}>
      {selected && <DialogContent className="max-h-[95dvh] overflow-auto rounded-xl border-border bg-card sm:max-w-[min(1400px,95vw)]">
        <DialogHeader><DialogTitle className="text-base">{readableText(selected.document.title)}</DialogTitle>
          <DialogDescription>{readableText(selected.version.abstractL1 || selected.version.abstractL0)}</DialogDescription></DialogHeader>
        <img src={url(selected)} alt={readableText(selected.document.title)} className="mx-auto max-h-[78dvh] max-w-full object-contain" />
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="outline" size="sm" disabled={open === 0} onClick={() => setOpen(value => value === null ? null : Math.max(0, value - 1))}>{t('reviewUi.previousImage')}</Button>
          <Button variant="outline" size="sm" asChild><a href={url(selected)} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-3.5" />{t('reviewUi.openInTab')}</a></Button>
          <Button variant="outline" size="sm" disabled={open === images.length - 1} onClick={() => setOpen(value => value === null ? null : Math.min(images.length - 1, value + 1))}>{t('reviewUi.nextImage')}</Button>
        </div>
      </DialogContent>}
    </Dialog>
  </section>;
}

function DocumentRow({ store, taskId, document, version }: { store: Store; taskId: string; document: TaskArtifact; version: Version }) {
  const t = useT(); const state = store.useStoreSelector(value => value); const [open, setOpen] = useState(false);
  const key = `${document.artifactId}:${version.version}`; const content = state.artifactContents[key]; const error = state.errors[`content:${key}`];
  const text = TEXT.test(version.mediaType);
  const pdf = /^application\/pdf(?:;|$)/i.test(version.mediaType);
  const Icon = document.kind === 'design-asset' || document.kind === 'media' ? FileImage : document.kind === 'api-contract' ? FileCode : document.kind === 'plan' ? NotebookText : FileText;
  // Generated record titles describe storage; the document kind describes the handoff.
  const title = /^(summary|changes|result|output|artifact|review)\b/i.test(document.title) ? t('reviewUi.summary') : readableText(document.title);
  function load() { if (text) void store.loadArtifactContent(taskId, document.artifactId, version.version); }
  const body = () => {
    if (!content) return null;
    if (/^text\/markdown(?:;|$)/i.test(version.mediaType)) return <div className="max-h-80 overflow-auto rounded-lg border border-border bg-background p-4"><MarkdownContent content={content.text} /></div>;
    if (/^text\/csv(?:;|$)/i.test(version.mediaType)) return <CsvTable text={content.text} truncatedLabel={t('reviewUi.csvTruncated')} />;
    return <pre className="max-h-80 overflow-auto rounded-lg border border-border bg-background p-4 font-sans text-sm leading-relaxed whitespace-pre-wrap break-words">{readableText(content.text)}</pre>;
  };
  return <Collapsible open={open} onOpenChange={value => { setOpen(value); if (value) load(); }}>
    <Item size="sm" className="gap-3 rounded-none px-0">
      <ItemMedia className="text-muted-foreground"><Icon className="size-4" /></ItemMedia>
      <ItemContent className="min-w-0"><ItemTitle className="break-words">{title}</ItemTitle><ItemDescription className="text-xs">{t(`knowledgeUi.kinds.${document.kind}`)}</ItemDescription></ItemContent>
      <ItemActions>
        {pdf && state.selectedProjectId && <Button variant="ghost" size="sm" asChild><a href={store.rawDocumentUrl(state.selectedProjectId, document.artifactId, version.version)} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-3.5" />{t('reviewUi.openInTab')}</a></Button>}
        <CollapsibleTrigger asChild><Button variant="outline" size="sm">{t(open ? 'reviewUi.hide' : 'reviewUi.view')}</Button></CollapsibleTrigger>
      </ItemActions>
    </Item>
    <CollapsibleContent className="pb-3">
      {state.loading[`content:${key}`] && <div role="status"><span className="sr-only">{t('viewStates.loading')}</span><Skeleton className="h-24 w-full" /></div>}
      {error && <Alert className="border-border"><AlertDescription><p>{t(`safeErrors.${error.code}`)}</p><Button variant="outline" size="sm" onClick={load}>{t('errors.retry')}</Button></AlertDescription></Alert>}
      {body()}
      {!text && <p className="text-sm text-muted-foreground">{readableText(version.abstractL1 || version.abstractL0) || t('reviewUi.contentUnavailable')}</p>}
    </CollapsibleContent>
  </Collapsible>;
}
