import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react';
import type { GroupSummary } from '@factory/contracts';
import { cn } from '@/lib/utils';
import { buildTree } from './tree';
import { useGroupLabels } from './GroupsContext';

export type TreeItem = { id: string; label: string; content: ReactNode; children?: TreeItem[]; disabled?: boolean };
type VisibleItem = { item: TreeItem; parent?: string };

export function GroupTree({ items, label, current, expanded, toggle, activate, compact, selection, disabled = false }: {
  items: TreeItem[]; label: string; current?: string | undefined; expanded: ReadonlySet<string>;
  toggle: (id: string) => void; activate: (id: string) => void; compact?: boolean; selection?: boolean; disabled?: boolean | undefined;
}) {
  const prefix = useId();
  const [focused, setFocused] = useState<string>();
  const visible: VisibleItem[] = [];
  function flatten(nodes: TreeItem[], parent?: string) {
    for (const item of nodes) {
      visible.push({ item, ...(parent !== undefined ? { parent } : {}) });
      if (item.children && expanded.has(item.id)) flatten(item.children, item.id);
    }
  }
  flatten(items);
  const isVisible = new Set(visible.map(entry => entry.item.id));
  const tabStop = [focused, current, visible[0]?.item.id].find(id => id !== undefined && isVisible.has(id));
  const elementId = (id: string) => `${prefix}-${id}`;
  function focus(id?: string) { if (id !== undefined) document.getElementById(elementId(id))?.focus(); }
  function key(event: KeyboardEvent<HTMLLIElement>, id: string) {
    if (event.target !== event.currentTarget || disabled) return;
    const index = visible.findIndex(entry => entry.item.id === id);
    const entry = visible[index];
    if (!entry) return;
    const open = expanded.has(id);
    const firstChild = entry.item.children?.[0]?.id;
    switch (event.key) {
      case 'ArrowUp': focus(visible[index - 1]?.item.id); break;
      case 'ArrowDown': focus(visible[index + 1]?.item.id); break;
      case 'Home': focus(visible[0]?.item.id); break;
      case 'End': focus(visible.at(-1)?.item.id); break;
      case 'ArrowRight': if (firstChild) { if (open) focus(firstChild); else toggle(id); } break;
      case 'ArrowLeft': if (firstChild && open) toggle(id); else focus(entry.parent); break;
      case 'Enter':
      case ' ': if (!entry.item.disabled) activate(id); break;
      default: return;
    }
    event.preventDefault();
  }
  function render(nodes: TreeItem[], depth: number): ReactNode {
    return nodes.map(item => {
      const branch = !!item.children?.length;
      const open = branch && expanded.has(item.id);
      const Chevron = open ? ChevronDown : ChevronRight;
      return <li data-testid={`tree-${item.id}`} key={item.id} id={elementId(item.id)} role="treeitem" aria-label={item.label}
        aria-current={!selection && current === item.id ? 'page' : undefined} aria-selected={selection ? current === item.id : undefined}
        aria-expanded={branch ? open : undefined} aria-disabled={item.disabled || undefined} aria-level={depth + 1}
        tabIndex={!disabled && tabStop === item.id ? 0 : -1} onFocus={event => { if (event.target === event.currentTarget) setFocused(item.id); }} onKeyDown={event => key(event, item.id)}
        className="group/node min-w-0 focus-visible:outline-none">
        <div data-testid="tree-open" title={item.label} onClick={() => { if (!disabled) { focus(item.id); if (!item.disabled) activate(item.id); } }}
          className={cn('relative flex min-h-10 w-full items-center gap-1.5 rounded-md px-2 text-start text-sm text-muted-foreground group-focus-visible/node:outline-2 group-focus-visible/node:-outline-offset-2 group-focus-visible/node:outline-ring',
            current === item.id && 'bg-nav-active font-medium text-foreground', item.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-card hover:text-foreground', compact && 'justify-center px-0')}
          style={compact ? undefined : { paddingInlineStart: 4 + depth * 12 }}>
          {branch ? <span data-testid="tree-expand" className={cn('grid size-5 shrink-0 place-items-center rounded hover:bg-secondary', compact && 'absolute top-0 right-0 z-10 size-3 bg-sidebar')} aria-hidden="true"
            onClick={event => { event.stopPropagation(); if (!disabled) { focus(item.id); toggle(item.id); } }}><Chevron className={compact ? 'size-3' : 'size-4'} /></span>
            : !compact && <span className="w-5 shrink-0" aria-hidden="true" />}
          {item.content}
        </div>
        {open && <ul role="group" className="m-0 list-none p-0">{render(item.children!, depth + 1)}</ul>}
      </li>;
    });
  }
  return <ul role="tree" aria-label={label} aria-disabled={disabled || undefined} className="m-0 list-none p-0">{render(items, 0)}</ul>;
}

export function GroupPicker({ groups, value, onChange, disabled, unavailable, rootLabel, label }: {
  groups: GroupSummary[]; value: string | null; onChange: (value: string | null) => void; disabled?: boolean;
  unavailable?: (group: GroupSummary) => boolean; rootLabel: string; label: string;
}) {
  const t = useGroupLabels();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const expanded = new Set(groups.filter(group => !collapsed.has(group.id)).map(group => group.id));
  const tree = buildTree(groups, [], {});
  function item(branch: (typeof tree.groups)[number]): TreeItem {
    const { group } = branch;
    const name = group.archived ? t('archivedName', { name: group.name }) : group.name;
    const Icon = expanded.has(group.id) && branch.groups.length ? FolderOpen : Folder;
    return { id: group.id, label: group.archived ? t('archivedName', { name: group.path }) : group.path,
      disabled: group.archived || unavailable?.(group) === true, children: branch.groups.map(item),
      content: <><Icon className="size-4 shrink-0" aria-hidden="true" /><span className="min-w-0 truncate">{name}</span></> };
  }
  return <fieldset disabled={disabled} className="min-w-0 rounded-lg border border-border px-2 pb-2">
    <legend className="px-1 text-sm font-medium">{label}</legend>
    <div className="max-h-44 overflow-auto"><GroupTree selection label={label} current={value ?? ''} expanded={expanded} disabled={disabled}
      items={[{ id: '', label: rootLabel, content: rootLabel }, ...tree.groups.map(item)]}
      activate={id => onChange(id || null)} toggle={id => setCollapsed(previous => { const next = new Set(previous); if (!next.delete(id)) next.add(id); return next; })} /></div>
  </fieldset>;
}
