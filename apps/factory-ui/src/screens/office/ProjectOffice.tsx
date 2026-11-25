import { useEffect, useState } from 'react';
import { ArrowUpRight, Coffee, GitBranch, Inbox, Users } from 'lucide-react';
import { createApiClient } from '@/api/client';
import type { OrgActivity } from '@/api/activityModels';
import type { ActivityRun } from '@/api/activityModels';
import type { AgentProjectResponse } from '@/api/agentModels';
import { AgentMascot, AgentMascotProvider } from '@/components/mascot/AgentMascot';
import { Page } from '@/components/Page';
import { LoadingState } from '@/components/LoadingState';
import { Button } from '@/components/ui/button';
import { i18n, useT } from '@/i18n';
import type { Store } from '@/state/store';
import { attentionHash } from '../Attention';
import { TaskDetail } from '../TaskDetail';
import { openFlowRoute } from '../shell/navigation';
import { createWorldPoller } from '../world/data/poller';
import { desksFor, isActiveRun, runTitle, type Desk, type FlowList, type ProjectAttempt, type ProjectInbox } from './liveModel';
import './office.css';

type Snapshot = { roster?: AgentProjectResponse; attempts?: ProjectAttempt[]; inbox?: ProjectInbox; flows?: FlowList; activity?: OrgActivity };
const api = createApiClient({ baseUrl: import.meta.env.DEV ? '/api' : '' });
const mascot = { working: 'working', waiting: 'attention', idle: 'idle', paused: 'offline', problem: 'error' } as const;

function AgentDesk({ desk, roster, onTask }: { desk: Desk; roster: AgentProjectResponse; onTask: (id: string) => void }) {
  const t = useT(); const { agent, status, task, progress, today } = desk;
  const relations = roster.relations.filter(edge => edge.from === agent.id || edge.to === agent.id).flatMap(edge => {
    const other = roster.agents.find(item => item.id === (edge.from === agent.id ? edge.to : edge.from));
    return other ? [{ edge, other }] : [];
  });
  return <article className="universal-desk" data-status={status} data-lead={agent.isLead} tabIndex={0} aria-label={agent.name}>
    <div className="flex min-w-0 items-start gap-3"><AgentMascot agent={agent} state={mascot[status]} size={48} animated />
      <div className="min-w-0 flex-1"><h3 className="break-words font-semibold">{agent.name}</h3><p className="break-words text-xs">{agent.role}</p></div>
      <span className="desk-status">{t(`officeUi.floorLive.status.${status}`)}</span>
    </div>
    <p className="desk-chip" title={[agent.adapter, agent.model].filter(Boolean).join(' / ')}>{[agent.adapter, agent.model].filter(Boolean).join(' / ')}</p>
    {task ? <button className="desk-task" type="button" onClick={() => onTask(task.id)}><span className="line-clamp-2 text-left">{task.title}</span><ArrowUpRight className="size-4 shrink-0" /></button>
      : <p className="text-sm opacity-75">{t('officeUi.floorLive.noTask')}</p>}
    <p className="line-clamp-2 break-words text-xs opacity-80">{progress?.message || t('officeUi.floorLive.noProgress')}</p>
    <div className="desk-history"><span>{t('officeUi.floorLive.today')} · {today.length}</span><ol className="flex flex-wrap gap-1" aria-label={t('officeUi.floorLive.today')}>
      {[...today].reverse().map(attempt => {
        const label = `${attempt.startedAt ? new Intl.DateTimeFormat(i18n.locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(attempt.startedAt)) + ' · ' : ''}${attempt.taskTitle} · ${t(`workUi.states.${attempt.state}`)}`;
        return <li key={attempt.id}><button type="button" className="desk-tick" data-state={attempt.state} title={label} aria-label={label} onClick={() => onTask(attempt.taskId)} /></li>;
      })}
    </ol></div>
    {relations.length > 0 && <div className="desk-relations" aria-label={t('officeUi.floorLive.relations')}>{relations.map(({ edge, other }) => <span key={`${edge.from}:${edge.to}:${edge.kind}`}>{edge.from === agent.id ? '→' : '←'} {t(`officeUi.floorLive.relation.${edge.kind}`)} · {other.name}</span>)}</div>}
  </article>;
}

