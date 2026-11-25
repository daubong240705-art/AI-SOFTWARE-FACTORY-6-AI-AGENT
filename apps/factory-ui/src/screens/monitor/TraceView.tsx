import { useCallback, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react';
import { traceTokenTotalsSchema, type TraceSpan } from '@factory/contracts';
import type { ApiClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/LoadingState';
import { artifactHash, openFlowRoute, viewHash } from '../shell/navigation';
import { useLiveRead } from './live';
import { elapsed, formatDuration, formatNumber, formatTime, statusColor, TokenTotal, TraceStatus, useTraceLabels } from './presentation';

const detailKeys: Record<TraceSpan['kind'], readonly string[]> = {
  request: [], 'flow-run': ['flowId', 'version', 'trigger', 'test'], 'node-run': ['nodeId', 'iteration', 'attemptNo'],
  task: ['code', 'agentId'], attempt: ['runtime', 'provider', 'model', 'agentId'],
  'tool-call': ['durationMs', 'argsBytes', 'resultBytes'], effect: [], approval: [], artifact: ['version'],
};

function detailString(span: TraceSpan, key: string) {
  const value = span.detail[key];
  return typeof value === 'string' && value ? value : null;
}

function spanTarget(span: TraceSpan, byId: ReadonlyMap<string, TraceSpan>, kind: TraceSpan['kind']) {
  const visited = new Set<string>();
  for (let current: TraceSpan | undefined = span; current && !visited.has(current.id); current = current.parentId ? byId.get(current.parentId) : undefined) {
    if (current.kind === kind) return current.ref;
    if (kind === 'task' && current.kind === 'attempt') {
      const task = detailString(current, 'taskId');
      if (task) return task;
    }
    if (kind === 'flow-run' && current.kind === 'node-run') {
      const run = detailString(current, 'runId');
      if (run) return run;
    }
    visited.add(current.id);
  }
  return null;
}

export function TraceView({ api, projectId, traceId, onOpenTask, onOpenApproval }: {
  api: ApiClient; projectId: string; traceId: string; onOpenTask: (id: string) => void;
  onOpenApproval: (id: string) => void;
}) {
  const label = useTraceLabels();
  const read = useCallback((signal: AbortSignal) => api.getTrace(projectId, traceId, signal), [api, projectId, traceId]);
  const { data, error, refresh } = useLiveRead(projectId, read);
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const monitorHash = viewHash(`project:${projectId}`, 'monitor');
  const spans = data?.spans ?? [];
  const byId = new Map(spans.map(span => [span.id, span]));
  const children = new Map<string | null, TraceSpan[]>();
  let start = Infinity;
  let end = -Infinity;
  const now = Date.now();
  for (const span of spans) {
    start = Math.min(start, Date.parse(span.startedAt));
    end = Math.max(end, span.endedAt ? Date.parse(span.endedAt) : now);
    const parent = span.parentId && byId.has(span.parentId) ? span.parentId : null;
    const siblings = children.get(parent) ?? [];
    siblings.push(span);
    children.set(parent, siblings);
  }
  const rows: { span: TraceSpan; depth: number }[] = [];
  const seen = new Set<string>();
  const visit = (roots: TraceSpan[], show = true) => {
    const pending = roots.map(span => ({ span, depth: 0, visible: show })).reverse();
    for (let row = pending.pop(); row; row = pending.pop()) {
      if (seen.has(row.span.id)) continue;
      seen.add(row.span.id);
      if (row.visible) rows.push(row);
      for (const span of [...(children.get(row.span.id) ?? [])].reverse()) pending.push({ span, depth: row.depth + 1, visible: row.visible && !collapsed.has(row.span.id) });
    }
  };
  visit(children.get(null) ?? []);
  for (const span of spans) if (!seen.has(span.id)) visit([span]);
  const span = (selected ? byId.get(selected) : undefined) ?? rows[0]?.span;
  const task = span && spanTarget(span, byId, 'task');
  const run = span && spanTarget(span, byId, 'flow-run');
  const approval = span && spanTarget(span, byId, 'approval');
  const artifact = span?.kind === 'artifact' ? detailString(span, 'artifactId') : null;
  const version = span?.detail.version;
  const usage = span && traceTokenTotalsSchema.safeParse(span.detail.usage);
  const duration = Math.max(1, end - start);

  return <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
    <header className="flex flex-wrap items-center gap-3"><Button asChild variant="outline"><a href={monitorHash} data-testid="trace-back"><ArrowLeft aria-hidden="true" />{label('monitor')}</a></Button><h2 className="mr-auto font-display text-2xl">{label('trace')}</h2><Button variant="outline" data-testid="trace-refresh" onClick={refresh}>{label('refresh')}</Button></header>
    {error ? <p role="alert" className="text-destructive">{label(data ? 'stale' : 'readError')}</p> : !data && <LoadingState inline />}
    {data && <>
      <div className="rounded-lg border bg-card p-3 text-sm"><strong>{rows[0]?.span.title ?? label('trace')}</strong> · {label('tokens')}: <TokenTotal usage={data.summary} /></div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section aria-label={label('timeline')} className="min-w-0 space-y-1 rounded-lg border bg-card p-2">
          {!rows.length && <p className="p-2 text-muted-foreground">{label('noSpans')}</p>}
          {rows.map(({ span: item, depth }) => {
            const isCollapsed = collapsed.has(item.id);
            const left = (Date.parse(item.startedAt) - start) / duration * 100;
            const width = Math.min(100 - left, elapsed(item.startedAt, item.endedAt) / duration * 100);
            return <div key={item.id} className="grid grid-cols-[minmax(0,2fr)_minmax(3rem,1fr)] items-center gap-2 rounded-md border px-2">
              <div className="flex min-w-0 items-center gap-1" style={{ paddingInlineStart: `${Math.min(depth, 12) * 0.65}rem` }}>
                {children.has(item.id) ? <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0" aria-expanded={!isCollapsed} aria-label={`${label(isCollapsed ? 'expand' : 'collapse')}: ${item.title}`} data-testid={`trace-toggle-${item.id}`} onClick={() => setCollapsed(previous => {
                  const next = new Set(previous); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next;
                })}>{isCollapsed ? <ChevronRight /> : <ChevronDown />}</Button> : <span className="w-6 shrink-0" />}
                <button type="button" className="w-full min-w-0 rounded-sm py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-ring" aria-pressed={span?.id === item.id} data-testid={`trace-span-${item.id}`} onClick={() => setSelected(item.id)}>
                  <span className="block break-words font-medium">{label(`kind.${item.kind}`)} · {item.title}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><TraceStatus status={item.status} />{formatDuration(elapsed(item.startedAt, item.endedAt))}{item.tokens !== null && ` · ${formatNumber(item.tokens)} ${label('tokens')}`}</span>
                </button>
              </div>
              <div className="relative h-2 rounded-full bg-muted" aria-hidden="true"><span className={`absolute top-0 h-2 min-w-[2px] rounded-full ${statusColor(item.status)}`} style={{ left: `${left}%`, width: `${width}%` }} /></div>
            </div>;
          })}
        </section>
        {span && <aside aria-label={label('spanDetail')} className="min-w-0 space-y-3 rounded-lg border bg-card p-4 text-sm [overflow-wrap:anywhere]">
          <h3 className="text-base font-semibold">{label('spanDetail')}</h3><div><p className="font-medium">{span.title}</p><TraceStatus status={span.status} /></div>
          <dl className="space-y-1">
            <div><dt className="inline font-medium">{label('started')}: </dt><dd className="inline">{formatTime(span.startedAt)}</dd></div>
            <div><dt className="inline font-medium">{label('ended')}: </dt><dd className="inline">{span.endedAt ? formatTime(span.endedAt) : label('unknown')}</dd></div>
            <div><dt className="inline font-medium">{label('tokens')}: </dt><dd className="inline">{usage?.success ? <TokenTotal usage={usage.data} /> : span.tokens === null ? label('unknown') : formatNumber(span.tokens)}</dd></div>
            {detailKeys[span.kind].map(key => {
              const value = span.detail[key];
              if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return null;
              return <div key={key}><dt className="inline font-medium">{label(`field.${key}`)}: </dt><dd className="inline">{typeof value === 'boolean' ? label(value ? 'yes' : 'no') : typeof value === 'number' ? formatNumber(value) : value}</dd></div>;
            })}
          </dl>
          <div className="flex flex-wrap gap-2">
            {task && <Button variant="outline" size="sm" data-testid="trace-open-task" onClick={() => onOpenTask(task)}>{label('openTask')}</Button>}
            {run && <Button variant="outline" size="sm" data-testid="trace-open-run" onClick={() => openFlowRoute(projectId, { kind: 'runs', id: run })}>{label('openRun')}</Button>}
            {approval && <Button variant="outline" size="sm" data-testid="trace-open-approval" onClick={() => onOpenApproval(approval)}>{label('openApproval')}</Button>}
            {artifact && typeof version === 'number' && Number.isSafeInteger(version) && version > 0 && <Button asChild variant="outline" size="sm"><a data-testid="trace-open-artifact" href={artifactHash(projectId, { id: artifact, version })}>{label('openArtifact')}</a></Button>}
          </div>
        </aside>}
      </div>
    </>}
  </div>;
}
