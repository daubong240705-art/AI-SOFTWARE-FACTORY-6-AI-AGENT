import type { GroupSummary } from '@factory/contracts';

export type GroupBranch<Project> = { group: GroupSummary; groups: GroupBranch<Project>[]; projects: Project[] };

export function buildTree<Project extends { id: string }>(groups: readonly GroupSummary[], projects: readonly Project[], membership: Readonly<Record<string, string>>) {
  const roots: GroupBranch<Project>[] = [];
  const ungrouped: Project[] = [];
  const byId = new Map(groups.map(group => [group.id, { group, groups: [], projects: [] } as GroupBranch<Project>]));
  for (const branch of byId.values()) {
    const parent = branch.group.parentId ? byId.get(branch.group.parentId) : undefined;
    (parent?.groups ?? roots).push(branch);
  }
  for (const project of projects) {
    const branch = byId.get(membership[project.id] ?? '');
    (branch?.projects ?? ungrouped).push(project);
  }
  return { groups: roots, projects: ungrouped };
}

export function pathDisplay(groups: readonly GroupSummary[], groupId: string | null, root: string): string {
  if (groupId === null) return root;
  return groups.find(group => group.id === groupId)?.path ?? root;
}

export function slugify(name: string): string {
  return name.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\u0111/g, 'd')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 50).replace(/-+$/, '');
}

export function subtreeIds(groups: readonly GroupSummary[], groupId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const group of groups) {
    if (group.parentId === null) continue;
    const siblings = children.get(group.parentId) ?? [];
    siblings.push(group.id);
    children.set(group.parentId, siblings);
  }
  const result = new Set<string>();
  const pending = [groupId];
  while (pending.length) {
    const id = pending.pop()!;
    if (result.has(id)) continue;
    result.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  return result;
}
