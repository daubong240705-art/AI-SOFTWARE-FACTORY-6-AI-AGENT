import { useCallback, useEffect, useReducer, useState } from 'react';
import { agentsClonePayloadSchema, type AgentSummary } from '@factory/contracts';
import { Bot, Ellipsis, Plus, Star } from 'lucide-react';
import { ApiClientError, createApiClient } from '@/api/client';
import { agentsClone, agentsDelete, agentsSetLead, agentsSetStatus } from '@/api/commands';
import { openProjectEvents } from '@/api/events';
import { Page } from '@/components/Page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { AgentEditor } from './AgentEditor';
import { RelationsPanel } from './RelationsPanel';
import { TeamsPanel } from './TeamsPanel';
import { TemplateDialog, type TemplateDraft } from './TemplateDialog';
import { AdminDialog, Choice, DialogButtons, ErrorText, Field, ReadStatus, useAgentLabels, useAgentWrite, useRead, useWriteFeedback, type Submit } from './shared';

const baseUrl = import.meta.env.DEV ? '/api' : '';
const filters = ['active', 'paused', 'archived', 'all'] as const;
type Action = 'clone' | 'archive' | 'delete';
type DialogState = { kind: 'new'; draft?: TemplateDraft } | { kind: 'template' } | { kind: 'edit'; agent: AgentSummary } | { kind: Action; agent: AgentSummary };

