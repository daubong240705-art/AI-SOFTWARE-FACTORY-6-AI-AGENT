import { meaningfulOfficeItems } from '../../../api/officeModels';
import type { Interaction } from '../../../api/officeModels';
import type { Task } from '@factory/contracts';
import type { ActivitySeat } from '../../../api/activityModels';
import { classifyPod } from './classify';
import { assignDesks } from './assignDesks';
import type { Assignments, Endpoint, Handoff, TaskCard, WorldAgent, WorldInputs, WorldModel } from './types';
const columns = ['todo', 'doing', 'review', 'failed', 'done'] as const;
const poses = { working: 'working', queued: 'thinking', waiting: 'attention', problem: 'error', done: 'success', idle: 'idle' } as const;
const time = (at: string) => Date.parse(at);
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
  return { id: `${projectId}:${item.id}`, taskId: item.taskId, projectId, at: item.at, kind: item.kind, from, to, code: item.code, text: item.text };
}
type Worker = { id: string; slot: number; status: ActivitySeat['status']; runs: ActivitySeat['runs']; queued: number; needsYou: ActivitySeat['needsYou'] };
/** Splits a seat into one worker per slot (at most 4). Each run keeps the worker it had on the last poll; the seat-level state
 * that belongs to no run (an unmatched question, a problem, queued work) goes to the first worker without a run. */
export function splitSeat(seat: ActivitySeat, previous: Assignments): Worker[] {
  const count = Math.min(4, Math.max(1, seat.slots));
  const workers: Worker[] = Array.from({ length: count }, (_, slot) => ({ id: slot ? `${seat.id}#${slot + 1}` : seat.id, slot, status: 'idle', runs: [], queued: 0, needsYou: [] }));
  const runs = [...seat.runs].sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? '') || a.attemptId.localeCompare(b.attemptId));
  const pending: ActivitySeat['runs'] = [];
  for (const run of runs) {
    const kept = workers.find(w => !w.runs.length && previous[w.id]?.run === run.attemptId);
    if (kept) kept.runs = [run]; else pending.push(run);
  }
  for (const run of pending) {
    const free = workers.find(w => !w.runs.length);
    if (free) free.runs = [run]; else workers[0]!.runs = [...workers[0]!.runs, run];
  }
  const matched = new Set<string>();
  for (const worker of workers) {
    if (!worker.runs.length) continue;
    worker.needsYou = seat.needsYou.filter(need => worker.runs.some(run => run.taskId === need.taskId));
    worker.needsYou.forEach(need => matched.add(need.approvalId));
    worker.status = worker.needsYou.length ? 'waiting' : 'working';
  }
  const holder = workers.find(w => !w.runs.length) ?? workers[0]!;
  const unmatched = seat.needsYou.filter(need => !matched.has(need.approvalId));
  holder.needsYou = [...holder.needsYou, ...unmatched];
  holder.queued = seat.queued;
  if (unmatched.length) holder.status = 'waiting';
  else if (!seat.runs.length) holder.status = seat.status; // nothing to split: the seat's own state stays on its first worker
  else if (!holder.runs.length && (['problem', 'done', 'queued'] as const).some(state => state === seat.status)) holder.status = seat.status;
  return workers;
}
export function deriveWorld(inputs: WorldInputs, prevAssign: Assignments = {}): {
  model: WorldModel;
  assign: Assignments;
} {
  const generatedAt = inputs.activity?.generatedAt ?? inputs.serverNow ?? '';
  const projects = (inputs.projects ?? []).filter(project => project.disposition !== 'archived').sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  const agents: WorldAgent[] = [];
  const runOf = new Map<string, string | undefined>();
  for (const team of inputs.activity?.teams ?? []) {
    if (team.lifecycle === 'archived')
      continue;
    for (const seat of team.seats) {
      const paused = team.lifecycle === 'paused';
      const podKey = classifyPod(seat);
      for (const worker of splitSeat(seat, prevAssign)) {
        let pose: WorldAgent['pose'] = poses[worker.status];
        if (paused || worker.status === 'idle' && (!seat.lastFinished?.at || time(generatedAt) - time(seat.lastFinished.at) >= 900000))
          pose = 'resting';
        agents.push({ paused, seatId: worker.id, ownerSeatId: seat.id, seatName: seat.name, slot: worker.slot, teamId: team.id, teamName: team.name, name: worker.slot ? `${seat.name} #${worker.slot + 1}` : seat.name, role: seat.role, isLead: seat.isLead, slots: seat.slots, status: worker.status, pose, podKey, slotIndex: 0, runs: worker.runs, queued: worker.queued, needsYou: worker.needsYou, lastFinished: worker.slot ? null : seat.lastFinished, overflow: false });
        runOf.set(worker.id, worker.runs[0]?.attemptId);
      }
    }
  }
  agents.sort((a, b) => a.seatId.localeCompare(b.seatId));
  const desks = assignDesks(agents, prevAssign);
  const assign: Assignments = {};
  for (const agent of agents) {
    const desk = desks[agent.seatId]!; const run = runOf.get(agent.seatId);
    assign[agent.seatId] = { podKey: desk.podKey, slotIndex: desk.slotIndex, overflow: desk.overflow, ...(run === undefined ? {} : { run }) };
    agent.podKey = desk.podKey; agent.slotIndex = desk.slotIndex; agent.overflow = desk.overflow;
  }
  const liveProjects = new Set(agents.flatMap(a => a.runs.filter(r => ['queued', 'leased', 'preparing', 'running', 'waiting-input', 'stopping', 'submitting'].includes(r.attemptState)).map(r => r.projectId)));
  const hotProjects = projects.filter(project => liveProjects.has(project.id)).slice(0, 3);
  const focusProjectId = (projects.some(project => project.id === inputs.focusProjectId) ? inputs.focusProjectId : null) ?? hotProjects[0]?.id ?? projects[0]?.id ?? null;
  const taskColumns: Record<TaskCard['column'], TaskCard[]> = { todo: [], doing: [], review: [], failed: [], done: [] };
  for (const task of focusProjectId ? inputs.tasks[focusProjectId] ?? [] : []) {
    const c = column(task);
    if (c)
      taskColumns[c].push({ id: `${task.projectId}:${task.id}`, projectId: task.projectId, taskId: task.id, code: task.code, title: task.title, column: c });
  }
  const overflow = Object.fromEntries(columns.map(c => [c, Math.max(0, taskColumns[c].length - 6)])) as Record<TaskCard['column'], number>;
  for (const c of columns) {
    taskColumns[c].sort((a, b) => a.code.localeCompare(b.code));
    taskColumns[c] = c === 'done' ? taskColumns[c].slice(-6) : taskColumns[c].slice(0, 6);
  }
  const handoffs = Object.entries(inputs.interactions).flatMap(([id, o]) => meaningfulOfficeItems(o?.items ?? []).flatMap(item => { const h = handoff(item, id); return h ? [h] : []; })).sort((a, b) => time(a.at) - time(b.at) || a.id.localeCompare(b.id));
  return { assign, model: {
    generatedAt, agents, projects, hotProjects, focusProjectId, tasks: { columns: taskColumns, overflow }, handoffs,
    loaded: { activity: !!inputs.activity, projects: !!inputs.projects, interactions: Object.keys(inputs.interactions).filter(id => !!inputs.interactions[id]) },
  } };
}
