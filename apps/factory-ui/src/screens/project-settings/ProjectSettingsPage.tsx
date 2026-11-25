import { useEffect, useId } from 'react';
import { BadgeCheck, Folder, GitBranch, Gauge, RefreshCw, ShieldCheck, Zap } from 'lucide-react';
import { Page } from '@/components/Page';
import { PageHeader, SplitView } from '@/components/app';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { shallowSelectionEqual } from '@/state/storeSelector';
import type { SettingsSection } from '../shell/navigation';
import { AutomationSettings } from './AutomationSettings';
import { BudgetSection } from './BudgetSection';
import { AutonomySection } from './AutonomySection';
import { ProjectCode } from '../ProjectCode';
import { ApprovalsSection } from './ApprovalsSection';
import { ArchiveProject } from './ArchiveProject';
import { ProjectGroupSection } from './ProjectGroupSection';

const sections = [
  { key: 'automation', icon: Zap }, { key: 'budget', icon: Gauge },
  { key: 'autonomy', icon: ShieldCheck }, { key: 'approvals', icon: BadgeCheck },
  { key: 'code', icon: GitBranch }, { key: 'group', icon: Folder },
] as const;

export function ProjectSettingsPage({ store, projectId, section, onSection }: {
  store: Store; projectId: string; section: SettingsSection; onSection: (section: SettingsSection) => void;
}) {
  const t = useT(); const id = useId();
  const state = store.useStoreSelector(value => ({ budget: value.budget, settings: value.settings, m3: value.m3, team: value.team, loading: value.loading }), shallowSelectionEqual);
  useEffect(() => store.watchM5('settings', store.loadSettings), [store, projectId]);
  const refresh = section === 'automation' ? store.loadAutomation : section === 'budget' ? store.loadBudget : section === 'autonomy' ? store.loadAutonomy : section === 'code' ? store.refreshCode : store.loadStandingApprovals;
  const busy = section === 'automation' ? ['rules', 'monitors', 'breakers'].some(area => state.loading[area]) : !!state.loading[section === 'approvals' ? 'standingApprovals' : section === 'code' ? 'integration' : section];
  const list = <div className="flex gap-2 overflow-x-auto lg:grid lg:content-start">{sections.map(({ key, icon: Icon }) =>
    <Button key={key} type="button" variant="ghost" className={cn('justify-start whitespace-nowrap', section === key && 'bg-secondary text-foreground')} aria-current={section === key ? 'page' : undefined} onClick={() => onSection(key)}><Icon aria-hidden="true" />{t(key === 'group' ? 'groupsUi.projectGroup' : key === 'code' ? `projectUi.${key}` : `shellUi.${key}`)}</Button>
  )}</div>;
  const detail = section === 'code' ? <ProjectCode key={projectId} store={store} projectId={projectId} />
    : section === 'automation' ? <AutomationSettings key={projectId} store={store} projectId={projectId} />
    : section === 'budget' ? <BudgetSection state={state} store={store} id={`${id}-budget`} />
    : section === 'autonomy' ? <AutonomySection key={projectId} projectId={projectId} state={state} store={store} id={`${id}-autonomy`} />
    : section === 'group' ? <ProjectGroupSection key={projectId} store={store} projectId={projectId} />
    : <ApprovalsSection key={projectId} projectId={projectId} state={state} store={store} id={`${id}-approvals`} />;
  return <Page className="min-w-0 space-y-6">
    <PageHeader title={t('shellUi.projectSettings')} actions={section !== 'group' && <Button type="button" variant="ghost" disabled={busy} onClick={() => void refresh()}><RefreshCw aria-hidden="true" />{t('m5Ui.refresh')}</Button>} />
    <SplitView persistentList className="lg:grid-cols-[14rem_minmax(0,1fr)]" list={list} detail={detail} listLabel={t('shellUi.projectSettings')} />
    <ArchiveProject store={store} projectId={projectId} />
  </Page>;
}
