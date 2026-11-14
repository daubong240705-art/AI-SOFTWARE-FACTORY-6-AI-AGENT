import { deriveDisplayStatus, isLiveAttempt } from '@factory/contracts';
import { Activity, House, Inbox, PanelLeftClose, PanelLeftOpen, Plus, Users, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ErrorNotice } from '@/components/ErrorNotice';
import { cn } from '@/lib/utils';
import { useT } from '../../i18n';
import { useUiProfile } from '../../config/uiProfile';
import type { Store } from '../../state/store';
import { inboxCount } from '../Inbox';
import { attentionItems } from './attention';
import { NavButton } from './NavButton';
import { ProjectTile } from './ProjectTile';
import { Settings } from './Settings';
import type { View } from './navigation';

export function Sidebar({ store, view, collapsed, compact, expanded, onNavigate, onCreate, onCollapse }: {
  store: Store; view: View; collapsed: boolean; compact: boolean; expanded: boolean;
  onNavigate: (view: View) => void; onCreate: () => void; onCollapse: () => void;
}) {
  const t = useT(); const state = store.useStoreSelector(value => value); const addLabel = useUiProfile() === 'games' ? t('gameUi.newGame') : t('nav.addProject');
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
    <NavButton collapsed={collapsed} aria-label={t('nav.overview')} aria-current={view === 'overview' ? 'page' : undefined} onClick={() => onNavigate('overview')}><House /><span className={cn(labelClass, 'transition-opacity duration-150 motion-reduce:transition-none')}>{t('nav.overview')}</span></NavButton>
    <NavButton collapsed={collapsed} aria-label={`${t('nav.attention')}, ${inboxCount(t, items.length)}`} aria-current={view === 'needs-attention' ? 'page' : undefined} onClick={() => onNavigate('needs-attention')}><Inbox /><span className={cn(labelClass, 'transition-opacity duration-150 motion-reduce:transition-none')}>{t('nav.attention')}</span>{items.length > 0 && !collapsed && <Badge key={items.length} className="ml-auto min-w-[22px] animate-[pop_300ms_ease-out] motion-reduce:animate-none border-0 bg-need py-0 text-need-foreground">{items.length}</Badge>}</NavButton>
    <NavButton collapsed={collapsed} aria-label={t('nav.team')} aria-current={view === 'team' ? 'page' : undefined} onClick={() => onNavigate('team')}><Users /><span className={labelClass}>{t('nav.team')}</span></NavButton>
    <NavButton collapsed={collapsed} aria-label={t('systemUi.title')} aria-current={view === 'system' ? 'page' : undefined} onClick={() => onNavigate('system')}><Activity /><span className={labelClass}>{t('systemUi.title')}</span></NavButton>
    <div className={cn('mt-4 flex h-8 shrink-0 items-center justify-between px-2.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase', collapsed && 'justify-center px-0')}>
      <span className={collapsed ? 'sr-only' : ''}>{t('global.projects')}</span>
      <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon-xs" className="border-0 bg-transparent" aria-label={addLabel} onClick={onCreate}><Plus /></Button></TooltipTrigger><TooltipContent side="right">{addLabel}</TooltipContent></Tooltip>
    </div>
    <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block">
      <div className="py-1">
      {state.loading.projects && <p role="status" className="px-2 text-xs text-muted-foreground">{t('viewStates.loading')}</p>}
      {state.errors.projects && <><ErrorNotice error={state.errors.projects} /><Button variant="outline" onClick={() => { void store.loadProjects(); }}>{t('errors.retry')}</Button></>}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">{state.projects.map(project => <li key={project.id} className="h-10 w-full shrink-0">
        <NavButton collapsed={collapsed} aria-label={project.name} title={project.name} aria-current={view === `project:${project.id}` ? 'page' : undefined} onClick={() => onNavigate(`project:${project.id}`)}>
          <ProjectTile id={project.id} name={project.name} /><span className={labelClass}>{project.name}</span>
          {projectStatus(project.id) && <span className={cn('ml-auto size-2 shrink-0 rounded-full', projectStatus(project.id) === 'need' ? 'bg-need' : 'bg-run', collapsed && 'absolute top-1 right-0.5')} role="img" aria-label={t(projectStatus(project.id) === 'need' ? 'inboxUi.needsDecision' : 'taskUi.display.running')} title={t(projectStatus(project.id) === 'need' ? 'inboxUi.needsDecision' : 'taskUi.display.running')} />}
        </NavButton>
      </li>)}</ul>
      </div>
    </ScrollArea>
    <footer className="mt-auto flex shrink-0 items-center gap-1 border-t border-border pt-3">
      <div className={cn('min-w-0 flex-1', collapsed && '[&_[data-slot=button]]:px-0')}><Settings store={store} collapsed={collapsed} /></div>
      <NavButton collapsed={collapsed} className={cn('w-10 justify-center px-0', collapsed && 'w-6')} aria-label={t(compact ? 'nav.close' : collapsed ? 'nav.expand' : 'nav.collapse')} aria-expanded={compact ? expanded : !collapsed} onClick={onCollapse}><CollapseIcon /></NavButton>
    </footer>
  </nav>;
}
