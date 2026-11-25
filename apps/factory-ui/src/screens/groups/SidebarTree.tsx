import { useEffect, useState } from 'react';
import { Folder, FolderOpen } from 'lucide-react';
import type { Project } from '@factory/contracts';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import { ProjectTile } from '../shell/ProjectTile';
import type { View } from '../shell/navigation';
import { GroupTree, type TreeItem } from './GroupTree';
import { useGroupLabels, useGroups } from './GroupsContext';
import { buildTree, type GroupBranch } from './tree';

const storageKey = 'factory.groups.expanded';
function readExpanded() {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []);
  } catch { return new Set<string>(); }
}

export function SidebarTree({ projects, view, collapsed, onNavigate, projectStatus }: {
  projects: Project[]; view: View; collapsed: boolean; onNavigate: (view: View) => void; projectStatus: (id: string) => 'need' | 'run' | null;
}) {
  const global = useT();
  const t = useGroupLabels();
  const { list } = useGroups();
  const [expanded, setExpanded] = useState(readExpanded);
  const [showArchived, setShowArchived] = useState(false);
  const groups = list.data?.groups ?? [];
  const tree = buildTree(groups, projects, list.data?.membership ?? {});
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify([...expanded])); } catch { /* Storage can be disabled. */ } }, [expanded]);
  function projectItem(project: Project): TreeItem {
    const status = projectStatus(project.id);
    const statusLabel = status ? global(status === 'need' ? 'inboxUi.needsDecision' : 'taskUi.display.running') : undefined;
    return { id: `project:${project.id}`, label: statusLabel ? `${project.name}, ${statusLabel}` : project.name,
      content: <><ProjectTile id={project.id} name={project.name} /><span className={collapsed ? 'hidden' : 'min-w-0 truncate'}>{project.name}</span>
        {status && <span className={cn('ml-auto size-2 shrink-0 rounded-full', status === 'need' ? 'bg-need' : 'bg-run', collapsed && 'absolute right-0.5 bottom-0.5')} aria-hidden="true" />}</> };
  }
  function groupItem({ group, groups: children, projects }: GroupBranch<Project>): TreeItem[] {
    if (group.archived && !showArchived) return [];
    const id = `group:${group.id}`;
    const Icon = expanded.has(id) ? FolderOpen : Folder;
    const name = group.archived ? t('archivedName', { name: group.name }) : group.name;
    return [{ id, label: name, content: <><Icon className="size-5 shrink-0" aria-hidden="true" /><span className={collapsed ? 'hidden' : 'min-w-0 truncate'}>{name}</span></>, children: [...children.flatMap(groupItem), ...projects.map(projectItem)] }];
  }
  const items = [...tree.groups.flatMap(groupItem), ...tree.projects.map(projectItem)];
  return <>
    {groups.some(group => group.archived) && <label className="flex min-h-8 items-center gap-2 px-2 text-xs text-muted-foreground" title={t('showArchived')}>
      <input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} /><span className={collapsed ? 'sr-only' : ''}>{t('showArchived')}</span>
    </label>}
    <GroupTree items={items} label={global('global.projects')} current={view} expanded={expanded} compact={collapsed}
      toggle={id => setExpanded(previous => { const next = new Set(previous); if (!next.delete(id)) next.add(id); return next; })}
      activate={id => onNavigate(id as View)} />
    {!items.length && !list.loading && !list.error && !collapsed && <p className="p-2 text-xs text-muted-foreground">{t('sidebarEmpty')}</p>}
  </>;
}
