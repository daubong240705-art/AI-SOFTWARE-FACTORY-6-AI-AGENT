import { useCallback, useReducer, useState } from 'react';
import { idSchema, type Finding, type FlowDefinition, type ImprovementPatchItem, type ImprovementProposal, type InsightMetric, type ProjectAgentsResponse } from '@factory/contracts';
import { ApiClientError, type ApiClient } from '@/api/client';
import { flowCommand } from '@/api/commands';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Choice, ChoiceOption } from '@/components/ui/choice';
import { toast } from 'sonner';
import { viewHash } from '../shell/navigation';
import { SetupDialog } from '../setup/SetupDialog';
import { formatDuration } from '../monitor/presentation';
import { metric, percent, useInsightsLabels } from '../monitor/insightsPresentation';
import { Field, flowNodeTitle, FlowDialog, FlowError, timestamp, useFlowLabels, useFlowWrite, useRead } from './shared';

const ranges = [7, 30, 90] as const;
const columns = ['node', 'executions', 'failures', 'retries', 'rework', 'waits', 'runs', 'rejected', 'known', 'estimated', 'unknown'] as const;

function Findings({ items, projectId, names }: { items: Finding[]; projectId: string; names: Map<string, string> }) {
  const label = useInsightsLabels();
  if (!items.length) return <p className="text-sm text-muted-foreground">{label('noFindings')}</p>;
  const base = viewHash(`project:${projectId}`, 'flows').replace(/\/flows$/, '/runs');
  return <ul className="space-y-2">{items.map(item => {
    const runs = [...new Set(item.evidence.map(ref => ref.split(':')[0]).filter(ref => idSchema.safeParse(ref).success))];
    return <li key={item.id} className="space-y-1 break-words rounded-lg border p-3 text-sm" data-testid={`insights-finding-${item.id}`}>
      <div className="flex flex-wrap items-center gap-2"><Badge variant={item.severity === 'high' ? 'destructive' : 'outline'}>{label(`severity.${item.severity}`)}</Badge>
        {item.nodeId && <strong>{names.get(item.nodeId) ?? item.nodeId}</strong>}<p>{label(`finding.${item.code}`)}</p></div>
      {runs.length > 0 && <div className="flex flex-wrap gap-x-3 gap-y-1"><span className="text-muted-foreground">{label('evidence')}:</span>{runs.map(id => <a key={id} data-testid={`insights-evidence-${id}`} href={`${base}/${encodeURIComponent(id!)}`} className="text-primary underline">{label('run', { id: id!.slice(0, 8) })}</a>)}</div>}
    </li>;
  })}</ul>;
}

function PatchPreview({ projectId, proposal, definition, names, agents }: { projectId: string; proposal: ImprovementProposal; definition?: FlowDefinition; names: Map<string, string>; agents: Map<string, string> }) {
  const label = useInsightsLabels();
  const flow = useFlowLabels();
  function describe(item: ImprovementPatchItem) {
    if (item.op === 'change-model') return label(`patch.${item.op}`, { agent: agents.get(item.agentId) ?? item.agentId, model: item.model ?? label('noValue') });
    const node = names.get(item.nodeId) ?? item.nodeId;
    const before = definition?.nodes.find(entry => entry.id === item.nodeId);
    switch (item.op) {
      case 'set-timeout': return label(`patch.${item.op}`, { node, from: before ? before.timeoutMinutes ?? label('noValue') : label('missing'), to: item.timeoutMinutes });
      case 'set-retry': return label(`patch.${item.op}`, { node, from: before ? before.retry?.max ?? 0 : label('missing'), to: item.max, delay: item.backoffSeconds });
      case 'set-on-error': return label(`patch.${item.op}`, { node, from: before ? flow(`option.${before.onError}`) : label('missing'), to: flow(`option.${item.onError}`) });
      case 'change-agent': return label(`patch.${item.op}`, { node, agent: agents.get(item.agentId) ?? item.agentId });
      case 'add-review': {
        const { reviewer } = item;
        const agent = 'agent' in reviewer ? agents.get(reviewer.agent) ?? reviewer.agent : 'role' in reviewer ? reviewer.role : 'team' in reviewer ? reviewer.team : reviewer.tags.join(', ');
        return label(`patch.${item.op}`, { node, agent });
      }
    }
  }
  return <>
    <Findings items={proposal.findings} projectId={projectId} names={names} />
    <h4 className="text-sm font-medium">{label('preview')}</h4>
    {proposal.patch.length ? <ul data-testid="insights-patch-preview" className="list-disc space-y-1 break-words pl-5 text-sm">{proposal.patch.map((item, index) => <li key={index}>{describe(item)}</li>)}</ul>
      : <p className="text-sm text-muted-foreground">{label('noPatch')}</p>}
  </>;
}

