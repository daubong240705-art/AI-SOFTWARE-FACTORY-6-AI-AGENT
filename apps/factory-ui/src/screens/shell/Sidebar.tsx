import { Skeleton } from '@/components/ui/skeleton';
import { shallowSelectionEqual } from '@/state/storeSelector';
import { deriveDisplayStatus, isLiveAttempt } from '@factory/contracts';
import { Activity, Earth, House, Inbox, Library, PanelLeftClose, PanelLeftOpen, Plug, Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ErrorNotice } from '@/components/ErrorNotice';
import { cn } from '@/lib/utils';
import { useT } from '../../i18n';
import type { Store } from '../../state/store';
import { inboxCount } from '@/lib/inbox';
import { attentionItems } from './attention';
import { NavButton } from './NavButton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ReadFeedback } from '../library/shared';
import { useGroupLabels, useGroups } from '../groups/GroupsContext';
import { SidebarTree } from '../groups/SidebarTree';
import { Settings } from './Settings';
import type { View } from './navigation';

export function Sidebar({ store, view, collapsed, compact, expanded, onNavigate, onCollapse, onNewProject, onNewGroup }: {
  store: Store; view: View; collapsed: boolean; compact: boolean; expanded: boolean;
  onNavigate: (view: View) => void; onCollapse: () => void;
  onNewProject: () => void; onNewGroup: () => void;
}) {
  const groupLabel = useGroupLabels();
  const { list, refresh } = useGroups();
  const t = useT(); const state = store.useStoreSelector(value => ({ globalInbox: value.globalInbox, selectedProjectId: value.selectedProjectId, tasks: value.tasks, liveAttempts: value.liveAttempts, loading: value.loading, errors: value.errors, projects: value.projects }), shallowSelectionEqual);
  const items = attentionItems(state.globalInbox);
  const labelClass = collapsed ? 'hidden' : 'min-w-0 truncate';
  const CollapseIcon = compact ? X : collapsed ? PanelLeftOpen : PanelLeftClose;
  function projectStatus(projectId: string) {
    const tasks = state.selectedProjectId === projectId ? state.tasks : [];
    if (items.some(item => item.projectId === projectId) || tasks.some(task => task.holds.some(hold => hold.needsAction) || deriveDisplayStatus({ ...task, liveAttempt: null }).status === 'approval-required')) return 'need';
    if (tasks.some(task => { const attempt = state.liveAttempts[task.id]; return deriveDisplayStatus({ ...task, liveAttempt: attempt && isLiveAttempt(attempt.state) ? attempt.state : null }).status === 'running'; })) return 'run';
    return null;
  }
  return <nav id="factory-navigation" className="row-span-full flex h-full min-h-0 min-w-0 flex-col gap-1 border-r border-border bg-sidebar px-2.5 py-3.5 transition-[width] duration-200 motion-reduce:transition-none" aria-label={t('nav.main')}>
    <div className={cn('flex shrink-0 items-center gap-2.5 px-2 pt-1 pb-3.5 font-display text-[19px] font-bold', collapsed && 'justify-center px-0')}>
      <span className="grid size-7 shrink-0 place-items-center rounded-[9px] bg-primary text-[17px] text-primary-foreground" aria-hidden="true">F</span>
      <span className={cn(labelClass, 'transition-opacity duration-150 motion-reduce:transition-none')}>{t('shell.product')}</span>
    </div>
    <NavButton data-testid="sidebar-overview" collapsed={collapsed} aria-label={t('nav.overview')} aria-current={view === 'overview' ? 'page' : undefined} onClick={() => onNavigate('overview')}><House /><span className={cn(labelClass, 'transition-opacity duration-150 motion-reduce:transition-none')}>{t('nav.overview')}</span></NavButton>
    <NavButton data-testid="sidebar-attention" collapsed={collapsed} aria-label={`${t('nav.attention')}, ${inboxCount(t, items.length)}`} aria-current={view === 'needs-attention' ? 'page' : undefined} onClick={() => onNavigate('needs-attention')}><Inbox /><span className={cn(labelClass, 'transition-opacity duration-150 motion-reduce:transition-none')}>{t('nav.attention')}</span>{items.length > 0 && !collapsed && <Badge key={items.length} className="ml-auto min-w-[22px] animate-[pop_300ms_ease-out] motion-reduce:animate-none border-0 bg-need py-0 text-need-foreground">{items.length}</Badge>}</NavButton>
    <NavButton data-testid="sidebar-library" collapsed={collapsed} aria-label={t('nav.library')} aria-current={view === 'library' ? 'page' : undefined} onClick={() => onNavigate('library')}><Library /><span className={labelClass}>{t('nav.library')}</span></NavButton>
    <NavButton data-testid="sidebar-integrations" collapsed={collapsed} aria-label={t('integrationsUi.title')} aria-current={view === 'integrations' ? 'page' : undefined} onClick={() => onNavigate('integrations')}><Plug /><span className={labelClass}>{t('integrationsUi.title')}</span></NavButton>
    <NavButton data-testid="sidebar-world" collapsed={collapsed} aria-label={t('nav.world')} aria-current={view === 'world' ? 'page' : undefined} onClick={() => onNavigate('world')}><Earth /><span className={labelClass}>{t('nav.world')}</span></NavButton>
    <div className={cn('mt-4 flex h-8 shrink-0 items-center justify-between px-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase', collapsed && 'justify-center px-0')}>
      <span className={collapsed ? 'sr-only' : ''}>{t('global.projects')}</span>
      <DropdownMenu><DropdownMenuTrigger asChild><Button data-testid="sidebar-create" type="button" variant="ghost" size="icon-sm" aria-label={groupLabel('createMenu')}><Plus aria-hidden="true" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end"><DropdownMenuItem data-testid="sidebar-project-create" onSelect={onNewProject}>{groupLabel('newProject')}</DropdownMenuItem><DropdownMenuItem data-testid="group-create" onSelect={onNewGroup}>{groupLabel('newGroup')}</DropdownMenuItem></DropdownMenuContent>
      </DropdownMenu>
    </div>
    <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block">
      <div className="py-1">
      {state.loading.projects && !state.projects.length && <ul className="m-0 flex list-none flex-col gap-1 p-0" role="status" aria-label={t('viewStates.loading')}>{[0, 1, 2].map(row => <li key={row} className="flex h-10 items-center gap-2.5 px-3"><Skeleton className="size-7 rounded-md" /><Skeleton className="h-3.5 flex-1" /></li>)}</ul>}
      {state.errors.projects && <><ErrorNotice error={state.errors.projects} /><Button variant="outline" onClick={() => { void store.loadProjects(); }}>{t('errors.retry')}</Button></>}
      <ReadFeedback error={list.error} loading={list.loading && !list.data} retry={refresh} />
      <SidebarTree projects={state.projects} view={view} collapsed={collapsed} onNavigate={onNavigate} projectStatus={projectStatus} />
      </div>
    </ScrollArea>
    <footer className="mt-auto flex shrink-0 flex-col gap-1 border-t border-border pt-3">
      <NavButton data-testid="sidebar-system" collapsed={collapsed} aria-label={t('systemUi.title')} aria-current={view === 'system' ? 'page' : undefined} onClick={() => onNavigate('system')}><Activity /><span className={labelClass}>{t('systemUi.title')}</span></NavButton>
      <div className="flex w-full items-center gap-1">
      <div className={cn('min-w-0 flex-1', collapsed && '[&_[data-slot=button]]:px-0')}><Settings store={store} collapsed={collapsed} /></div>
      <NavButton data-testid="sidebar-collapse" collapsed={collapsed} className={cn('w-10 justify-center px-0', collapsed && 'w-6')} aria-label={t(compact ? 'nav.close' : collapsed ? 'nav.expand' : 'nav.collapse')} aria-expanded={compact ? expanded : !collapsed} onClick={onCollapse}><CollapseIcon /></NavButton>
      </div>
    </footer>
  </nav>;
}
