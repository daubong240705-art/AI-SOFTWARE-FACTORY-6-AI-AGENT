import { useState } from 'react';
import { ApiClientError } from '@/api/client';
import type { Extraction, ExtractionSummary } from '@/api/documents';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import { i18n, useT } from '@/i18n';
import { useExtraction, type ExtractionTarget } from './useExtraction';

const reasons = ['not-text', 'worker-unavailable', 'worker-disabled', 'timeout', 'corrupt', 'encrypted', 'unsupported', 'too-large', 'invalid-result', 'failed'];
export function ExtractionTechnicalDetails({ extraction }: { extraction: Extraction | undefined }) {
  const t = useT();
  if (!extraction?.converter) return null;
  return <Collapsible className="text-xs text-muted-foreground"><CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="group h-auto px-0 py-1 text-xs font-normal text-muted-foreground hover:bg-transparent"><ChevronDown className="size-3 transition-transform group-data-[state=open]:rotate-180" />{t('m5Ui.technicalDetails')}</Button></CollapsibleTrigger><CollapsibleContent className="pt-1 leading-5 [overflow-wrap:anywhere]">{t('knowledgeUi.extraction.converter').replace('{converter}', extraction.converter)}</CollapsibleContent></Collapsible>;
}
export function extractionReason(t: (key: string) => string, code?: string | null) {
  return t(`knowledgeUi.extraction.reasons.${code && reasons.includes(code) ? code : 'failed'}`);
}

export function ExtractionRetry({ store, artifactId, version, onRetried }: Omit<ExtractionTarget, 'projectId'> & { onRetried?: () => void }) {
  const t = useT(); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function retry() {
    setBusy(true); setError(null);
    try { await store.retryExtraction(artifactId, version); onRetried?.(); }
    catch (cause) { setError(t(cause instanceof ApiClientError && cause.status === 409 ? 'knowledgeUi.extraction.retryConflict' : 'knowledgeUi.extraction.retryError')); }
    finally { setBusy(false); }
  }
  return <span className="inline-flex shrink-0 flex-wrap items-center gap-2">
    <Button size="sm" variant="ghost" disabled={busy} onClick={() => { void retry(); }}>
      {busy && <Spinner className="size-3" aria-label={t('knowledgeUi.extraction.extracting')} />}{t('errors.retry')}
    </Button>
    {error && <span role="alert" className="max-w-48 text-xs text-info">{error}</span>}
  </span>;
}

export function ExtractionChip({ summary, ...target }: ExtractionTarget & { summary: ExtractionSummary | null }) {
  const t = useT();
  const { extraction } = useExtraction(target, summary, summary?.status === 'failed' || summary?.status === 'skipped');
  if (!summary) return null;
  const status = summary.status;
  if (status === 'skipped' && extraction?.errorCode !== 'worker-unavailable' && extraction?.errorCode !== 'worker-disabled') return null;
  const loading = status === 'pending' || status === 'running';
  const label = status === 'done'
    ? summary.pages === null ? t('knowledgeUi.extraction.done') : t('knowledgeUi.extraction.donePages').replace('{count}', new Intl.NumberFormat(i18n.locale).format(summary.pages))
    : loading ? t('knowledgeUi.extraction.extracting') : t(status === 'failed' ? 'knowledgeUi.extraction.failed' : 'knowledgeUi.extraction.disabled');
  return <Badge variant="outline" title={status === 'failed' ? extractionReason(t, extraction?.errorCode) : undefined} className={`gap-1.5 font-normal ${status === 'failed' ? 'text-info' : 'text-muted-foreground'}`}>
    {loading ? <Spinner className="size-3" aria-label={label} /> : <span aria-hidden="true" className={`size-1.5 rounded-full ${status === 'done' ? 'bg-ok' : 'bg-current'}`} />}{label}
  </Badge>;
}
