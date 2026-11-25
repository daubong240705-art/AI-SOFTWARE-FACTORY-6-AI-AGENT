import type { AgentSummary, FlowRunDetail, FlowRunSummary, Task } from '@factory/contracts';
import type { ApiClient } from '@/api/client';
import type { ActivityRun, OrgActivity } from '@/api/activityModels';
import type { AgentProjectResponse } from '@/api/agentModels';

export type ProjectAttempt = Awaited<ReturnType<ApiClient['listProjectAttempts']>>['attempts'][number];
export type ProjectInbox = Awaited<ReturnType<ApiClient['getInbox']>>;
export type FlowList = Awaited<ReturnType<ApiClient['listProjectFlows']>>;
export type DeskStatus = 'working' | 'waiting' | 'idle' | 'paused' | 'problem';
export type Desk = {
  agent: AgentSummary;
  team: AgentProjectResponse['teams'][number] | undefined;
  status: DeskStatus;
  task: Pick<Task, 'id' | 'title' | 'code'> | undefined;
  live: ProjectAttempt[];
  waiting: boolean;
  progress: ActivityRun['progress'];
  today: ProjectAttempt[];
};

const liveStates = new Set(['queued', 'leased', 'preparing', 'running', 'waiting-input', 'stopping', 'submitting', 'reconciling', 'requeued']);
const finishedStates = new Set(['done', 'cancelled', 'superseded']);
const waitingTask = (task: Task) => task.state === 'awaiting-go' || task.state === 'in-review' || task.holds.some(hold => hold.needsAction);
const compareTeams = (left: { name: string; id: string }, right: { name: string; id: string }) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id);

export function desksFor(roster: AgentProjectResponse, tasks: readonly Task[], attempts: readonly ProjectAttempt[], inbox: ProjectInbox | undefined, activity: OrgActivity | undefined, now: number, reported: Readonly<Record<string, ActivityRun['progress']>> = {}): Desk[] {
  const activeTasks = tasks.filter(task => task.disposition === 'active');
  const taskById = new Map(activeTasks.map(task => [task.id, task]));
  const approvalTasks = new Set([
    ...(inbox?.approvals ?? []).filter(item => item.state === 'requested' || item.state === 'pending').map(item => item.taskId),
    ...(inbox?.startGates ?? []).map(item => item.taskId),
  ]);
  const progress = new Map((activity?.teams ?? []).flatMap(team => team.seats.flatMap(seat => seat.runs.map(run => [run.attemptId, run.progress] as const))));
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const teams = [...roster.teams].sort(compareTeams);
  return roster.agents.filter(agent => agent.status === 'active' || agent.status === 'paused').map((agent): Desk => {
    const assigned = activeTasks.filter(task => task.ownerSeatId === agent.id);
    const history = attempts.filter(attempt => (attempt.seatId ?? taskById.get(attempt.taskId)?.ownerSeatId) === agent.id);
    const live = history.filter(attempt => liveStates.has(attempt.state) && (!tasks.length || taskById.has(attempt.taskId)))
      .sort((left, right) => Number(right.state === 'running') - Number(left.state === 'running'));
    const blocked = assigned.find(task => approvalTasks.has(task.id) || waitingTask(task))
      ?? live.map(attempt => taskById.get(attempt.taskId)).find(task => task && (approvalTasks.has(task.id) || waitingTask(task)));
    const current = live[0];
    const currentTask = blocked ?? (current ? taskById.get(current.taskId) ?? { id: current.taskId, code: current.taskCode, title: current.taskTitle } : undefined)
      ?? assigned.find(task => task.state === 'active') ?? assigned.find(task => task.state === 'failed')
      ?? assigned.find(task => !finishedStates.has(task.state));
    const waiting = !!blocked || live.some(attempt => attempt.state === 'waiting-input' || approvalTasks.has(attempt.taskId));
    const latestProgress = history.flatMap(attempt => [reported[attempt.id], progress.get(attempt.id)]).reduce<ActivityRun['progress']>((latest, item) => item && (!latest || Date.parse(item.at) > Date.parse(latest.at)) ? item : latest, null);
    const status = agent.status === 'paused' ? 'paused' : waiting ? 'waiting' : live.length || agent.live || currentTask && 'state' in currentTask && currentTask.state === 'active' ? 'working'
      : currentTask && 'state' in currentTask && currentTask.state === 'failed' ? 'problem' : 'idle';
    return {
      agent, team: teams.find(team => agent.teamIds.includes(team.id) || team.memberIds.includes(agent.id)), status, task: currentTask, live, waiting,
      progress: latestProgress ?? null,
      today: history.filter(attempt => [attempt.startedAt, attempt.endedAt].some(at => at && Date.parse(at) >= +midnight && Date.parse(at) <= now)),
    };
  }).sort((left, right) => Number(right.agent.isLead) - Number(left.agent.isLead)
    || (left.team && right.team ? compareTeams(left.team, right.team) : Number(!left.team) - Number(!right.team))
    || compareTeams(left.agent, right.agent));
}

export const isActiveRun = (run: FlowRunSummary) => !['succeeded', 'failed', 'cancelled'].includes(run.state);
export const runTitle = (run: FlowRunSummary) => run.flowTitle;
export function latestNodeRuns(detail: FlowRunDetail) {
  const latest = new Map<string, FlowRunDetail['nodeRuns'][number]>();
  for (const row of detail.nodeRuns) {
    const before = latest.get(row.nodeId);
    if (!before || row.iteration > before.iteration || row.iteration === before.iteration && row.attemptNo >= before.attemptNo) latest.set(row.nodeId, row);
  }
  return [...latest.values()];
}

export function nodeProgress(detail: FlowRunDetail) {
  const latest = latestNodeRuns(detail);
  const total = detail.definition.nodes.length;
  const complete = latest.filter(row => row.state === 'succeeded' || row.state === 'skipped').length;
  const active = latest.filter(row => row.state === 'running' || row.state === 'waiting').map(row => detail.definition.nodes.find(node => node.id === row.nodeId)?.title ?? row.nodeId);
  return { total, complete, active };
}
