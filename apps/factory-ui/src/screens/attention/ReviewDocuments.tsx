import { useState } from 'react';
import { FileText, NotebookText, FileCode, FileImage } from 'lucide-react';
import type { TaskArtifact } from '../../api/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useT } from '../../i18n';
import type { Store } from '../../state/store';
import { MarkdownContent } from '@/components/MarkdownContent';
import { readableText } from './presentation';

export function ReviewDocuments({ store, taskId, documents, attemptId }: { store: Store; taskId: string; documents: TaskArtifact[]; attemptId: string | undefined }) {
  const t = useT();
  const current = documents.flatMap(document => {
    const version = [...document.versions].sort((a, b) => b.version - a.version).find(item => item.producedByAttemptId === attemptId);
    return document.kind !== 'code-ref' && version ? [{ document, version }] : [];
  });
  return <Card className="gap-3 border-border p-4 shadow-none"><h3 className="text-sm font-semibold">{t('reviewUi.documents')}</h3>
    {current.length ? <ItemGroup className="divide-y divide-border">{current.map(({ document, version }) => <DocumentRow key={document.artifactId} store={store} taskId={taskId} document={document} version={version} />)}</ItemGroup> : <p className="text-sm text-muted-foreground">{t('reviewUi.noDocuments')}</p>}
  </Card>;
}

function DocumentRow({ store, taskId, document, version }: { store: Store; taskId: string; document: TaskArtifact; version: TaskArtifact['versions'][number] }) {
  const t = useT(); const state = store.useStoreSelector(value => value); const [open, setOpen] = useState(false);
  const key = `${document.artifactId}:${version.version}`; const content = state.artifactContents[key]; const error = state.errors[`content:${key}`];
  const text = /^text\/(plain|markdown)(?:;|$)/i.test(version.mediaType);
  const Icon = document.kind === 'design-asset' || document.kind === 'media' ? FileImage : document.kind === 'api-contract' ? FileCode : document.kind === 'plan' ? NotebookText : FileText;
  // Generated record titles describe storage; the document kind describes the handoff.
  const title = /^(summary|changes|result|output|artifact|review)\b/i.test(document.title) ? t('reviewUi.summary') : readableText(document.title);
  function load() { if (text) void store.loadArtifactContent(taskId, document.artifactId, version.version); }
  return <Collapsible open={open} onOpenChange={value => { setOpen(value); if (value) load(); }}>
    <Item size="sm" className="gap-3 rounded-none px-0">
      <ItemMedia className="text-muted-foreground"><Icon className="size-4" /></ItemMedia>
      <ItemContent className="min-w-0"><ItemTitle className="break-words">{title}</ItemTitle><ItemDescription className="text-xs">{t(`knowledgeUi.kinds.${document.kind}`)}</ItemDescription></ItemContent>
      <ItemActions><CollapsibleTrigger asChild><Button variant="outline" size="sm">{t(open ? 'reviewUi.hide' : 'reviewUi.view')}</Button></CollapsibleTrigger></ItemActions>
    </Item>
    <CollapsibleContent className="pb-3">
      {state.loading[`content:${key}`] && <div role="status"><span className="sr-only">{t('viewStates.loading')}</span><Skeleton className="h-24 w-full" /></div>}
      {error && <Alert className="border-border"><AlertDescription><p>{t(`safeErrors.${error.code}`)}</p><Button variant="outline" size="sm" onClick={load}>{t('errors.retry')}</Button></AlertDescription></Alert>}
      {content && (/^text\/markdown(?:;|$)/i.test(version.mediaType) ? <div className="max-h-80 overflow-auto rounded-lg border border-border bg-background p-4"><MarkdownContent content={content.text} /></div> : <pre className="max-h-80 overflow-auto rounded-lg border border-border bg-background p-4 font-sans text-sm leading-relaxed whitespace-pre-wrap break-words">{readableText(content.text)}</pre>)}
      {!text && <p className="text-sm text-muted-foreground">{readableText(version.abstractL1 || version.abstractL0) || t('reviewUi.contentUnavailable')}</p>}
    </CollapsibleContent>
  </Collapsible>;
}