export function ProjectAgents({ projectId }: { projectId: string }) {
  const t = useAgentLabels();
  const [api] = useState(() => createApiClient({ baseUrl }));
  const [filter, setFilter] = useState<typeof filters[number]>('all');
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [refreshKey, refresh] = useReducer((value: number) => value + 1, 0);
  const [eventKey, reconnect] = useReducer((value: number) => value + 1, 0);
  const read = useCallback((signal: AbortSignal) => api.listProjectAgents(projectId, signal), [api, projectId]);
  const roster = useRead(read, refreshKey);
  const data = roster.data;
  const agentId = dialog?.kind === 'edit' ? dialog.agent.id : null;
  const readDetail = useCallback((signal: AbortSignal) => api.getAgent(projectId, agentId!, signal), [api, projectId, agentId]);
  const detail = useRead(agentId ? readDetail : null, refreshKey);
  const submit = useAgentWrite(api, refresh);
  const direct = useWriteFeedback(submit);
  const streaming = !!data;
  useEffect(() => {
    if (!streaming || typeof EventSource === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stream = openProjectEvents({ projectId, baseUrl,
      onEvent: ({ payload }) => {
        if (payload.type !== 'entity.changed' || !['seat', 'team'].includes(payload.entity.kind)) return;
        clearTimeout(timer); timer = setTimeout(refresh, 100);
      },
      onSnapshotRequired: () => { refresh(); reconnect(); },
    });
    return () => { clearTimeout(timer); stream.close(); };
  }, [projectId, eventKey, streaming]);

  const close = () => setDialog(null);
  const updateStatus = (agent: AgentSummary, status: 'active' | 'paused') => void direct.run(() => agentsSetStatus({ projectId, agentId: agent.id, expectedRevision: agent.revision, status }));
  const visible = data?.agents.filter(agent => filter === 'all' || agent.status === filter) ?? [];
  const teamNames = new Map(data?.teams.map(team => [team.id, team.name]));
  const olderHost = !data && roster.error instanceof ApiClientError && roster.error.status === 404;
  const editGone = detail.error instanceof ApiClientError && detail.error.status === 404;

  return <Page className="space-y-5 px-4 py-5 sm:px-8">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-xl font-semibold"><Bot className="size-5 text-muted-foreground" aria-hidden="true" />{t('title')}</h2>
        {data && <p className="mt-1 text-sm text-muted-foreground">{t('counts', { total: data.agents.length, active: data.agents.filter(agent => agent.status === 'active').length, teams: data.teams.length })}</p>}
      </div>
      {data && <div className="flex flex-wrap gap-2"><Button type="button" onClick={() => setDialog({ kind: 'new' })}><Plus aria-hidden="true" />{t('create')}</Button><Button type="button" variant="outline" onClick={() => setDialog({ kind: 'template' })}>{t('fromTemplate')}</Button></div>}
    </header>
    {olderHost ? <div className="rounded-xl border border-border bg-card/60 p-8 text-center text-muted-foreground"><p>{t('errors.olderHost')}</p><Button className="mt-3" type="button" variant="outline" onClick={refresh}>{t('reload')}</Button></div> :
      <><ReadStatus loading={!data && roster.loading} error={roster.error} />{roster.error && <Button type="button" variant="outline" onClick={refresh}>{t('reload')}</Button>}</>}
    <ErrorText error={direct.error} />
    {data && <>
      <section className="space-y-3 rounded-xl border border-border bg-card/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{t('agents')}</h3><Choice className="w-auto" aria-label={t('filter')} value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>{filters.map(value => <option key={value} value={value}>{t(`status.${value}`)}</option>)}</Choice></div>
        {!visible.length && <p className="rounded-lg border border-dashed border-border px-4 py-7 text-center text-sm text-muted-foreground">{t(data.agents.length ? 'emptyFilter' : 'emptyAgents')}</p>}
        <ul className="grid gap-2">{visible.map(agent => <li key={agent.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-lg border border-border bg-background/60 p-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2"><strong className="break-all">{agent.name}</strong>{agent.isLead && <span className="inline-flex items-center gap-1 text-xs font-medium"><Star className="size-3 fill-current" aria-hidden="true" />{t('lead')}</span>}<Badge variant={agent.status === 'active' ? 'secondary' : 'outline'}>{t(`status.${agent.status}`)}</Badge></div>
            <p className="break-words text-sm text-muted-foreground">{agent.role} · {agent.adapter} / {agent.model ?? t('default')} · {t('live', { count: agent.live })}</p>
            {!!agent.teamIds.length && <div className="flex flex-wrap gap-1">{agent.teamIds.map(id => <Badge key={id} variant="outline" className="max-w-full truncate">{teamNames.get(id) ?? id}</Badge>)}</div>}
            {agent.template && <p className="text-xs text-muted-foreground">{t(agent.template.latestRevision > agent.template.revision ? 'templateUpdate' : 'templateLink', { revision: agent.template.revision, latest: agent.template.latestRevision })}</p>}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button type="button" size="icon" variant="ghost" aria-label={t('actions', { name: agent.name })} disabled={direct.busy || !!roster.error}><Ellipsis aria-hidden="true" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setDialog({ kind: 'edit', agent })}>{t('edit')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog({ kind: 'clone', agent })}>{t('clone')}</DropdownMenuItem>
              <DropdownMenuItem disabled={agent.isLead || agent.status !== 'active'} onSelect={() => void direct.run(() => agentsSetLead({ projectId, agentId: agent.id, expectedRevision: agent.revision }))}>{t('makeLead')}</DropdownMenuItem>
              {agent.status !== 'pending-approval' && <DropdownMenuItem onSelect={() => updateStatus(agent, agent.status === 'active' ? 'paused' : 'active')}>{t(agent.status === 'active' ? 'pause' : 'activate')}</DropdownMenuItem>}
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={agent.status === 'archived'} onSelect={() => setDialog({ kind: 'archive', agent })}>{t('archive')}</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setDialog({ kind: 'delete', agent })}>{t('delete')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </li>)}</ul>
      </section>
      <TeamsPanel projectId={projectId} data={data} submit={submit} />
      <RelationsPanel projectId={projectId} data={data} submit={submit} refreshing={roster.loading} />
    </>}
    {dialog?.kind === 'new' && <AgentEditor api={api} projectId={projectId} {...dialog.draft} close={close} submit={submit} refresh={refresh} />}
    {dialog?.kind === 'template' && <TemplateDialog api={api} close={close} start={draft => setDialog({ kind: 'new', draft })} />}
    {dialog?.kind === 'edit' && (detail.data && !editGone ? <AgentEditor api={api} projectId={projectId} detail={detail.data} close={close} submit={submit} refresh={refresh} loading={detail.loading || !!detail.error} readError={detail.error} /> :
      <AdminDialog title={`${t('edit')}: ${dialog.agent.name}`} description={t('editorHelp')} close={close}><ReadStatus loading={detail.loading} error={detail.error} />{detail.error && <Button type="button" variant="outline" onClick={refresh}>{t('reload')}</Button>}</AdminDialog>)}
    {dialog && (dialog.kind === 'clone' || dialog.kind === 'archive' || dialog.kind === 'delete') && <ActionDialog action={dialog.kind} agent={dialog.agent} current={data?.agents.find(agent => agent.id === dialog.agent.id)} close={close} submit={submit} />}
  </Page>;
}

function ActionDialog({ action, agent, current, close, submit }: { action: Action; agent: AgentSummary; current: AgentSummary | undefined; close: () => void; submit: Submit }) {
  const t = useAgentLabels();
  const writer = useWriteFeedback(submit);
  const [name, setName] = useState('');
  const [invalid, setInvalid] = useState(false);
  const stale = !current || current.revision !== agent.revision;
  function save() {
    if (stale) return;
    if (action === 'clone') {
      if (!agentsClonePayloadSchema.shape.name.safeParse(name).success) { setInvalid(true); return; }
      void writer.run(() => agentsClone({ projectId: agent.projectId, sourceAgentId: agent.id, name: name.trim() }), close);
    } else {
      const target = { projectId: agent.projectId, agentId: agent.id, expectedRevision: agent.revision };
      void writer.run(() => action === 'delete' ? agentsDelete(target) : agentsSetStatus({ ...target, status: 'archived' }), close);
    }
  }
  return <AdminDialog title={t(action)} description={t(`${action}Help`, { name: agent.name })} close={close} busy={writer.busy} onSubmit={save} footer={<DialogButtons close={close} label={t(action)} busy={writer.busy} disabled={stale} destructive={action === 'delete'} />}>
    <ErrorText error={writer.error} />
    {stale && <p role="status" className="text-sm text-muted-foreground">{t(current ? 'errors.conflict' : 'errors.missing')}</p>}
    {action === 'clone' && <Field label={t('fields.name')} invalid={invalid ? t('invalid') : undefined}>{props => <Input {...props} value={name} maxLength={80} onChange={event => { setName(event.target.value); setInvalid(false); }} />}</Field>}
  </AdminDialog>;
}
