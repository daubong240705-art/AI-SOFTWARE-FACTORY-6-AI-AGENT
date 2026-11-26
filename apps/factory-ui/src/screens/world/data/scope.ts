import type { WorldAgent, WorldModel } from './types';
import { subtreeIds } from '../../groups/tree';
import { deskFloorSouth, desksPerRow, podColumns, projectColor, roomDesk } from '../layout/campus';
import type { Footprint } from '../layout/zones';

export type WorldScope = { groupId: string | null; projectId: string | null };

export function scopeGroups(model: WorldModel) {
  const groups = model.groups?.groups.filter(group => !group.archived) ?? [];
  const byId = new Map(groups.map(group => [group.id, group]));
  const projectsByGroup = new Map<string | null, typeof model.projects>();
  const groupByProject = new Map<string, string | null>();
  const counts = new Map<string, { agents: number; working: number; waiting: number }>();
  for (const project of model.projects) {
    const id = model.groups?.membership[project.id] ?? project.groupId;
    const groupId = id && byId.has(id) ? id : null;
    groupByProject.set(project.id, groupId);
    const projects = projectsByGroup.get(groupId) ?? [];
    projects.push(project); projectsByGroup.set(groupId, projects);
  }
  for (const agent of model.agents) {
    const count = counts.get(agent.projectId) ?? { agents: 0, working: 0, waiting: 0 };
    count.agents++; count.working += Number(agent.status === 'working'); count.waiting += Number(agent.status === 'waiting');
    counts.set(agent.projectId, count);
  }
  const path = (groupId: string) => {
    const names: string[] = [], seen = new Set<string>();
    let group = byId.get(groupId);
    while (group && !seen.has(group.id)) {
      seen.add(group.id); names.unshift(group.name);
      group = group.parentId === null ? undefined : byId.get(group.parentId);
    }
    return names.join(' / ');
  };
  const summarize = (id: string | null, name: string, ids: Iterable<string | null>) => {
    const projects = [...ids].flatMap(key => projectsByGroup.get(key) ?? []);
    const totals = { agents: 0, working: 0, waiting: 0 };
    for (const project of projects) {
      const count = counts.get(project.id);
      if (count) { totals.agents += count.agents; totals.working += count.working; totals.waiting += count.waiting; }
    }
    return { id, name, projects, ...totals };
  };
  const options = groups.map(group => summarize(group.id, path(group.id), subtreeIds(groups, group.id)))
    .sort((left, right) => left.name.localeCompare(right.name));
  const ungrouped = summarize(null, '', [null]);
  const preferred = model.recentProjects[0];
  return { options: [...options, ungrouped], defaultGroup: preferred ? groupByProject.get(preferred.id) ?? null : options[0]?.id ?? null };
}

export type ScopeGroup = ReturnType<typeof scopeGroups>['options'][number];

export function resolveScope(groups: ReturnType<typeof scopeGroups>, choice: WorldScope | null): WorldScope {
  const group = (choice && groups.options.find(option => option.id === choice.groupId))
    || groups.options.find(option => option.id === groups.defaultGroup)!;
  return { groupId: group.id, projectId: group.projects.some(project => project.id === choice?.projectId) ? choice!.projectId : null };
}

export type WorldPod = { projectId: string; name: string; color: string; collapsed: boolean; remaining: number; start: number; size: number };

export function scopeFloor(model: Pick<WorldModel, 'agents' | 'projects'>, group: ScopeGroup, projectId: string | null, expanded: string | null) {
  const projectIds = new Set(group.projects.map(project => project.id));
  const inGroup = model.agents.filter(agent => projectIds.has(agent.projectId));
  const compact = inGroup.length > 36;
  const projects = group.projects.filter(project => !projectId || project.id === projectId);
  const roster = projectId ? inGroup.filter(agent => agent.projectId === projectId) : inGroup;
  const byProject = new Map<string, WorldAgent[]>();
  for (const agent of roster) {
    const members = byProject.get(agent.projectId) ?? [];
    members.push(agent); byProject.set(agent.projectId, members);
  }
  const lanes = Array.from({ length: desksPerRow / podColumns }, () => 0);
  const agents: WorldAgent[] = [];
  const pods: WorldPod[] = [];
  for (const project of projects) {
    const members = byProject.get(project.id) ?? [];
    const collapsed = compact && expanded !== project.id;
    const visible = collapsed ? members.slice(0, podColumns) : members;
    const row = Math.min(...lanes), lane = lanes.indexOf(row);
    const start = row * desksPerRow + lane * podColumns;
    lanes[lane] = row + Math.max(1, Math.ceil(visible.length / podColumns));
    pods.push({ projectId: project.id, name: project.name, color: members[0]?.projectColor ?? projectColor(model.projects.indexOf(project)), collapsed, remaining: members.length - visible.length, start, size: members.length });
    visible.forEach((agent, index) => agents.push({ ...agent, compact: collapsed, slotIndex: start + Math.floor(index / podColumns) * desksPerRow + index % podColumns }));
  }
  return { agents, roster, pods, projects, compact, floorSouth: deskFloorSouth(Math.max(...lanes) * desksPerRow) };
}

export function podCenter(pod: WorldPod) {
  const position = roomDesk({ slotIndex: pod.start, seatId: pod.projectId }).position;
  const end = roomDesk({ slotIndex: pod.start + podColumns - 1, seatId: pod.projectId }).position;
  return { x: (position[0] + end[0]) / 2, z: position[1], width: end[0] - position[0] + 1.75 };
}

export function podFootprints(pods: readonly WorldPod[]): Footprint[] {
  return pods.flatMap(pod => {
    if (pod.collapsed) {
      const { x, z, width } = podCenter(pod);
      return [{ id: `pod:${pod.projectId}`, position: [x, z], half: [width / 2, .44], yaw: 0 }];
    }
    return Array.from({ length: pod.size }, (_, index): Footprint => {
      const slotIndex = pod.start + Math.floor(index / podColumns) * desksPerRow + index % podColumns;
      const { id, position } = roomDesk({ slotIndex, seatId: String(slotIndex) });
      return { id, position, half: [.87, .44], yaw: 0 };
    });
  });
}

export const liveAttemptCount = (agent: WorldAgent) => Math.max(agent.desk.agent.live, new Set(agent.runs.map(run => run.attemptId)).size);

const scopeKey = 'factory-ui.world.scope.v1';
export function readScope(): WorldScope | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(scopeKey) ?? 'null');
    if (value && typeof value === 'object' && 'groupId' in value && 'projectId' in value
      && (typeof value.groupId === 'string' || value.groupId === null)
      && (typeof value.projectId === 'string' || value.projectId === null)) return { groupId: value.groupId, projectId: value.projectId };
  } catch { return null; }
  return null;
}

export function saveScope(scope: WorldScope) {
  try { localStorage.setItem(scopeKey, JSON.stringify(scope)); } catch { return; }
}
