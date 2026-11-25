import { useId, useMemo, useState } from 'react';
import { validateFlow, type AgentConfig, type FlowDefinition, type SetupIssue, type SetupProposal } from '@factory/contracts';
import type { ApiClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useT } from '@/i18n';
import { AgentEditor } from '../agents/AgentEditor';
import { FlowCanvas, type Selection } from '../flows/FlowCanvas';

export function ProposalIssues({ issues }: { issues: readonly SetupIssue[] }) {
  const t = useT();
  if (!issues.length) return null;
  return <section aria-label={t('setupProposalUi.issues')} className="rounded-lg border border-destructive/40 p-3 text-sm [overflow-wrap:anywhere]">
    <h3 className="font-semibold">{t('setupProposalUi.issues')}</h3>
    <ul className="list-disc pl-5">{issues.map((issue, index) => <li key={index}>{issue.path && <><code>{issue.path}</code>: </>}{issue.message}</li>)}</ul>
  </section>;
}

function WorkflowPreview({ flow, issues }: { flow: FlowDefinition; issues: readonly SetupIssue[] }) {
  const [selection, setSelection] = useState<Selection>(null);
  const validation = useMemo(() => validateFlow(flow), [flow]);
  return <div className="space-y-2"><h4 className="font-medium">{flow.title}</h4><div className="h-64 overflow-hidden rounded-lg border"><FlowCanvas definition={flow} selection={selection} onSelect={setSelection} issues={validation} /></div>
    <ProposalIssues issues={[...issues, ...validation.map(issue => ({ path: issue.node ?? issue.edge ?? '', message: issue.message }))]} />
  </div>;
}

export function ProposalReview({ api, projectId, proposal, issues, editable, onEdit }: {
  api: ApiClient; projectId: string; proposal: SetupProposal; issues: readonly SetupIssue[]; editable: boolean; onEdit: (value: SetupProposal) => void;
}) {
  const t = useT();
  const summaryId = useId();
  const [agentKey, setAgentKey] = useState<string | null>(null);
  const agent = proposal.agents.find(entry => entry.key === agentKey);
  const names = new Map(proposal.agents.map(entry => [entry.key, entry.config.name]));
  const name = (key: string) => names.get(key) ?? key;
  const updateAgent = (config: AgentConfig) => onEdit({ ...proposal, agents: proposal.agents.map(entry => entry.key === agentKey ? { ...entry, config } : entry) });
  return <div className="space-y-4 [overflow-wrap:anywhere]">
    {editable ? <div className="space-y-1"><label htmlFor={summaryId} className="font-semibold">{t('setupProposalUi.summary')}</label><Textarea id={summaryId} data-testid="setup-summary" required maxLength={2000} value={proposal.summary} onChange={event => onEdit({ ...proposal, summary: event.target.value })} />{!proposal.summary.trim() && <p className="text-sm text-destructive">{t('setupProposalUi.required')}</p>}</div> : <section><h3 className="font-semibold">{t('setupProposalUi.summary')}</h3><p className="whitespace-pre-wrap">{proposal.summary}</p></section>}
    {!!proposal.agents.length && <section className="space-y-2"><h3 className="font-semibold">{t('setupProposalUi.agents')}</h3><ul className="grid gap-2 sm:grid-cols-2">{proposal.agents.map(({ key, config }) => <li key={key} className="min-w-0 space-y-1 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2"><strong>{config.name}</strong>{editable && <Button type="button" size="sm" variant="outline" data-testid={`setup-edit-agent-${key}`} onClick={() => setAgentKey(key)}>{t('setupProposalUi.editAgent')}</Button>}</div>
      <p>{config.role} · {config.runtime.adapter}{config.runtime.model ? ` / ${config.runtime.model}` : ''}</p><p className="whitespace-pre-wrap text-muted-foreground">{config.description}</p>
    </li>)}</ul></section>}
    {!!proposal.teams.length && <section className="space-y-2"><h3 className="font-semibold">{t('setupProposalUi.teams')}</h3><ul className="grid gap-2 sm:grid-cols-2">{proposal.teams.map((team, index) => <li key={index} className="rounded-lg border p-3 text-sm"><strong>{team.name}</strong><p className="whitespace-pre-wrap">{team.description}</p><p className="text-muted-foreground">{team.memberKeys.map(name).join(', ')}</p>{team.leadKey && <p>{t('setupProposalUi.lead')}: {name(team.leadKey)}</p>}</li>)}</ul></section>}
    {!!proposal.relations.length && <section className="space-y-2"><h3 className="font-semibold">{t('setupProposalUi.relations')}</h3><div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm"><thead><tr className="bg-muted/50"><th className="p-2">{t('setupProposalUi.from')}</th><th className="p-2">{t('setupProposalUi.to')}</th><th className="p-2">{t('setupProposalUi.relation')}</th></tr></thead><tbody>{proposal.relations.map((relation, index) => <tr key={index} className="border-t"><td className="p-2">{name(relation.fromKey)}</td><td className="p-2">{name(relation.toKey)}</td><td className="p-2">{t(`agentsAdmin.relations.kinds.${relation.kind}`)}</td></tr>)}</tbody></table></div></section>}
    {!!proposal.flows.length && <section className="space-y-3"><h3 className="font-semibold">{t('setupProposalUi.workflows')}</h3>{proposal.flows.map((flow, index) => <WorkflowPreview key={index} flow={flow} issues={issues.filter(issue => issue.path === `flows.${index}` || issue.path.startsWith(`flows.${index}.`))} />)}</section>}
    {!!proposal.notes.length && <section><h3 className="font-semibold">{t('setupProposalUi.notes')}</h3><ul className="list-disc space-y-1 pl-5">{proposal.notes.map((note, index) => <li className="whitespace-pre-wrap" key={index}>{note}</li>)}</ul></section>}
    {editable && agent && <AgentEditor api={api} projectId={projectId} initial={agent.config} close={() => setAgentKey(null)} refresh={() => undefined} submit={async build => {
      const command = build();
      if (command.type === 'agents.create') updateAgent(command.payload.config);
    }} />}
  </div>;
}
