import { useEffect, useMemo, useState } from 'react';
import { PageHeader, Section, ViewState } from '@/components/app';
import { Page } from '@/components/Page';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { DecisionDialog } from '../DecisionDialog';
import { AgentFeed } from './AgentFeed';
import { SeatPanel, SeatRow } from './SeatPresentation';
import { GamePipeline, orderGameSeats } from './GamePipeline';
import { useOfficeRead } from './useOfficeRead';
import { useProjectAttempts } from './useProjectAttempts';
import { orderSeats, type OfficeNeed } from './presentation';
import { RunSwimlane } from './RunSwimlane';

const views = new WeakMap<Store, 'now' | 'flow'>();
const DAY = 24 * 3600_000;
export function ProjectAgents({ store, projectId, onOpenTask, onOpenTab }: {
  store: Store; projectId: string; onOpenTask: (id: string) => void; onOpenTab: (tab: 'workflow' | 'knowledge') => void;
}) {
  const t = useT();
  useOfficeRead(store, projectId);
  const [view, setView] = useState<'now' | 'flow'>(() => views.get(store) ?? 'now');
  const [range, setRange] = useState(DAY);
  const [now, setNow] = useState(Date.now);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [decision, setDecision] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => { if (!document.hidden) setNow(Date.now()); };
    const timer = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, []);
  const state = store.useStoreSelector(value => ({
    office: value.office, officeError: value.errors.office, tasks: value.tasks, m5: value.m5, teams: value.m3.teams,
  }));
  useEffect(() => store.watchM5('workflows', store.loadWorkflows), [store, projectId]);
  const workflow = state.m5.workflows.filter(item => item.key === 'game-build')
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const detail = workflow ? state.m5.workflowDetails[workflow.id] : undefined;
  useEffect(() => { if (workflow) return store.watchM3('teams', store.loadTeams); }, [store, projectId, workflow?.id]);
  const seats = useMemo(() => {
    const source = state.office?.seats ?? [];
    return workflow ? orderGameSeats(source, detail, state.teams, state.tasks) : orderSeats(source);
  }, [state.office?.seats, workflow, detail, state.teams, state.tasks]);
  const project = useProjectAttempts(store, projectId, view === 'now' ? DAY : range, state.office);
  const selected = seats.find(seat => seat.id === selectedId);
  const openTask = (id: string) => { setSelectedId(null); onOpenTask(id); };
  const openNeed = (need: OfficeNeed) => {
    if (need.kind === 'start-gate') openTask(need.taskId);
    else setDecision(need.approvalId);
  };
  return <div className={`relative grid h-full min-h-0 min-w-0 overflow-hidden ${selected ? 'xl:grid-cols-[minmax(0,1fr)_30rem]' : 'grid-cols-1'}`}>
    <div className="min-h-0 min-w-0 overflow-y-auto"><Page className="space-y-5">
      <PageHeader title={t('agentUi.title')} actions={<ToggleGroup type="single" value={view}
        onValueChange={value => { if (value === 'now' || value === 'flow') { setView(value); views.set(store, value); setSelectedId(null); } }} aria-label={t('agentUi.views')}>
        <ToggleGroupItem type="button" value="now">{t('agentUi.now')}</ToggleGroupItem>
        <ToggleGroupItem type="button" value="flow">{t('agentUi.flow')}</ToggleGroupItem>
      </ToggleGroup>} />
      {workflow && <GamePipeline detail={detail} onOpenWorkflow={() => onOpenTab('workflow')} />}
      <ViewState error={state.officeError} onRetry={() => { void store.loadOffice(); }} />
      {project.error && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-need">
        <p>{t('agentUi.attemptsError')}</p><Button type="button" variant="outline" size="sm" onClick={project.retry}>{t('errors.retry')}</Button>
      </div>}
      {view === 'flow' ? <><ViewState loading={project.loading} /><RunSwimlane attempts={project.attempts} seats={seats} tasks={state.tasks}
        now={now} range={range} onRangeChange={setRange} loading={project.loading || project.error} onOpenTask={openTask} /></>
        : <div className={`grid min-w-0 gap-6 ${selected ? "2xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]" : "lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]"}`}>
          <Section title={t('agentUi.seats')} className="min-w-0">
            <ViewState loading={!state.office && !state.officeError} empty={!seats.length && !!state.office} emptyText={t('agentUi.noSeats')} />
            {seats.map(seat => <SeatRow key={seat.id} seat={seat} attempts={project.attempts} now={now} selected={seat.id === selectedId}
              onSelect={() => setSelectedId(seat.id)} onOpenTask={openTask} onNeed={openNeed} />)}
          </Section>
          <AgentFeed items={state.office?.items ?? []} now={now} onOpenTask={openTask} />
        </div>}
    </Page></div>
    {selected && <SeatPanel key={selected.id} store={store} seat={selected} attempts={project.attempts} now={now}
      onClose={() => setSelectedId(null)} onOpenTask={openTask} />}
    {decision && <DecisionDialog store={store} approvalId={decision} onClose={() => { setDecision(null); void store.loadOffice(); }} />}
  </div>;
}
