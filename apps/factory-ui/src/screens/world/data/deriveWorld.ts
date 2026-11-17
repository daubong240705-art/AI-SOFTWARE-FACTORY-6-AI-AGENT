import { meaningfulOfficeItems } from '../../../api/officeModels';
import type { Interaction } from '../../../api/officeModels';
import type { Task } from '@factory/contracts';
import { classifyPod } from './classify';
import { assignDesks } from './assignDesks';
import type { Assignments, Bug, Endpoint, GalleryItem, Handoff, TaskCard, WorldAgent, WorldInputs, WorldModel } from './types';
const columns = ['todo', 'doing', 'review', 'failed', 'done'] as const;
const poses = { working: 'working', queued: 'thinking', waiting: 'attention', problem: 'error', done: 'success', idle: 'idle' } as const;
const time = (at: string) => Date.parse(at);
const newest = <T extends {
  updatedAt: string;
}>(a: T, b: T) => time(b.updatedAt) - time(a.updatedAt) || a.updatedAt.localeCompare(b.updatedAt);
/** Deterministic across polls, input order and JavaScript processes. */
export function criterionHash(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
function column(task: Task): TaskCard['column'] | null {
  if (task.disposition !== 'active')
    return null;
  if (task.state === 'in-review' || task.holds.some(h => h.needsAction))
    return 'review';
  if (['proposed', 'accepted', 'ready', 'awaiting-go'].includes(task.state))
    return 'todo';
  if (task.state === 'active')
    return 'doing';
  if (task.state === 'failed' || task.state === 'done')
    return task.state;
  return null;
}
function handoff(item: Interaction, projectId: string): Handoff | null {
  let from: Endpoint;
  let to: Endpoint;
  if (['handoff', 'request', 'assign'].includes(item.kind) && item.from.kind === 'seat' && item.to?.kind === 'seat') {
    from = { kind: 'seat', seatId: item.from.seatId };
    to = { kind: 'seat', seatId: item.to.seatId };
  }
  else if (['question', 'review', 'start-gate'].includes(item.kind) && item.from.kind === 'seat') {
    from = { kind: 'seat', seatId: item.from.seatId };
    to = { kind: 'owner' };
  }
  else if (['answer', 'rework', 'message'].includes(item.kind) && item.from.kind === 'operator' && item.to?.kind === 'seat') {
    from = { kind: 'owner' };
    to = { kind: 'seat', seatId: item.to.seatId };
  }
  else if (item.kind === 'output' && item.from.kind === 'seat') {
    from = { kind: 'seat', seatId: item.from.seatId };
    to = { kind: 'knowledge' };
  }
  else
    return null; // finished/failed remain badges on the seat, never flights.
  return { id: `${projectId}:${item.id}`, projectId, at: item.at, kind: item.kind, from, to, code: item.code, text: item.text };
}
export function deriveWorld(inputs: WorldInputs, prevAssign: Assignments = {}): {
  model: WorldModel;
  assign: Assignments;
} {
  const generatedAt = inputs.activity?.generatedAt ?? inputs.serverNow ?? '';
  const games = [...(inputs.games?.games ?? [])].sort((a, b) => newest(a, b) || a.projectId.localeCompare(b.projectId));
  const agents: WorldAgent[] = [];
  for (const team of inputs.activity?.teams ?? []) {
    const org = inputs.teams?.teams.find(t => t.id === team.id);
    if (team.lifecycle === 'archived' || org?.lifecycle === 'archived')
      continue;
    for (const seat of team.seats) {
      let pose: WorldAgent['pose'] = poses[seat.status];
      if (org?.lifecycle === 'paused' || team.lifecycle === 'paused' || seat.status === 'idle' && (!seat.lastFinished?.at || time(generatedAt) - time(seat.lastFinished.at) >= 900000))
        pose = 'resting';
      agents.push({ seatId: seat.id, teamId: team.id, name: seat.name, role: seat.role, isLead: seat.isLead, slots: seat.slots, status: seat.status, pose, podKey: classifyPod(seat, org), slotIndex: 0, runs: seat.runs, queued: seat.queued, needsYou: seat.needsYou, lastFinished: seat.lastFinished, overflow: false });
    }
  }
  agents.sort((a, b) => a.seatId.localeCompare(b.seatId));
  const assign = assignDesks(agents, prevAssign);
  for (const agent of agents)
    Object.assign(agent, assign[agent.seatId]);
  const liveProjects = new Set(agents.flatMap(a => a.runs.filter(r => ['queued', 'leased', 'preparing', 'running', 'waiting-input', 'stopping', 'submitting'].includes(r.attemptState)).map(r => r.projectId)));
  const hotProjects = games.filter(g => liveProjects.has(g.projectId) || g.workflow && ['active', 'awaiting-approval', 'stalled', 'paused'].includes(g.workflow.state)).slice(0, 3);
  const focusProjectId = inputs.focusProjectId ?? hotProjects[0]?.projectId ?? games[0]?.projectId ?? null;
  const detail = focusProjectId ? inputs.workflows[focusProjectId] : undefined;
  const workflow = detail?.id === games.find(g => g.projectId === focusProjectId)?.workflow?.instanceId ? detail : undefined;
  const stages = (workflow?.stages ?? []).map(s => ({ key: s.key, state: s.state, loopCount: s.loopCount ?? 0 }));
  const order = new Map((workflow?.stages ?? []).flatMap((s, i) => s.tasks.map(t => [t.taskId, i] as const)));
  const taskColumns: Record<TaskCard['column'], TaskCard[]> = { todo: [], doing: [], review: [], failed: [], done: [] };
  for (const task of focusProjectId ? inputs.tasks[focusProjectId] ?? [] : []) {
    const c = column(task);
    if (c)
      taskColumns[c].push({ id: `${task.projectId}:${task.id}`, projectId: task.projectId, taskId: task.id, code: task.code, title: task.title, column: c });
  }
  const overflow = Object.fromEntries(columns.map(c => [c, Math.max(0, taskColumns[c].length - 6)])) as Record<TaskCard['column'], number>;
  for (const c of columns) {
    taskColumns[c].sort((a, b) => (order.get(a.taskId) ?? -1) - (order.get(b.taskId) ?? -1) || a.code.localeCompare(b.code));
    taskColumns[c] = c === 'done' ? taskColumns[c].slice(-6) : taskColumns[c].slice(0, 6);
  }
  const handoffs = Object.entries(inputs.interactions).flatMap(([id, o]) => meaningfulOfficeItems(o?.items ?? []).flatMap(item => { const h = handoff(item, id); return h ? [h] : []; })).sort((a, b) => time(a.at) - time(b.at) || a.id.localeCompare(b.id));
  const bugs: Bug[] = [];
  for (const game of games) {
    const rounds = [...(inputs.reports[game.projectId]?.qaRounds ?? [])].sort((a, b) => a.iteration - b.iteration);
    const latest = rounds.at(-1);
    if (!latest || latest.verdict === 'passed')
      continue;
    const failed = latest.verdict === 'running' ? rounds.slice(0, -1).reverse().find(r => r.verdict !== 'running') : latest;
    if (failed?.verdict !== 'changes-requested')
      continue;
    for (const c of failed.criteria.filter(c => c.passed === false)) {
      const id = `${game.projectId}:${criterionHash(c.criterion)}`;
      if (!bugs.some(b => b.id === id))
        bugs.push({ id, projectId: game.projectId, criterion: c.criterion, evidence: c.evidence, state: latest.verdict === 'running' ? 'retesting' : 'open' });
    }
  }
  const gallery: (GalleryItem & {
    at: string;
  })[] = [];
  for (const game of games) {
    const releases = (inputs.releases[game.projectId]?.releases ?? []).filter(r => r.kind === 'publish').sort((a, b) => time(b.createdAt) - time(a.createdAt));
    const lastDone = releases.find(r => r.state === 'done');
    const portal = inputs.portal?.configured ? inputs.portalGames?.games.find(g => g.id === game.gameId) : undefined;
    const live = inputs.portal?.configured ? inputs.portalStats?.live.byGame[game.gameId] : undefined;
    for (const release of releases) {
      if (release.state !== 'done' && release.state !== 'pending' && !(release.state === 'failed' && (!lastDone || time(release.createdAt) > time(lastDone.createdAt))))
        continue;
      gallery.push({ projectId: game.projectId, gameId: game.gameId, name: game.name, version: release.version, playUrl: release.playUrl, state: release.state as GalleryItem['state'], current: release.state === 'done' && release.version !== null && portal?.currentVersion === release.version, enabled: portal?.enabled ?? null, playing: live?.playing ?? null, releaseId: release.id, at: release.completedAt ?? release.createdAt });
    }
  }
  gallery.sort((a, b) => time(b.at) - time(a.at) || a.releaseId.localeCompare(b.releaseId));
  const releaseVersions: WorldModel['releaseVersions'] = {};
  for (const r of gallery)
    if (r.state === 'done' && r.version !== null && r.version > (releaseVersions[r.projectId]?.version ?? 0))
      releaseVersions[r.projectId] = { projectId: r.projectId, version: r.version, releaseId: r.releaseId, at: r.at };
  const gameIds = new Set(games.map(g => g.projectId));
  const loaded = { activity: !!inputs.activity, teams: !!inputs.teams, games: !!inputs.games, interactions: Object.keys(inputs.interactions).filter(k => !!inputs.interactions[k]), reports: Object.keys(inputs.reports).filter(k => gameIds.has(k) && !!inputs.reports[k]), releases: Object.keys(inputs.releases).filter(k => gameIds.has(k) && !!inputs.releases[k]) };
  const configured = inputs.portal?.configured === true;
  let completedCount = 0;
  const displayGallery = gallery.filter(item => item.state !== 'done' || completedCount++ < 9)
    .map(({at: _, ...item}) => item);
  const portal = {
    configured,
    onlineUsers: configured ? inputs.portalStats?.live.onlineUsers ?? null : null,
    booths: configured ? (inputs.portalGames?.games ?? []).flatMap(game => {
      const stats = inputs.portalStats?.live.byGame[game.id];
      return stats ? [{gameId: game.id, name: game.name, rooms: stats.rooms, playing: stats.playing}] : [];
    }) : [],
  };
  return {
    assign,
    model: {
      generatedAt, loaded, releaseVersions, bugIds: bugs.map(bug => bug.id),
      agents, hotProjects, focusProjectId, tasks: {columns: taskColumns, overflow},
      stages, handoffs, bugs: bugs.slice(0, 12), bugOverflow: Math.max(0, bugs.length - 12),
      gallery: displayGallery, portal,
    },
  };
}
