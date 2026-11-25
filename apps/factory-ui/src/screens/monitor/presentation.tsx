import type { TraceTokenTotals } from '@factory/contracts';
import { Badge } from '@/components/ui/badge';
import { i18n, useT } from '@/i18n';

export const formatNumber = (value: number) => new Intl.NumberFormat(i18n.locale).format(value);
export const formatTime = (value: string) => new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
export function formatDuration(ms: number) {
  if (ms < 1000) return `${formatNumber(ms)} ms`;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${formatNumber(minutes)} min ${formatNumber(seconds % 60)} s` : `${formatNumber(seconds)} s`;
}
export const elapsed = (start: string, end: string | null) => Math.max(0, (end ? Date.parse(end) : Date.now()) - Date.parse(start));

export function useTraceLabels() {
  const t = useT();
  return (key: string, values: Record<string, string> = {}) => t(`traceUi.${key}`).replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

const success = new Set(['ok', 'done', 'completed', 'succeeded', 'approved', 'ready', 'applied']);
const failure = new Set(['failed', 'error', 'denied', 'rejected', 'timed-out', 'budget-blocked', 'unknown']);
const waiting = new Set(['ask-pending', 'pending', 'waiting', 'queued', 'paused', 'blocked']);
export const statusColor = (status: string) => success.has(status) ? 'bg-emerald-500' : failure.has(status) ? 'bg-red-500' : waiting.has(status) ? 'bg-amber-500' : 'bg-sky-500';

export function TraceStatus({ status }: { status: string }) {
  const label = useTraceLabels();
  const translated = label(`status.${status}`);
  return <Badge variant="outline" className="gap-1.5"><span aria-hidden="true" className={`size-2 rounded-full ${statusColor(status)}`} />{translated === `traceUi.status.${status}` ? status : translated}</Badge>;
}

export function TokenTotal({ usage }: { usage: TraceTokenTotals }) {
  const label = useTraceLabels();
  const parts = [usage.known || !usage.unknownSpans ? formatNumber(usage.known) : '',
    usage.unknownSpans ? label('unknownCount', { count: formatNumber(usage.unknownSpans) }) : '',
    usage.estimated ? label('estimated', { count: formatNumber(usage.estimated) }) : ''].filter(Boolean);
  return <>{parts.join(' · ')}</>;
}