export function ProjectOffice({ store, projectId, onOpenTab }: { store: Store; projectId: string; onOpenTab: (tab: 'agents') => void }) {
  const t = useT();
  const [snapshot, setSnapshot] = useState<Snapshot>({});
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [retry, setRetry] = useState(0);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [reported, setReported] = useState<Record<string, NonNullable<ActivityRun['progress']>>>({});
  const tasks = store.useStoreSelector(state => state.tasks);
  const taskError = store.useStoreSelector(state => state.errors.tasks);
  useEffect(() => {
    const poller = createWorldPoller({ hidden: () => document.hidden, onError: key => setFailed(old => new Set(old).add(key)) });
    function read<Key extends keyof Snapshot>(key: Key, interval: number, load: (signal: AbortSignal) => Promise<NonNullable<Snapshot[Key]>>) {
      return { key, interval, async run(signal: AbortSignal) {
        const result = await load(signal);
        if (signal.aborted) return;
        setSnapshot(old => ({ ...old, [key]: result }));
        setFailed(old => { if (!old.has(key)) return old; const next = new Set(old); next.delete(key); return next; });
      } };
    }
    poller.sync([
      read('roster', 10000, signal => api.listProjectAgents(projectId, signal)),
      read('attempts', 6000, () => api.listProjectAttempts(projectId, { limit: 500 }).then(result => result.attempts)),
      read('inbox', 6000, () => api.getInbox(projectId)),
      read('flows', 6000, signal => api.listProjectFlows(projectId, signal)),
      read('activity', 6000, api.getOrgActivity),
      { key: 'tasks', interval: 8000, run: async () => { await store.loadTasks(); } },
    ]);
    const visibility = () => poller.visibility();
    document.addEventListener('visibilitychange', visibility);
    return () => { poller.stop(); document.removeEventListener('visibilitychange', visibility); };
  }, [projectId, retry, store]);
  const { roster, attempts, inbox, flows, activity } = snapshot;
  const desks = roster ? desksFor(roster, tasks, attempts ?? [], inbox, activity, Date.now(), reported) : [];
  const watchAttempts = desks.flatMap(desk => {
    const attempt = desk.live[0] ?? desk.today[0];
    return attempt ? [attempt.id] : [];
  }).sort().join(' ');
  useEffect(() => {
    if (!watchAttempts) return;
    const ids = watchAttempts.split(' ');
    const poller = createWorldPoller({ hidden: () => document.hidden, maxConcurrent: 6, onError: () => {} });
    poller.sync(ids.map(id => {
      let cursor = 0;
      return { key: id, interval: 6000, async run(signal: AbortSignal) {
        const { events } = await api.listAttemptEvents(projectId, id, { afterSeq: cursor, limit: 500 }, signal);
        if (signal.aborted) return;
        for (const event of events) cursor = Math.max(cursor, event.seq);
        const last = events.findLast(event => {
          if (event.kind !== 'progress' || !event.body || typeof event.body !== 'object' || !('message' in event.body) || typeof event.body.message !== 'string') return false;
          const message = event.body.message.trim();
          return message && !/^(working$|starting$|tool:|tool failed:)/i.test(message);
        });
        if (last) setReported(old => ({ ...old, [id]: { message: (last.body as { message: string }).message, at: last.at, percent: null } }));
      } };
    }));
    const visibility = () => poller.visibility();
    document.addEventListener('visibilitychange', visibility);
    return () => { poller.stop(); document.removeEventListener('visibilitychange', visibility); };
  }, [projectId, watchAttempts]);
  const head = desks.filter(desk => desk.agent.isLead);
  const areas = new Map<string, { title: string; desks: Desk[] }>();
  for (const desk of desks.filter(item => !item.agent.isLead)) {
    const key = desk.team?.id ?? '';
    const area = areas.get(key) ?? { title: desk.team?.name ?? t('officeUi.floorLive.common'), desks: [] };
    area.desks.push(desk); areas.set(key, area);
  }
  const runs = flows?.runs.filter(isActiveRun) ?? [];
  const approvals = [...(inbox?.approvals ?? []).filter(item => item.state === 'requested' || item.state === 'pending').map(item => ({ key: `approval:${item.id}`, title: item.subject })),
    ...(inbox?.startGates ?? []).map(item => ({ key: `gate:${item.taskId}`, title: item.title }))];
  const renderDesk = (desk: Desk) => <AgentDesk key={desk.agent.id} desk={desk} roster={roster!} onTask={setSelectedTask} />;
  return <AgentMascotProvider api={api} agents={roster?.agents}><Page><section className="universal-office">
    <header className="office-mast"><div><p className="text-xs font-semibold uppercase tracking-widest">{t('projectUi.office')}</p><h2 className="font-display text-3xl font-semibold">{t('officeUi.floorLive.title')}</h2><p className="mt-1 text-sm">{t('officeUi.floorLive.subtitle')}</p></div><Coffee aria-hidden="true" className="size-10 shrink-0" /></header>
    {(failed.size > 0 || taskError) && <div role="status" className="office-refresh">{t('officeUi.floorLive.unavailable')}<Button type="button" size="sm" variant="outline" onClick={() => setRetry(value => value + 1)}>{t('worldUi.retry')}</Button></div>}
    <div className="office-plan"><div className="office-floor-live">
      {!roster ? failed.has('roster') ? null : <LoadingState inline /> : !desks.length ? <div className="office-vacant"><Users className="mb-3 size-7" /><h3 className="font-semibold">{t('officeUi.floorLive.empty')}</h3><p className="my-2 text-sm">{t('officeUi.floorLive.emptyHelp')}</p><Button onClick={() => onOpenTab('agents')}>{t('projectUi.agents')} <ArrowUpRight className="size-4" /></Button></div> : <>
        {head.length > 0 && <section className="office-area"><h3>{t('officeUi.floorLive.head')}{head[0]?.team ? ` · ${head[0].team.name}` : ''}</h3><div className="office-desks">{head.map(renderDesk)}</div></section>}
        {[...areas].map(([key, area]) => <section key={key} className="office-area"><h3>{area.title}</h3><div className="office-desks">{area.desks.map(renderDesk)}</div></section>)}
      </>}
    </div><aside className="office-strip">
      <section><h3><GitBranch className="size-4" />{t('officeUi.floorLive.flows')}</h3>{!flows ? failed.has('flows') ? <p>{t('officeUi.floorLive.unavailable')}</p> : <LoadingState inline /> : runs.length ? <ul>{runs.map(run => <li key={run.id}><button type="button" onClick={() => openFlowRoute(projectId, { kind: 'runs', id: run.id })}><span>{runTitle(run)}</span><small>{t(`flowsUi.state.${run.state}`)}</small></button></li>)}</ul> : <p>{t('officeUi.floorLive.noFlows')}</p>}</section>
      <section><h3><Inbox className="size-4" />{t('officeUi.floorLive.approvals')}</h3>{!inbox ? failed.has('inbox') ? <p>{t('officeUi.floorLive.unavailable')}</p> : <LoadingState inline /> : approvals.length ? <ul>{approvals.map(item => <li key={item.key}><a href={attentionHash(item.key)}>{item.title} <ArrowUpRight className="size-4 shrink-0" /></a></li>)}</ul> : <p>{t('officeUi.floorLive.noApprovals')}</p>}</section>
    </aside></div>
    {selectedTask && <TaskDetail key={selectedTask} store={store} taskId={selectedTask} onClose={() => setSelectedTask(null)} />}
  </section></Page></AgentMascotProvider>;
}
