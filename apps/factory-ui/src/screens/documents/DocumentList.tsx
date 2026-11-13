import type { KnowledgeItem, KnowledgeResult } from '@/api/readModels';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { KnowledgeTitle } from '../KnowledgePresentation';
import { readableText } from '../artifactPresentation';
import { relativeTime } from '../Inbox';
import { DocumentIcon, documentSize, documentType } from './presentation';
import type { Store } from '@/state/store';
import { ExtractionChip, ExtractionRetry } from './ExtractionStatus';

type Row = KnowledgeItem | KnowledgeResult;

/** Colour of the small status dot; the label is always given as text for screen readers and tooltips. */
export function statusTone(status: string): string {
  return status === 'approved' || status === 'reviewed' ? 'bg-ok' : status === 'in-review' ? 'bg-info' : status === 'rejected' || status === 'withdrawn' ? 'bg-destructive' : 'bg-muted-foreground/50';
}

function TaskCode({ row }: { row: Row }) {
  return row.task ? <Badge variant="outline" title={row.task.title} className="shrink-0 font-mono text-[11px] font-normal text-muted-foreground">{row.task.code}</Badge> : null;
}

function ImageTiles({ store, rows, onSelect, showTask }: { store: Store; rows: Row[]; onSelect: (id: string) => void; showTask: boolean }) {
  const t = useT();
  return <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3 p-0">{rows.map(row => <li key={row.artifactId}>
    <button type="button" onClick={() => onSelect(row.artifactId)} className="group block w-full overflow-hidden rounded-lg border border-border bg-card p-0 text-left transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      <span className="relative block aspect-[4/3] overflow-hidden bg-muted">{showTask && row.task && <span title={row.task.title} className="absolute top-1.5 left-1.5 rounded bg-background/85 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{row.task.code}</span>}<img src={store.rawDocumentUrl(row.projectId, row.artifactId, row.version)} alt="" loading="lazy" decoding="async" className="size-full object-cover transition-transform group-hover:scale-[1.03]" /></span>
      <span className="flex items-center gap-1.5 px-2.5 py-2"><span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', statusTone(row.status))} /><span className="min-w-0 flex-1 truncate text-xs font-medium" title={row.title}><KnowledgeTitle title={row.title} /></span></span>
      <span className="sr-only">{t(`knowledgeUi.statuses.${row.status}`)}</span>
    </button>
  </li>)}</ul>;
}

function DocumentRows({ store, rows, onSelect, showTask, detailed }: { store: Store; rows: Row[]; onSelect: (id: string) => void; showTask: boolean; detailed: boolean }) {
  const t = useT();
  return <Card className="gap-0 overflow-hidden rounded-xl border-border py-0 shadow-none"><ul className="m-0 list-none divide-y divide-border p-0">{rows.map(row => {
    const description = readableText('snippet' in row && row.snippet.trim() ? row.snippet : row.abstractL0);
    const extracting = row.extraction && row.extraction.status !== 'done';
    return <li key={row.artifactId} className="flex items-center gap-2 pr-3 hover:bg-secondary">
      <button type="button" onClick={() => onSelect(row.artifactId)} title={detailed ? undefined : description || undefined} className="flex min-w-0 flex-1 items-start gap-3 rounded-none border-0 bg-transparent px-4 py-2.5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        <span className="mt-0.5 text-muted-foreground"><DocumentIcon mediaType={row.mediaType} /></span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', statusTone(row.status))} />
            <span className="min-w-0 truncate text-sm font-medium"><KnowledgeTitle title={row.title} /></span>
            <span className="sr-only">{t(`knowledgeUi.statuses.${row.status}`)}</span>
            {showTask && <TaskCode row={row} />}
            {row.origin === 'upload' && row.kind !== 'plan' && <Badge variant="secondary" className="shrink-0 text-[11px] font-normal text-muted-foreground">{t('knowledgeUi.uploadedBadge')}</Badge>}
          </span>
          {detailed && description && <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">{description}</span>}
        </span>
        <span className="hidden shrink-0 items-center gap-3 pt-0.5 text-xs text-muted-foreground sm:flex">
          <span>{t(`knowledgeUi.types.${documentType(row.mediaType)}`)}</span>
          <span className="tabular-nums">{documentSize(row.sizeBytes)}</span>
          {'createdAt' in row && <time dateTime={row.createdAt} className="w-20 text-right">{relativeTime(row.createdAt)}</time>}
        </span>
      </button>
      {extracting && <ExtractionChip store={store} projectId={row.projectId} artifactId={row.artifactId} version={row.version} summary={row.extraction} />}
      {row.extraction?.status === 'failed' && <ExtractionRetry store={store} artifactId={row.artifactId} version={row.version} />}
    </li>;
  })}</ul></Card>;
}

/** Images become a thumbnail grid; every other document is one compact row. */
export function DocumentList({ store, rows, onSelect, showTask = false, detailed = false }: { store: Store; rows: Row[]; onSelect: (id: string) => void; showTask?: boolean; detailed?: boolean }) {
  const t = useT();
  const images = rows.filter(row => documentType(row.mediaType) === 'image');
  const documents = rows.filter(row => documentType(row.mediaType) !== 'image');
  return <div className="space-y-5">
    {!!images.length && <section aria-label={t('knowledgeUi.imagesSection')} className="space-y-2"><h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t('knowledgeUi.imagesSection')} · {images.length}</h4><ImageTiles store={store} rows={images} onSelect={onSelect} showTask={showTask} /></section>}
    {!!documents.length && <section aria-label={t('knowledgeUi.documentsSection')} className="space-y-2">{!!images.length && <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t('knowledgeUi.documentsSection')} · {documents.length}</h4>}<DocumentRows store={store} rows={documents} onSelect={onSelect} showTask={showTask} detailed={detailed} /></section>}
  </div>;
}
