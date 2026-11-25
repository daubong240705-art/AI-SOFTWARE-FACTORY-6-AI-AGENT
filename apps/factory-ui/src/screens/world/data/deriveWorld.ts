import { meaningfulOfficeItems, type Interaction } from '../../../api/officeModels';
import type { GroupsResponse, Project, Task } from '@factory/contracts';
import { desksFor, isActiveRun, latestNodeRuns, nodeProgress, runTitle } from '../../office/liveModel';
import { assignDesks } from './assignDesks';
import { deskFloorSouth, projectColor } from '../layout/campus';
import type { Assignments, Endpoint, Handoff, PodKey, TaskCard, WorldAgent, WorldInputs, WorldModel } from './types';

const columns = ['todo', 'doing', 'review', 'failed', 'done'] as const;
const poses = { working: 'working', waiting: 'attention', problem: 'error', paused: 'resting', idle: 'resting' } as const;
const ordinaryPods: PodKey[] = ['a', 'b', 'c', 'd', 'east', 'annex'];

function column(task: Task): TaskCard['column'] | null {
  if (task.disposition !== 'active') return null;
  if (task.state === 'in-review' || task.state === 'awaiting-go' || task.holds.some(hold => hold.needsAction)) return 'review';
  if (['proposed', 'accepted', 'ready'].includes(task.state)) return 'todo';
  if (task.state === 'active') return 'doing';
  return task.state === 'failed' || task.state === 'done' ? task.state : null;
}

function handoff(item: Interaction, projectId: string, roster: Set<string>): Handoff | null {
  const party = (value: Interaction['to']): Endpoint | undefined => {
    if (value?.kind === 'seat' && roster.has(value.seatId)) return { kind: 'seat', seatId: value.seatId };
    if (value?.kind === 'operator') return { kind: 'owner' };
    if (value?.kind === 'knowledge') return { kind: 'knowledge' };
    return undefined;
  };
  const from = party(item.from);
  const to = item.kind === 'output' ? { kind: 'knowledge' } as const : ['question', 'review', 'start-gate'].includes(item.kind) ? { kind: 'owner' } as const : party(item.to);
  if (!from || !to || from.kind !== 'seat' && to.kind !== 'seat' || !['handoff', 'request', 'assign', 'question', 'review', 'start-gate', 'answer', 'rework', 'message', 'output'].includes(item.kind)) return null;
  return { id: `${projectId}:${item.id}`, taskId: item.taskId, projectId, at: item.at, kind: item.kind, from, to, code: item.code, text: item.text };
}

export function projectBuildings(projects: readonly Project[], groups?: GroupsResponse): WorldModel['buildings'] {
  const byId = new Map(groups?.groups.map(group => [group.id, group]));
  const buildings = new Map<string | null, WorldModel['buildings'][number]>();
  for (const project of projects) {
    if (project.disposition === 'archived') continue;
    const membership = groups?.membership[project.id];
    let group = membership ? byId.get(membership) : undefined;
    const visited = new Set<string>();
    while (group && !group.archived && group.parentId !== null && !visited.has(group.id)) {
      visited.add(group.id); group = byId.get(group.parentId);
    }
    const root = group && !group.archived && group.parentId === null ? group : undefined;
    const key = root?.id ?? null;
    const building = buildings.get(key) ?? { id: root ? `group:${root.id}` : 'shared', name: root?.name ?? null, rooms: [] };
    building.rooms.push(project); buildings.set(key, building);
  }
  return [...buildings.values()].sort((left, right) => Number(left.name === null) - Number(right.name === null) || (left.name ?? '').localeCompare(right.name ?? '') || left.id.localeCompare(right.id));
}

