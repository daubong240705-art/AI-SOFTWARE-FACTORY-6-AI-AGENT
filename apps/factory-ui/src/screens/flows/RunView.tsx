import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { ArrowLeft, Pause, Play, RotateCcw, Square } from 'lucide-react';
import { FLOW_RUN_TRANSITIONS, type FlowNodeRun } from '@factory/contracts';
import type { ApiClient } from '@/api/client';
import { flowCommand } from '@/api/commands';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { FlowCanvas, type Selection } from './FlowCanvas';
import { Toggle } from './FlowFields';
import { Field, FlowDialog, FlowError, NodePicker, PortLabel, RunState, duration, flowNodeTitle, timestamp, useFlowEvents, useFlowLabels, useFlowWrite, useRead } from './shared';
import { openFlowRoute } from '../shell/navigation';

export function RunView({ api, projectId, runId, onBack, onOpenTask, onOpenApproval }: {
  api: ApiClient; projectId: string; runId: string; onBack: () => void; onOpenTask: (id: string) => void; onOpenApproval: (id: string) => void;
}) {
  const label = useFlowLabels();
  const [refreshKey, refresh] = useReducer(value => value + 1, 0);
  const read = useCallback((signal: AbortSignal) => api.getFlowRun(projectId, runId, signal), [api, projectId, runId]);
  const { data, error, loading } = useRead(read, refreshKey);
  const rosterRead = useRead(useCallback((signal: AbortSignal) => api.listProjectAgents(projectId, signal), [api, projectId]));
  const agentNames = useMemo(() => new Map((rosterRead.data?.agents ?? []).map(agent => [agent.id, agent.name])), [rosterRead.data]);
  const [selection, setSelection] = useState<Selection>(null);
  const [dialog, setDialog] = useState<'pause' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');
  const [stopRunning, setStopRunning] = useState(false);
  const write = useFlowWrite(api, refresh);
  useFlowEvents(projectId, refresh, runId);
  const state = data?.run.state;
  useEffect(() => {
    if (!state || !['running', 'queued', 'waiting'].includes(state)) return;
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [state]);
  if (!data) return <div className="space-y-3 p-4"><Button variant="ghost" onClick={onBack}>{label('back')}</Button><FlowError error={error} missingRoute />{loading && <p role="status">{label('loading')}</p>}{error && <Button variant="outline" onClick={refresh}>{label('reload')}</Button>}</div>;

  const { run, definition, nodeRuns } = data;
  const node = selection?.kind === 'node' ? definition.nodes.find(item => item.id === selection.id) : undefined;
  const attempts = nodeRuns.filter(attempt => attempt.nodeId === node?.id).sort((first, second) => second.iteration - first.iteration || second.attemptNo - first.attemptNo);
  const retryable = attempts[0]?.state === 'failed' || attempts[0]?.state === 'succeeded';
  const controls = FLOW_RUN_TRANSITIONS[run.state];
  const busy = write.busy || !!error;
  const base = { runId, expectedRevision: run.revision };
  function submit() {
    if (dialog === 'pause') void write.run(() => flowCommand('flow-runs.pause', projectId, { ...base, stopRunning }), () => setDialog(null));
    if (dialog === 'cancel' && reason.trim()) void write.run(() => flowCommand('flow-runs.cancel', projectId, { ...base, reason }), () => setDialog(null));
  }
  return <div data-testid="flow-run-detail" className="flex h-full min-h-0 flex-col">
    <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
      <Button variant="ghost" size="icon" aria-label={label('back')} onClick={onBack}><ArrowLeft className="size-4" /></Button>
      <div className="min-w-36 flex-1"><h2 className="truncate text-lg font-semibold">{run.flowTitle}</h2><p className="text-xs text-muted-foreground">{timestamp(run.startedAt ?? run.createdAt)} · {duration(run.startedAt, run.endedAt)} · r{run.revision}</p></div>
      <RunState run={run} />
      <Button size="sm" variant="ghost" onClick={() => openFlowRoute(projectId, { kind: 'flows', id: run.flowId })}>{label('openDefinition')}</Button>
      <Button size="sm" variant="ghost" onClick={refresh}>{label('reload')}</Button>
      {controls.includes('paused') && <Button size="sm" variant="outline" disabled={busy} onClick={() => { write.setError(null); setStopRunning(false); setDialog('pause'); }}><Pause aria-hidden="true" />{label('pause')}</Button>}
      {(state === 'paused' || state === 'stalled') && <Button size="sm" variant="outline" disabled={busy} onClick={() => void write.run(() => flowCommand('flow-runs.resume', projectId, base))}><Play aria-hidden="true" />{label('resume')}</Button>}
      {controls.includes('cancelled') && <Button size="sm" variant="destructive" disabled={busy} onClick={() => { write.setError(null); setReason(''); setDialog('cancel'); }}><Square aria-hidden="true" />{label('cancel')}</Button>}
    </header>
    <div className="grid min-h-0 flex-1 gap-2 overflow-auto p-2 lg:grid-cols-[minmax(0,1fr)_19rem] xl:grid-cols-[minmax(0,1fr)_23rem]">
      <div className="flex min-h-[420px] min-w-0 flex-col gap-2 lg:min-h-0">
        <NodePicker definition={definition} current={node?.id} onChange={id => setSelection(id ? { kind: 'node', id } : null)} />
        <div className="min-h-0 flex-1"><FlowCanvas agentNames={agentNames} definition={definition} selection={selection} onSelect={setSelection} runs={nodeRuns} /></div>
      </div>
      <aside className="min-w-0 space-y-3 rounded-xl border bg-card p-3 lg:overflow-auto">
        <FlowError error={error ?? (!dialog && write.error)} />
        {run.stateReason && <p className="break-words rounded-md bg-muted p-2 text-sm">{run.stateReason}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="break-all text-sm font-semibold">{node ? flowNodeTitle(node, label) : label('nodeRun')}</h3>
          {node && retryable && <Button size="sm" variant="outline" disabled={busy} onClick={() => void write.run(() => flowCommand('flow-runs.retry-node', projectId, { ...base, nodeId: node.id }))}><RotateCcw aria-hidden="true" />{label('retryNode')}</Button>}
        </div>
        {node ? attempts.length ? attempts.map(attempt => <Attempt key={`${attempt.iteration}-${attempt.attemptNo}`} attempt={attempt} onOpenTask={onOpenTask}
          onOpenApproval={onOpenApproval} onChild={id => openFlowRoute(projectId, { kind: 'runs', id })} />) : <p className="text-sm text-muted-foreground">{label('noAttempts')}</p>
          : <p className="text-sm text-muted-foreground">{label('selectHint')}</p>}
      </aside>
    </div>
    {dialog && <FlowDialog title={label(dialog)} description={label(`${dialog}Help`)} close={() => setDialog(null)} busy={write.busy}
      disabled={dialog === 'cancel' && !reason.trim()} submit={label(dialog)} onSubmit={submit}>
      {dialog === 'pause' ? <Toggle name={label('stopRunning')} checked={stopRunning} set={setStopRunning} />
        : <Field label={label('cancelReason')}>{props => <Textarea {...props} value={reason} maxLength={500} onChange={event => setReason(event.target.value)} />}</Field>}
      <FlowError error={write.error} />
    </FlowDialog>}
  </div>;
}

function Attempt({ attempt, onOpenTask, onOpenApproval, onChild }: { attempt: FlowNodeRun; onOpenTask: (id: string) => void; onOpenApproval: (id: string) => void; onChild: (id: string) => void }) {
  const label = useFlowLabels();
  const { taskId, approvalId, childRunId } = attempt;
  return <article className="space-y-2 rounded-lg border p-2 text-sm">
    <div className="flex flex-wrap justify-between gap-1"><span>{label('iteration', { count: attempt.iteration })} · {label('attempt', { count: attempt.attemptNo })}</span>
      <Badge variant={attempt.state === 'failed' ? 'destructive' : 'outline'}>{label(`state.${attempt.state}`)}</Badge></div>
    <p className="text-xs text-muted-foreground">{timestamp(attempt.startedAt)} → {timestamp(attempt.endedAt)} · {duration(attempt.startedAt, attempt.endedAt)}</p>
    {attempt.port && <p className="text-xs">{label('field.port')}: <PortLabel port={attempt.port} /></p>}
    {attempt.pinned && <Badge variant="secondary">{label('pinned')}</Badge>}
    {attempt.error && <p className="whitespace-pre-wrap break-words text-sm text-destructive">{attempt.error}</p>}
    <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-xs">{attempt.output === null && !attempt.pinned ? label('noOutput') : JSON.stringify(attempt.output, null, 2)}</pre>
    <div className="flex flex-wrap gap-x-3">
      {taskId && <Button variant="link" size="sm" className="px-0" onClick={() => onOpenTask(taskId)}>{label('openTask')}</Button>}
      {approvalId && <Button variant="link" size="sm" className="px-0" onClick={() => onOpenApproval(approvalId)}>{label('openApproval')}</Button>}
      {childRunId && <Button variant="link" size="sm" className="px-0" onClick={() => onChild(childRunId)}>{label('openChildRun')}</Button>}
    </div>
  </article>;
}
