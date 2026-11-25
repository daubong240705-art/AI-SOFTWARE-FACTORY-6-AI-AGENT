import { useCallback } from 'react';
import type { TraceTokenTotals } from '@factory/contracts';
import type { ApiClient } from '@/api/client';
import { LoadingState } from '@/components/LoadingState';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { openFlowRoute, traceHash } from '../shell/navigation';
import { useRead } from '../agents/shared';
import { useLiveRead } from './live';
import { elapsed, formatDuration, formatNumber, formatTime, TokenTotal, TraceStatus, useTraceLabels } from './presentation';
import type { ReactNode } from 'react';

function Section({ title, empty, children }: { title: string; empty: string; children: ReactNode[] }) {
  return <Card className="min-w-0 gap-3"><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent className="space-y-2">{children.length ? children : <p className="text-sm text-muted-foreground">{empty}</p>}</CardContent></Card>;
}

const rowClass = 'block w-full min-w-0 rounded-lg border p-3 text-left text-sm [overflow-wrap:anywhere] hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring';

export function MonitorView({ api, projectId, onOpenTask }: { api: ApiClient; projectId: string; onOpenTask: (id: string) => void }) {
  const label = useTraceLabels();
  const readAgents = useCallback((signal: AbortSignal) => api.listProjectAgents(projectId, signal), [api, projectId]);
  const { data: roster } = useRead(readAgents);
  const read = useCallback(async (signal: AbortSignal) => {
    const [monitor, traces] = await Promise.all([api.getProjectMonitor(projectId, signal), api.listTraces(projectId, signal)]);
    const attempts = new Map<string, { model?: string | null; runtime: string }>();
    if (monitor.liveAttempts.length) {
      try {
        const { attempts: recent } = await api.listProjectAttempts(projectId, { limit: 200 }, signal);
        for (const attempt of recent) attempts.set(attempt.id, attempt);
      } catch { /* The monitor remains usable without attempt enrichment. */ }
      const tasks = [...new Set(monitor.liveAttempts.filter(attempt => !attempts.has(attempt.id)).map(attempt => attempt.task.id))];
      await Promise.all(Array.from({ length: Math.min(6, tasks.length) }, async () => {
        for (let taskId = tasks.pop(); taskId && !signal.aborted; taskId = tasks.pop()) {
          try {
            for (const attempt of (await api.listAttempts(projectId, taskId, signal)).attempts) attempts.set(attempt.id, attempt);
          } catch { /* The Host may have removed an attempt since the snapshot. */ }
        }
      }));
    }
    return { monitor, traces: traces.traces, attempts };
  }, [api, projectId]);
  const { data, error, refresh } = useLiveRead(projectId, read);
  const monitor = data?.monitor;
  const byAgent = new Map<string | null, { label: string; total: TraceTokenTotals }>();
  const byModel = new Map<string, { label: string; total: TraceTokenTotals }>();
  function addUsage<Key>(groups: Map<Key, { label: string; total: TraceTokenTotals }>, key: Key, name: string, usage: TraceTokenTotals) {
    const group = groups.get(key) ?? { label: name, total: { known: 0, estimated: 0, unknownSpans: 0 } };
    group.total.known += usage.known;
    group.total.estimated += usage.estimated;
    group.total.unknownSpans += usage.unknownSpans;
    groups.set(key, group);
  }
  for (const entry of monitor?.today.byAgentAndModel ?? []) {
    addUsage(byAgent, entry.agent?.id ?? null, entry.agent?.name ?? label('unknown'), entry);
    addUsage(byModel, JSON.stringify([entry.provider, entry.model]), `${entry.provider} / ${entry.model}`, entry);
  }
  const names = new Map(monitor?.today.byAgentAndModel.flatMap(entry => entry.agent ? [[entry.agent.id, entry.agent.name] as const] : []));
  for (const attempt of monitor?.liveAttempts ?? []) if (attempt.agent) names.set(attempt.agent.id, attempt.agent.name);
  for (const agent of roster?.agents ?? []) names.set(agent.id, agent.name);
  const usageRows = (groups: Map<string | null, { label: string; total: TraceTokenTotals }>) => <dl className="grid gap-1">{[...groups].map(([key, group]) => <div key={key ?? ''} className="flex flex-wrap justify-between gap-x-2"><dt className="break-all">{group.label}</dt><dd><TokenTotal usage={group.total} /></dd></div>)}</dl>;

  return <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-2xl">{label('monitor')}</h2><p className="text-sm text-muted-foreground">{label('monitorHelp')}</p></div><Button variant="outline" data-testid="monitor-refresh" onClick={refresh}>{label('refresh')}</Button></header>
    {error ? <p role="alert" className="text-sm text-destructive">{label(monitor ? 'stale' : 'readError')}</p> : !monitor && <LoadingState inline />}
    {monitor && <>
      <div className="grid gap-4 md:grid-cols-2">
        <Section title={label('attempts')} empty={label('noAttempts')}>{monitor.liveAttempts.map(attempt => {
          const runtime = data.attempts.get(attempt.id);
          return <button key={attempt.id} type="button" className={rowClass} data-testid={`monitor-attempt-${attempt.id}`} onClick={() => onOpenTask(attempt.task.id)}>
            <div className="flex flex-wrap items-center justify-between gap-2"><strong>{attempt.task.title}</strong><TraceStatus status={attempt.status} /></div>
            <p>{attempt.agent?.name ?? label('unknown')} · {formatDuration(attempt.elapsedMs)}</p>
            <p className="text-muted-foreground">{label('runtime')}: {runtime?.runtime ?? label('unknown')} · {label('model')}: {runtime?.model ?? label('unknown')}</p>
            <p className="mt-1 whitespace-pre-wrap">{attempt.lastProgress?.message ?? label('noProgress')}</p>
          </button>;
        })}</Section>
        <Section title={label('runs')} empty={label('noRuns')}>{monitor.activeFlowRuns.map(run => <button key={run.id} type="button" className={rowClass} data-testid={`monitor-run-${run.id}`} onClick={() => openFlowRoute(projectId, { kind: 'runs', id: run.id })}>
          <div className="flex flex-wrap items-center justify-between gap-2"><strong>{run.title}</strong><TraceStatus status={run.status} /></div>
          <progress aria-label={label('nodes')} className="my-1 h-2 w-full accent-primary" max={Math.max(1, run.progress.total)} value={run.progress.completed} />
          <span>{formatNumber(run.progress.completed)} / {formatNumber(run.progress.total)} {label('nodes')}</span>
        </button>)}</Section>
        <Section title={label('tools')} empty={label('noTools')}>{monitor.recentToolCalls.map(call => <div key={call.id} className="rounded-lg border p-3 text-sm [overflow-wrap:anywhere]">
          <div className="flex flex-wrap items-center justify-between gap-2"><strong>{call.name}</strong><TraceStatus status={call.status} /></div>
          <p>{(call.agentId && names.get(call.agentId)) || call.agentId || label('unknown')} · {formatDuration(call.durationMs)}</p>
          <p className="text-muted-foreground">{label('inputSize')}: {formatNumber(call.argsBytes)} B · {label('outputSize')}: {formatNumber(call.resultBytes)} B</p>
        </div>)}</Section>
        <Section title={label('failures')} empty={label('noFailures')}>{monitor.recentFailures.map(span => <a key={span.id} className={rowClass} data-testid={`monitor-failure-${span.id}`} href={traceHash(projectId, span.traceId)}><div className="flex flex-wrap items-center justify-between gap-2"><strong>{span.title}</strong><TraceStatus status={span.status} /></div><span className="text-muted-foreground">{formatTime(span.endedAt ?? span.startedAt)}</span></a>)}</Section>
      </div>
      <Section title={label('today')} empty={label('noUsage')}>{byAgent.size ? [<div key="usage" className="space-y-3 text-sm"><p>{monitor.today.date} · <strong><TokenTotal usage={monitor.today} /></strong></p><div className="grid gap-4 md:grid-cols-2"><div><h3 className="mb-1 font-medium">{label('byAgent')}</h3>{usageRows(byAgent)}</div><div><h3 className="mb-1 font-medium">{label('byModel')}</h3>{usageRows(byModel)}</div></div></div>] : []}</Section>
      <Section title={label('recentTraces')} empty={label('noTraces')}>{data.traces.map(span => <a key={span.id} className={rowClass} data-testid={`monitor-trace-${span.traceId}`} href={traceHash(projectId, span.traceId)}>
        <div className="flex flex-wrap items-center justify-between gap-2"><strong>{span.title}</strong><TraceStatus status={span.status} /></div>
        <p className="mt-1 text-muted-foreground">{formatTime(span.startedAt)} · {formatDuration(elapsed(span.startedAt, span.endedAt))} · {label('tokens')}: {span.tokens === null ? label('unknown') : formatNumber(span.tokens)}</p>
      </a>)}</Section>
    </>}
  </div>;
}
