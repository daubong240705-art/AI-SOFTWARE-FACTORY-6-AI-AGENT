import { Choice, ChoiceOption } from '@/components/ui/choice';
import { useState } from 'react';
import { agentTeamsCreatePayloadSchema, agentTeamsUpdatePayloadSchema, type AgentSummary, type ProjectTeam } from '@factory/contracts';
import type { AgentProjectResponse } from '@/api/agentModels';
import { agentTeamsCreate, agentTeamsDelete, agentTeamsUpdate } from '@/api/commands';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useT } from '@/i18n';
import { AdminDialog, DialogButtons, ErrorText, Field, useAgentLabels, useWriteFeedback, type Submit } from './shared';

export function TeamsPanel({ projectId, data, submit }: { projectId: string; data: AgentProjectResponse; submit: Submit }) {
  const t = useAgentLabels();
  const label = useT();
  const [action, setAction] = useState<{ kind: 'edit' | 'delete'; team: ProjectTeam } | { kind: 'new' } | null>(null);
  const agents = new Map(data.agents.map(agent => [agent.id, agent]));
  const close = () => setAction(null);
  const team = action && 'team' in action ? action.team : undefined;
  const stale = !!team && data.teams.find(item => item.id === team.id)?.revision !== team.revision;
  return <section className="space-y-4 rounded-xl border border-border bg-card/60 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{t('teams.title')}</h3><p className="text-sm text-muted-foreground">{t('teams.help')}</p></div><Button data-testid="team-create" type="button" size="sm" variant="outline" onClick={() => setAction({ kind: 'new' })}>{t('teams.create')}</Button></div>
    {!data.teams.length && <p className="text-sm text-muted-foreground">{t('teams.empty')}</p>}
    <div className="grid gap-3 md:grid-cols-2">{data.teams.map(item => <article data-testid={`team-row-${item.id}`} key={item.id} className="min-w-0 space-y-3 rounded-lg border border-border bg-background/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1"><h4 className="break-words font-medium">{item.name}</h4><p className="break-words text-sm text-muted-foreground">{item.description}</p></div>
        <div className="flex flex-wrap gap-1"><Button data-testid="team-edit" type="button" size="sm" variant="ghost" onClick={() => setAction({ kind: 'edit', team: item })}>{t('edit')}</Button><Button data-testid="team-delete" type="button" size="sm" variant="ghost" onClick={() => setAction({ kind: 'delete', team: item })}>{t('delete')}</Button></div>
      </div>
      <div className="flex flex-wrap gap-2">{item.memberIds.map(id => {
        const name = agents.get(id)?.name ?? label('flowsUi.missingAgent');
        return <span key={id} className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-muted px-1.5 py-1 text-xs"><Avatar className="size-6 shrink-0" aria-hidden="true"><AvatarFallback>{name.slice(0, 2).toLocaleUpperCase()}</AvatarFallback></Avatar><span className="break-all">{name}{item.leadAgentId === id && ` · ${t('teams.lead')}`}</span></span>;
      })}{!item.memberIds.length && <p className="text-xs text-muted-foreground">{t('teams.noMembers')}</p>}</div>
    </article>)}</div>
    {action && action.kind !== 'delete' && <TeamDialog projectId={projectId} team={team} agents={data.agents} close={close} submit={submit} stale={stale} />}
    {action?.kind === 'delete' && <DeleteTeam team={action.team} close={close} submit={submit} stale={stale} />}
  </section>;
}

