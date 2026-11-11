import { ChevronLeft, ChevronRight, House, Inbox, Plus, Users, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ErrorNotice } from '@/components/ErrorNotice';
import { cn } from '@/lib/utils';
import { useT } from '../../i18n';
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
  const t = useT(); const state = store.useStoreSelector(value => value);
  const items = attentionItems(state.globalInbox);
  const streamLabel = state.stream === 'open' ? 'shell.live' : state.stream === 'closed' ? 'shell.offline' : 'shell.reconnecting';
  const labelClass = collapsed ? 'hidden' : 'min-w-0 truncate';
  const CollapseIcon = compact ? X : collapsed ? ChevronRight : ChevronLeft;
  return <nav id="factory-navigation" className="row-span-full flex h-full min-h-0 min-w-0 flex-col gap-1 border-r border-border bg-sidebar px-2.5 py-3.5" aria-label={t('nav.main')}>
    <div className={cn('flex shrink-0 items-center gap-2.5 px-2 pt-1 pb-3.5 font-display text-[19px] font-bold', collapsed && 'justify-center px-0')}>
      <span className="grid size-7 shrink-0 place-items-center rounded-[9px] bg-primary text-[17px] text-primary-foreground" aria-hidden="true">F</span>
      <span className={labelClass}>{t('shell.product')}</span>
    </div>
    <NavButton collapsed={collapsed} aria-label={t('nav.overview')} aria-current={view === 'overview' ? 'page' : undefined} onClick={() => onNavigate('overview')}><House /><span className={labelClass}>{t('nav.overview')}</span></NavButton>
    <NavButton collapsed={collapsed} aria-label={`${t('nav.attention')}, ${inboxCount(t, items.length)}`} aria-current={view === 'needs-attention' ? 'page' : undefined} onClick={() => onNavigate('needs-attention')}><Inbox /><span className={labelClass}>{t('nav.attention')}</span>{items.length > 0 && !collapsed && <Badge className="ml-auto min-w-[22px] border-0 bg-need py-0 text-need-foreground">{items.length}</Badge>}</NavButton>
    <NavButton collapsed={collapsed} aria-label={t('nav.team')} aria-current={view === 'team' ? 'page' : undefined} onClick={() => onNavigate('team')}><Users /><span className={labelClass}>{t('nav.team')}</span></NavButton>
    <h2 className={cn('mx-2.5 mt-4 mb-1 shrink-0 font-sans text-xs font-normal tracking-wide text-muted-foreground uppercase', collapsed && 'sr-only')}>{t('global.projects')}</h2>
    <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block">
      <div className="py-1">
      {state.loading.projects && <p role="status" className="px-2 text-xs text-muted-foreground">{t('viewStates.loading')}</p>}
      {state.errors.projects && <><ErrorNotice error={state.errors.projects} /><Button variant="outline" onClick={() => { void store.loadProjects(); }}>{t('errors.retry')}</Button></>}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">{state.projects.map(project => <li key={project.id} className="h-10 w-full shrink-0">
        <NavButton collapsed={collapsed} aria-label={project.name} title={project.name} aria-current={view === `project:${project.id}` ? 'page' : undefined} onClick={() => onNavigate(`project:${project.id}`)}>
          <ProjectTile id={project.id} name={project.name} /><span className={labelClass}>{project.name}</span>
          {items.some(item => item.projectId === project.id) && <span className={cn('ml-auto size-2 shrink-0 rounded-full bg-need', collapsed && 'absolute top-1 right-0.5')} role="img" aria-label={t('inboxUi.needsDecision')} title={t('inboxUi.needsDecision')} />}
          {state.selectedProjectId === project.id && <span className={cn('ml-auto size-[5px] shrink-0 rounded-full', state.stream === 'open' ? 'bg-ok' : state.stream === 'closed' ? 'bg-muted-foreground' : 'bg-run', collapsed && 'absolute right-0.5 bottom-1')} role="img" aria-label={t(streamLabel)} title={t(streamLabel)} />}
        </NavButton>
      </li>)}</ul>
      <NavButton collapsed={collapsed} aria-label={t('projects.create')} onClick={onCreate}><Plus /><span className={labelClass}>{t('nav.addProject')}</span></NavButton>
      </div>
    </ScrollArea>
    <footer className="mt-auto shrink-0 space-y-1 pt-3">
      <Settings store={store} collapsed={collapsed} />
      <NavButton collapsed={collapsed} aria-label={t(compact ? 'nav.close' : collapsed ? 'nav.expand' : 'nav.collapse')} aria-expanded={compact ? expanded : !collapsed} onClick={onCollapse}><CollapseIcon /><span className={labelClass}>{t(compact ? 'nav.close' : collapsed ? 'nav.expand' : 'nav.collapse')}</span></NavButton>
    </footer>
  </nav>;
}
