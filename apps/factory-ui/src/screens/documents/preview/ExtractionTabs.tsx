import { useState, type ReactNode } from 'react';
import type { Extraction, ExtractionSummary } from '@/api/documents';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useT } from '@/i18n';
import { ExtractionRetry, extractionReason } from '../ExtractionStatus';
import type { ExtractionTarget } from '../useExtraction';
import { AgentReadText, type TextJump } from './AgentReadText';
import { ExtractionOutline } from './ExtractionOutline';

export type ExtractionPreviewProps = ExtractionTarget & {
  mediaType: string;
  summary: ExtractionSummary | null;
  extraction: Extraction | undefined;
  extractionError: boolean;
  onReloadExtraction: () => void;
  children: (page: number, onPageChange: (page: number) => void) => ReactNode;
};

export function ExtractionTabs({ store, projectId, artifactId, version, mediaType, summary, extraction, extractionError, onReloadExtraction, children }: ExtractionPreviewProps) {
  const t = useT();
  const [tab, setTab] = useState('preview');
  const [page, setPage] = useState(1);
  const [jump, setJump] = useState<TextJump | null>(null);
  const done = summary?.status === 'done';
  const failed = summary?.status === 'failed';
  function jumpTo(entry: Extraction['outline'][number]) {
    if (entry.page !== null && mediaType.split(';')[0]?.toLowerCase() === 'application/pdf') {
      setPage(entry.page); setTab('preview');
    } else {
      setJump(current => ({ offset: entry.offset, sequence: (current?.sequence ?? 0) + 1 })); setTab('text');
    }
  }
  return <div className="space-y-4">
    {failed && <Alert className="border-border text-info"><AlertDescription className="space-y-2 text-info">
      <p>{extractionReason(t, extraction?.errorCode)}</p>
      <ExtractionRetry store={store} artifactId={artifactId} version={version} onRetried={onReloadExtraction} />
    </AlertDescription></Alert>}
    <Tabs value={done ? tab : 'preview'} onValueChange={setTab} className="gap-4">
      <TabsList variant="pills" aria-label={t('knowledgeUi.preview')}>
        <TabsTrigger value="preview">{t('knowledgeUi.preview')}</TabsTrigger>
        {done && <><TabsTrigger value="text">{t('knowledgeUi.extraction.textTab')}</TabsTrigger><TabsTrigger value="outline">{t('knowledgeUi.extraction.outlineTab')}</TabsTrigger></>}
      </TabsList>
      <TabsContent value="preview" forceMount className="data-[state=inactive]:hidden">{children(page, setPage)}</TabsContent>
      {done && <>
        <TabsContent value="text" forceMount className="data-[state=inactive]:hidden">
          <AgentReadText store={store} projectId={projectId} artifactId={artifactId} version={version} active={tab === 'text'} jump={jump} />
        </TabsContent>
        <TabsContent value="outline">
          {extraction ? <ExtractionOutline entries={extraction.outline} onSelect={jumpTo} /> : extractionError
            ? <Alert className="border-border"><AlertDescription className="space-y-2"><p>{t('knowledgeUi.extraction.detailsError')}</p><Button variant="outline" size="sm" onClick={onReloadExtraction}>{t('errors.retry')}</Button></AlertDescription></Alert>
            : <Spinner aria-label={t('viewStates.loading')} className="m-4 text-muted-foreground" />}
        </TabsContent>
      </>}
    </Tabs>
  </div>;
}