export function deriveWorld(inputs: WorldInputs, previous: Assignments = {}): { model: WorldModel; assign: Assignments } {
  const generatedAt = inputs.serverNow ?? inputs.activity?.generatedAt ?? '';
  const projects = (inputs.projects ?? []).filter(project => project.disposition !== 'archived').sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  const hotProjects = projects.filter(project => inputs.rosters?.[project.id]?.agents.some(agent => agent.status === 'active' && agent.live > 0));
  const focusProjectId = (projects.some(project => project.id === inputs.focusProjectId) ? inputs.focusProjectId : null) ?? hotProjects[0]?.id ?? projects[0]?.id ?? null;
  const rows: Omit<WorldAgent, 'slotIndex' | 'overflow'>[] = [];
  const buildings = projectBuildings(projects, inputs.groups);
  for (const [index, project] of projects.entries()) {
    const roster = inputs.rosters?.[project.id]; if (!roster) continue;
    const inbox = inputs.inboxes?.[project.id];
    const desks = desksFor(roster, inputs.tasks[project.id] ?? [], inputs.attempts?.[project.id] ?? [], inbox, inputs.activity, Date.parse(generatedAt))
      .filter(desk => desk.agent.status === 'active');
    const teamOrder = [...new Set(desks.filter(desk => !desk.agent.isLead).map(desk => desk.team?.id))];
    const lastHandoff = new Map<string, string>();
    for (const item of inputs.interactions[project.id]?.items ?? []) {
      if (!['handoff', 'request'].includes(item.kind) || item.from.kind !== 'seat' || item.to?.kind !== 'seat') continue;
      for (const id of [item.from.seatId, item.to.seatId]) if ((lastHandoff.get(id) ?? '') < item.at) lastHandoff.set(id, item.at);
    }
    const workflowTasks = new Set((inputs.flows?.[project.id]?.runs ?? []).filter(isActiveRun).flatMap(run => {
      const detail = inputs.runDetails?.[run.id];
      return detail ? latestNodeRuns(detail).filter(node => node.state === 'ready' || node.state === 'running' || node.state === 'waiting').map(node => node.taskId) : [];
    }));
    for (const desk of desks) {
      const { agent, live, task } = desk;
      const pending = (inbox?.approvals ?? []).filter(item => item.taskId !== null && (item.taskId === task?.id || live.some(attempt => item.taskId === attempt.taskId)) && (item.state === 'pending' || item.state === 'requested'));
      const needsYou: WorldAgent['needsYou'] = pending.map(item => ({ approvalId: item.id, kind: item.kind, taskId: item.taskId!, code: task?.code ?? '' }));
      if (task && !needsYou.length && inbox?.startGates.some(item => item.taskId === task.id)) needsYou.push({ approvalId: task.id, kind: 'start-gate', taskId: task.id, code: task.code });
      const runs: WorldAgent['runs'] = live.map(attempt => ({
        projectId: project.id, projectName: project.name, taskId: attempt.taskId, code: attempt.taskCode, title: attempt.taskTitle,
        attemptId: attempt.id, attemptState: attempt.state, nodeId: attempt.nodeId ?? null, startedAt: attempt.startedAt, progress: attempt === live[0] ? desk.progress : null,
      }));
      rows.push({ podKey: agent.isLead ? 'lead' : ordinaryPods[teamOrder.indexOf(desk.team?.id) % ordinaryPods.length]!, desk, projectColor: projectColor(index), collaborationAt: lastHandoff.get(agent.id) ?? null, workflowTask: !!task && workflowTasks.has(task.id), projectId: project.id, seatId: agent.id, ownerSeatId: agent.id, seatName: agent.name, slot: 0, teamId: project.id, teamName: project.name,
        paused: desk.status === 'paused',
        name: agent.name, role: agent.role, isLead: agent.isLead, slots: 1, status: desk.status === 'paused' ? 'idle' : desk.status, pose: poses[desk.status], runs, queued: 0, needsYou, lastFinished: null });
    }
  }
  const assign = assignDesks(rows, previous);
  const agents: WorldAgent[] = rows.map(agent => ({ ...agent, ...assign[agent.seatId]! }));
  const taskColumns: Record<TaskCard['column'], TaskCard[]> = { todo: [], doing: [], review: [], failed: [], done: [] };
  for (const task of focusProjectId ? inputs.tasks[focusProjectId] ?? [] : []) {
    const target = column(task);
    if (target) taskColumns[target].push({ id: `${task.projectId}:${task.id}`, projectId: task.projectId, taskId: task.id, code: task.code, title: task.title, column: target });
  }
  const overflow = Object.fromEntries(columns.map(key => [key, Math.max(0, taskColumns[key].length - 6)])) as Record<TaskCard['column'], number>;
  for (const key of columns) {
    taskColumns[key].sort((left, right) => left.code.localeCompare(right.code));
    taskColumns[key] = key === 'done' ? taskColumns[key].slice(-6) : taskColumns[key].slice(0, 6);
  }
  const rosterIds = new Set(agents.filter(agent => agent.projectId === focusProjectId).map(agent => agent.seatId));
  const handoffs = meaningfulOfficeItems(focusProjectId ? inputs.interactions[focusProjectId]?.items ?? [] : []).flatMap(item => {
    const event = handoff(item, focusProjectId!, rosterIds); return event ? [event] : [];
  }).sort((left, right) => Date.parse(left.at) - Date.parse(right.at) || left.id.localeCompare(right.id));
  const stations: WorldModel['stations'] = {};
  for (const { id } of projects) {
    const inbox = inputs.inboxes?.[id]; const list = inputs.flows?.[id];
    stations[id] = {
      ...(inbox ? { approvalCount: inbox.approvals.filter(item => item.state === 'pending' || item.state === 'requested').length + inbox.startGates.length } : {}),
      ...(list ? { workflows: list.runs.filter(isActiveRun).map(run => {
        const detail = inputs.runDetails?.[run.id];
        return { run, title: runTitle(run), ...(detail ? { progress: nodeProgress(detail) } : {}) };
      }) } : {}),
    };
  }
  const workflows = focusProjectId ? stations[focusProjectId]?.workflows : undefined;
  return { assign, model: { generatedAt, agents, projects, hotProjects, focusProjectId, buildings, floorSouth: deskFloorSouth(agents.length),
    workflows: workflows ?? [], workflowLoaded: !!workflows, stations, tasks: { columns: taskColumns, overflow }, handoffs,
    loaded: { activity: !!inputs.projects && projects.every(project => inputs.rosters?.[project.id]), projects: !!inputs.projects,
      interactions: focusProjectId && inputs.interactions[focusProjectId] && inputs.rosters?.[focusProjectId] ? [focusProjectId] : [] } } };
}