function TeamDialog({ projectId, team, agents, close, submit, stale }: { projectId: string; team: ProjectTeam | undefined; agents: AgentSummary[]; close: () => void; submit: Submit; stale: boolean }) {
  const t = useAgentLabels();
  const [name, setName] = useState(team?.name ?? '');
  const [description, setDescription] = useState(team?.description ?? '');
  const [memberIds, setMembers] = useState(team?.memberIds ?? []);
  const [leadAgentId, setLead] = useState(team?.leadAgentId ?? null);
  const [issues, setIssues] = useState<string[]>([]);
  const writer = useWriteFeedback(submit);
  const invalid = (field: string) => issues.includes(field) ? t('invalid') : undefined;
  function toggle(id: string, checked: boolean) {
    setMembers(checked ? [...memberIds, id] : memberIds.filter(member => member !== id));
    if (!checked && leadAgentId === id) setLead(null);
  }
  function save() {
    if (stale) return;
    const draft = { name, description, memberIds, leadAgentId };
    const parsed = team ? agentTeamsUpdatePayloadSchema.safeParse({ ...draft, teamId: team.id, expectedRevision: team.revision }) : agentTeamsCreatePayloadSchema.safeParse({ ...draft, teamId: projectId });
    if (!parsed.success) { setIssues(parsed.error.issues.map(issue => String(issue.path[0]))); return; }
    void writer.run(() => team ? agentTeamsUpdate({ projectId, teamId: team.id, expectedRevision: team.revision, ...draft }) : agentTeamsCreate({ projectId, ...draft }), close);
  }
  return <AdminDialog title={t(team ? 'teams.edit' : 'teams.create')} description={t('teams.help')} close={close} busy={writer.busy} onSubmit={save} footer={<DialogButtons close={close} label={t('save')} busy={writer.busy} disabled={stale} />}>
    <ErrorText error={writer.error} />{stale && <p role="status" className="text-sm text-muted-foreground">{t('errors.conflict')}</p>}
    <Field label={t('fields.name')} invalid={invalid('name')}>{props => <Input data-testid="team-name" {...props} value={name} onChange={event => setName(event.target.value)} maxLength={80} />}</Field>
    <Field label={t('fields.description')} invalid={invalid('description')}>{props => <Textarea {...props} value={description} onChange={event => setDescription(event.target.value)} maxLength={2000} />}</Field>
    <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">{t('teams.members')}</legend>{invalid('memberIds') && <p className="text-sm text-destructive">{invalid('memberIds')}</p>}
      <div className="max-h-52 space-y-2 overflow-auto rounded-lg border border-border p-2">
        {agents.map(agent => { const selected = memberIds.includes(agent.id); return <label key={agent.id} className="flex items-start gap-2 break-words text-sm"><Checkbox data-testid={`team-member-${agent.id}`} checked={selected} disabled={!selected && memberIds.length >= 200} onCheckedChange={value => toggle(agent.id, value === true)} /><span className="min-w-0">{agent.name} · {agent.role}</span></label>; })}
        {!agents.length && <p className="text-sm text-muted-foreground">{t('teams.noMembers')}</p>}
      </div>
    </fieldset>
    <Field label={t('teams.lead')}>{props => <Choice {...props} value={leadAgentId ?? ''} disabled={!memberIds.length} onValueChange={selectedValue => setLead(selectedValue || null)}><ChoiceOption value="">{t('none')}</ChoiceOption>{agents.filter(agent => memberIds.includes(agent.id)).map(agent => <ChoiceOption key={agent.id} value={agent.id}>{agent.name}</ChoiceOption>)}</Choice>}</Field>
  </AdminDialog>;
}

function DeleteTeam({ team, close, submit, stale }: { team: ProjectTeam; close: () => void; submit: Submit; stale: boolean }) {
  const t = useAgentLabels();
  const writer = useWriteFeedback(submit);
  return <AdminDialog title={t('delete')} description={t('teams.deleteHelp', { name: team.name })} close={close} busy={writer.busy} onSubmit={() => { if (!stale) void writer.run(() => agentTeamsDelete({ projectId: team.projectId, teamId: team.id, expectedRevision: team.revision }), close); }} footer={<DialogButtons close={close} label={t('delete')} busy={writer.busy} destructive disabled={stale} />}>
    <ErrorText error={writer.error} />{stale && <p role="status" className="text-sm text-muted-foreground">{t('errors.conflict')}</p>}
  </AdminDialog>;
}