export function FlowInsights({ api, projectId, flowId, definition, revision, agents, archived, dirty, refreshFlow }: {
  api: ApiClient; projectId: string; flowId: string; definition: FlowDefinition; revision: number; agents?: ProjectAgentsResponse | undefined;
  archived: boolean; dirty: boolean; refreshFlow: () => void;
}) {
  const label = useInsightsLabels();
  const flowLabel = useFlowLabels();
  const [days, setDays] = useState<(typeof ranges)[number]>(30);
  const [epoch, reload] = useReducer(value => value + 1, 0);
  const [dialog, setDialog] = useState<{ action: 'apply' | 'discard'; id: string; revision: number } | null>(null);
  const [linked, setLinked] = useState<string | null>(null);
  const [createdAi, setCreatedAi] = useState<string | null>(null);
  const [stale, setStale] = useState<string | null>(null);
  const read = useRead(useCallback((signal: AbortSignal) => api.getFlowInsights(projectId, flowId, days, signal), [api, projectId, flowId, days]), epoch);
  const proposals = useRead(useCallback((signal: AbortSignal) => api.listImprovementProposals(projectId, signal), [api, projectId]), epoch);
  const requested = useRead(useCallback((signal: AbortSignal) => createdAi ? api.getImprovementProposal(projectId, createdAi, signal) : Promise.resolve(null), [api, projectId, createdAi]), epoch);
  const write = useFlowWrite(api, () => { reload(); refreshFlow(); });
  const names = new Map(read.data?.flow.nodes.map(item => [item.nodeId, item.title]));
  for (const node of definition.nodes) names.set(node.id, flowNodeTitle(node, flowLabel));
  const agentNames = new Map(agents?.agents.map(agent => [agent.id, agent.name]));
  const items = proposals.data?.proposals.filter(item => item.flowId === flowId) ?? [];
  const current = items.find(item => item.id === dialog?.id);
  const linkedId = linked ?? (createdAi ? requested.data?.proposal.setupProposalId ?? items.find(item => item.id === createdAi)?.setupProposalId : null);
  const missing = label('missing');
  const show = (value: InsightMetric, format?: (value: number) => string) => metric(value, missing, format);
  const timing = (value: { medianMs: InsightMetric; p90Ms: InsightMetric }) => `${show(value.medianMs, formatDuration)} / ${show(value.p90Ms, formatDuration)}`;
  const conflict = write.error instanceof ApiClientError && write.error.code === 'conflict';
  const refresh = () => { reload(); refreshFlow(); };
  function propose(useAi: boolean) {
    const proposalId = crypto.randomUUID();
    setStale(null);
    void write.run(() => flowCommand('insights.propose', projectId, { proposalId, flowId, days, useAi }), () => {
      if (useAi) setCreatedAi(proposalId);
      toast.success(label('created'));
    });
  }
  function submit() {
    if (!dialog || !current || dialog.revision !== current.revision) return;
    if (dialog.action === 'apply' && (dirty || archived || current.baseDraftRevision !== revision)) return;
    const type = dialog.action === 'apply' ? 'insights.apply' : 'insights.discard';
    void write.run(() => flowCommand(type, projectId, { proposalId: current.id, expectedRevision: dialog.revision }), () => {
      toast.success(label(dialog.action === 'apply' ? 'applied' : 'discarded'));
      setDialog(null);
    });
  }
  const data = read.data;
  return <div data-testid="insights-panel" className="min-w-0 space-y-4 p-4">
    <div className="flex flex-wrap items-end justify-between gap-3"><div className="w-44 max-w-full"><Field label={label('days')}>{props => <Choice {...props} data-testid="insights-days" value={days} onValueChange={value => { const next = ranges.find(range => String(range) === value); if (next) setDays(next); }}>
      {ranges.map(range => <ChoiceOption key={range} value={range}>{label('dayCount', { count: range })}</ChoiceOption>)}
    </Choice>}</Field></div><div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" data-testid="insights-propose" disabled={archived || write.busy || read.loading || !!read.error || !data} onClick={() => propose(false)}>{label('propose')}</Button>
      <Button type="button" data-testid="insights-ask-ai" disabled={archived || dirty || write.busy || read.loading || !!read.error || !data || !!createdAi} onClick={() => propose(true)}>{label('askAi')}</Button>
      <Button type="button" variant="ghost" data-testid="insights-reload" onClick={refresh}>{flowLabel('reload')}</Button>
    </div></div>
    {dirty && <p className="text-sm text-muted-foreground">{label('unsaved')}</p>}
    <FlowError error={read.error ?? requested.error ?? (!dialog && write.error)} />
    {(read.loading || (createdAi && requested.loading)) && <p role="status" className="text-sm text-muted-foreground">{flowLabel('loading')}</p>}
    {data && <>
      <section aria-label={label('title')} data-testid="insights-summary" className="space-y-3 rounded-xl border bg-card p-4">
        <dl className="grid gap-3 sm:grid-cols-3">{([['total', show(data.flow.totalRuns)], ['success', show(data.flow.successRate, percent)], ['duration', timing(data.flow.totalDuration)]] as const).map(([key, value]) => <div key={key}><dt className="text-sm text-muted-foreground">{label(key)}</dt><dd className="text-lg font-semibold tabular-nums">{value}</dd></div>)}</dl>
        <div className="flex flex-wrap gap-2">{Object.entries(data.flow.runsByState).map(([state, count]) => <Badge variant="outline" key={state}>{flowLabel(`state.${state}`)}: {show(count)}</Badge>)}</div>
      </section>
      <section className="space-y-2"><h3 className="font-semibold">{label('nodes')}</h3>
        {data.flow.nodes.length ? <div className="max-w-full overflow-x-auto rounded-xl border bg-card" tabIndex={0} role="region" aria-label={label('nodes')}>
          <table data-testid="insights-node-table" className="w-full min-w-max text-left text-sm tabular-nums">
            <thead className="bg-muted"><tr>{columns.map(key => <th key={key} scope="col" className="px-3 py-2 font-medium">{label(key)}</th>)}</tr></thead>
            <tbody>{data.flow.nodes.map(node => <tr key={node.nodeId} className="border-t"><th scope="row" className="max-w-56 break-words px-3 py-2 font-medium">{node.title}</th>
              {[show(node.executions), show(node.failed), show(node.retries), show(node.reworkIterations), timing(node.wait), timing(node.run), show(node.approvals.rejected), show(node.cost.knownTokens), show(node.cost.estimatedTokens), show(node.cost.unknownCount)].map((value, index) => <td key={index} className="whitespace-nowrap px-3 py-2">{value}</td>)}
            </tr>)}</tbody>
          </table>
        </div> : <p className="text-sm text-muted-foreground">{label('noNodes')}</p>}
      </section>
      <section className="space-y-2"><h3 className="font-semibold">{label('findings')}</h3><Findings items={data.findings} projectId={projectId} names={names} /></section>
    </>}
    <section data-testid="insights-proposals" className="space-y-2"><h3 className="font-semibold">{label('proposals')}</h3>
      <FlowError error={proposals.error} />{proposals.loading && <p role="status" className="text-sm text-muted-foreground">{flowLabel('loading')}</p>}
      {proposals.data && !items.length && <p className="text-sm text-muted-foreground">{label('noProposals')}</p>}
      {items.map(item => {
        const outdated = item.state === 'ready' && item.baseDraftRevision !== revision;
        return <article className="space-y-2 rounded-xl border bg-card p-3" key={item.id} data-testid={`insights-proposal-${item.id}`}>
          <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{label(`state.${item.state}`)}</Badge><time dateTime={item.createdAt} className="text-xs text-muted-foreground">{timestamp(item.createdAt)}</time></div>
          <PatchPreview projectId={projectId} proposal={item} {...(item.baseDraftRevision === revision ? { definition } : {})} names={names} agents={agentNames} />
          {(outdated || stale === item.id) && <p role="status" className="text-sm text-muted-foreground">{label('stale')}</p>}
          <div className="flex flex-wrap gap-2">
            {item.setupProposalId && item.state !== 'discarded' && <Button type="button" size="sm" variant="outline" data-testid="insights-review-ai" disabled={dirty || archived || write.busy} onClick={() => setLinked(item.setupProposalId)}>{label('reviewAi')}</Button>}
            {item.state === 'ready' && item.patch.length > 0 && <Button type="button" size="sm" data-testid="insights-apply" disabled={archived || dirty || outdated || stale === item.id || write.busy || proposals.loading || !!proposals.error} onClick={() => { write.setError(null); setDialog({ action: 'apply', id: item.id, revision: item.revision }); }}>{label('apply')}</Button>}
            {!['applied', 'discarded'].includes(item.state) && <Button type="button" size="sm" variant="outline" data-testid="insights-discard" disabled={write.busy || proposals.loading || !!proposals.error} onClick={() => { write.setError(null); setDialog({ action: 'discard', id: item.id, revision: item.revision }); }}>{label('discard')}</Button>}
          </div>
        </article>;
      })}
    </section>
    {dialog && <FlowDialog title={label(dialog.action)} description={label(`${dialog.action}Help`)} busy={write.busy} close={() => setDialog(null)} submit={label(dialog.action)} submitTestId={`insights-confirm-${dialog.action}`}
      disabled={conflict || proposals.loading || !current || current.revision !== dialog.revision || (dialog.action === 'apply' && (dirty || archived || current.baseDraftRevision !== revision))} onSubmit={submit}>
      <FlowError error={write.error} />
      {conflict && <Button type="button" variant="outline" data-testid="insights-reload-conflict" onClick={() => { if (dialog.action === 'apply' && current?.revision === dialog.revision) setStale(dialog.id); setDialog(null); write.setError(null); refresh(); }}>{flowLabel('reload')}</Button>}
    </FlowDialog>}
    {linkedId && <SetupDialog key={linkedId} projectId={projectId} initialProposalId={linkedId} target={{ mode: 'flow', flowId }} close={() => { setLinked(null); setCreatedAi(null); }} onApplied={refresh} />}
  </div>;
}
