import { Choice, ChoiceGroup, ChoiceOption } from '@/components/ui/choice';
import { WalkOverlay } from './scene/walk/WalkOverlay';
import { initialWalk, type WalkTarget } from './scene/walk/state';
import { toys } from './scene/toys/store';
import { tone } from './scene/toys/sound';
import { WorldHotbar } from './WorldHotbar';
import { playToy } from './scene/toys/playToy';
import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Project } from '@factory/contracts';
import { Mascot } from '@/components/mascot/Mascot';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import type { Handoff } from './data/types';
import { DockedPane } from '../DockedPane';
import './world.css';
import type { Store } from '@/state/store';
import type { View } from '../shell/navigation';
import { openFlowRoute } from '../shell/navigation';
import { attentionItems } from '../shell/attention';
import { attentionHash } from '../Attention';
import { useWorldCapability } from './capability';
import { emptyRender, emptyScene, useWorldDebug, type FallbackReason, type RenderStats } from './debugHook';
import { useWorldPreferences } from './preferences';
import { SceneErrorBoundary } from './SceneErrorBoundary';
import { WorldFallback } from './WorldFallback';
import { CameraRigProvider, initialCamera, useCameraRig, type CameraState } from './cameraContext';
import { layout } from './layout/waypoints';
import { ownerDesk, type Point } from './layout/zones';
import type { Locate } from './scene/CameraRig';
import type { AgentHover } from './scene/Agents';
import { WorldToolbar } from './WorldToolbar';
import { useWorldData } from './data/useWorldData';
import { WorldRoster } from './WorldRoster';
import { WorldActivity } from './WorldActivity';
import { AgentPanel } from './panels/AgentPanel';
import { OwnerPanel } from './panels/OwnerPanel';
import { chairmanTabFromHash, chairmanTabs, type ChairmanTab } from './panels/chairmanTabs';
import { chairmanChair, chairmanExit } from './layout/chairman';
import { TaskPanel } from './panels/TaskPanel';
import { agentStatusKey, deskForAgent } from './agentPresentation';

type Props = { store: Store; projects: readonly Project[]; onNavigate: (view: View) => void; onTask: (projectId: string, taskId: string) => void };
const WorldCanvas = lazy(() => import('./scene/WorldCanvas'));
export default function WorldPage(props: Props) { return <CameraRigProvider><WorldStudio {...props} /></CameraRigProvider>; }
function WorldStudio({ store, projects, onNavigate, onTask }: Props) {
  const data = useWorldData(); const camera = useCameraRig();
  const inbox = store.useStoreSelector(state => state.globalInbox); const attention = attentionItems(inbox).length;
  const [selected, setSelected] = useState<string | null>(() => chairmanTabFromHash() ? 'owner' : null); const [following, setFollowing] = useState(false);
  const [selectedTask, setSelectedTask] = useState<{ projectId: string; taskId: string } | null>(null);
  const courier = useRef<((handoff: Handoff) => void) | null>(null);
  const locations = useRef(new Map<string, readonly [number, number, number]>());
  const scope = useRef(0); const previousBaseline = useRef(data.baseline);
  if (previousBaseline.current && !data.baseline) scope.current++; previousBaseline.current = data.baseline;
  const [hover, setHover] = useState<AgentHover>(null);
  const positions = useRef(new Map<string, Point>()); const sceneDebug = useRef(emptyScene());
  const mapRef = useRef<HTMLDivElement>(null); const cameraState = useRef<CameraState>(initialCamera);
  const locate = useRef<Locate | null>(null);
  const onCamera = useCallback((value: CameraState) => { cameraState.current = value; setFollowing(value.following); }, []);
  const onLocate = useCallback((value: Locate | null) => { locate.current = value; }, []);
  const t = useT(); const hintId = useId(); const tooltipId = useId();
  const capability = useWorldCapability(); const [preferences, change] = useWorldPreferences();
  const [error, setError] = useState(false); const [attempt, setAttempt] = useState(0); const [ready, setReady] = useState(false);
  const [quality, setQuality] = useState<'high' | 'low'>(preferences.quality === 'low' ? 'low' : 'high');
  const stats = useRef<RenderStats>(emptyRender);
  const walk = useRef(initialWalk());
  const [hubTab, setHubTab] = useState<ChairmanTab>(() => chairmanTabFromHash() ?? 'projects');
  const chooseHubTab = useCallback((tab: ChairmanTab) => { setHubTab(tab); history.replaceState(null, '', `#/world?hub=${tab}`); }, []);
  useEffect(() => {
    const sync = () => { const tab = chairmanTabFromHash(); if (tab) { setHubTab(tab); setSelected('owner'); } };
    window.addEventListener('hashchange', sync); window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); };
  }, []);
  const [showWalkActivity, setShowWalkActivity] = useState(false);
  const canWalk = !capability.narrow && capability.finePointer;
  const walking = preferences.view === 'walk' && canWalk && !error && preferences.mode !== '2d';
  const panelOpen = !!(selected || selectedTask);
  const reason: FallbackReason | null = preferences.mode === '2d' ? 'preference' : !capability.webgl2 ? 'webgl' : capability.narrow ? 'narrow'
    : capability.reducedMotion && !walking && preferences.mode !== '3d' ? 'reduced-motion' : error ? 'error' : null;
  const still = preferences.still || capability.reducedMotion;
  useEffect(() => () => toys.clear(), []);
  useEffect(() => { toys.clear(); }, [scope.current]);
  const onReady = useCallback(() => setReady(true), []);
  const onError = useCallback(() => { setReady(false); stats.current = emptyRender; setError(true); }, []);
  const onRender = useCallback((value: RenderStats) => { stats.current = value; }, []);
  const onLoading = useCallback(() => { setReady(false); stats.current = emptyRender; }, []);
  const select = useCallback((id: string) => {
    const agent = data.model.agents.find(item => item.seatId === id); if (!agent) return;
    setSelectedTask(null); setSelected(id); setHover(null); change({ lineup: false }); data.setFocusProjectId(agent.projectId);
    const point = positions.current.get(id) ?? deskForAgent(agent)?.seat;
    if (point && !agent.overflow) camera.focusPoint(point, 70); else camera.follow(null);
  }, [data.model.agents, data.setFocusProjectId, camera, change]);
  const toySelect = useCallback((id: string) => { const tool = toys.snapshot().tool; if (tool) playToy(id, tool, still || preferences.effects === 'off'); else select(id); }, [still, preferences.effects, select]);
  const walkExit = useCallback(() => change({ view: 'iso' }), [change]);
  const openOwner = useCallback(() => { setSelectedTask(null); setSelected('owner'); setHover(null); change({ lineup: false }); camera.focusPoint(ownerDesk.position, 70); }, [camera, change]);
  useEffect(() => { if (selected === 'owner' && !walking) camera.focusPoint(ownerDesk.position, 70); }, [selected, walking, camera]);
  const close = () => { if (selected === 'owner') history.replaceState(null, '', '#/world'); if (walk.current.seated) { walk.current.seated = false; walk.current.position = [chairmanExit[0], 0, chairmanExit[1]]; } setSelected(null); setSelectedTask(null); camera.follow(null); };
  const openOffice = useCallback((tab: ChairmanTab | 'chair') => {
    if (tab === 'chair' && walking) { walk.current.seated = true; walk.current.position = [chairmanChair[0], 0.54, chairmanChair[1]]; walk.current.yaw = Math.PI; walk.current.firstPerson = false; }
    openOwner(); chooseHubTab(tab === 'chair' ? 'projects' : tab);
  }, [openOwner, chooseHubTab, walking]);
  const openTask = useCallback((projectId: string, taskId: string) => { setSelected(null); setSelectedTask({ projectId, taskId }); setHover(null); camera.follow(null); }, [camera]);
  useEffect(() => { if (reason && data.events.length) data.consumeEvents(data.events.map(event => event.id)); }, [reason, data.events, data.consumeEvents]);
  useEffect(() => { if (selected && selected !== 'owner' && !selected.startsWith('team:') && !data.model.agents.some(agent => agent.seatId === selected)) { setSelected(null); camera.follow(null); } }, [data.model.agents, selected, camera]);
  const toggleWalk = () => {
    if (!canWalk || reason) return;
    if (!walking) {
      const point = cameraState.current.target;
      walk.current.position = [point[0], 0, point[1]];
      walk.current.firstPerson = false;
      close(); setHover(null); setShowWalkActivity(false);
    }
    change({ view: walking ? 'iso' : 'walk', lineup: false });
  };
  const openRoom = useCallback((id: string, enter = false) => {
    data.setFocusProjectId(id);
    const room = data.model.rooms.find(item => item.id === id);
    if (room && walking && enter) { walk.current.position = [room.x - 10.6, 0, room.z + 1.8]; walk.current.target = null; }
    if (room && !walking) camera.focusPoint([room.x, room.z], 41);
  }, [camera, data.model.rooms, data.setFocusProjectId, walking]);
  const onWalkInteract = useCallback((target: WalkTarget) => {
    if (target.kind === 'agent') select(target.id);
    else if (target.kind === 'owner') openOffice('chair');
    else if (target.kind === 'office') { if (target.id === 'chair' || chairmanTabs.some(tab => tab === target.id)) openOffice(target.id as ChairmanTab | 'chair'); }
    else if (target.kind === 'task' && target.projectId) openTask(target.projectId, target.id);
    else if (target.kind === 'run' && target.projectId) openFlowRoute(target.projectId, { kind: 'runs', id: target.id });
    else if (target.kind === 'library') onNavigate('library');
    else if (target.kind === 'approval') onNavigate('needs-attention');
    else if (target.kind === 'board') { openRoom(target.id); openOffice('flows'); }
    else if (target.kind === 'project') openRoom(target.id);
    else if (target.kind === 'cat') { toys.spin(false, true); if (toys.snapshot().sound && !still && preferences.effects !== 'off') tone('oiia'); }
  }, [select, openOffice, openTask, openRoom, onNavigate, still, preferences.effects]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
      if (event.key.toLowerCase() === 'v' && !panelOpen && canWalk && !reason) { event.preventDefault(); toggleWalk(); }
      else if (event.key === 'Escape' && walking && !panelOpen) { event.preventDefault(); change({ view: 'iso' }); }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  });
  const agent = data.model.agents.find(item => item.seatId === selected);
  const hovered = hover ? data.model.agents.find(item => item.seatId === hover.seatId) : null;
  const sourceError = data.sources.projects?.state === 'error' || Object.entries(data.sources).some(([key, value]) => key.startsWith('agents:') && value.state === 'error');
  const activeSources = Object.entries(data.sources).filter(([key, value]) => value.state === 'error' && (
    ['projects', 'groups'].includes(key) || data.model.projects.some(project => ['agents', 'attempts', 'tasks', 'interactions', 'inbox', 'flows'].some(source => key === `${source}:${project.id}`))
    || data.model.workflows.some(item => key === `run:${item.run.id}`)));
  useWorldDebug(() => ({ version: 1, view: walking && !reason ? 'walk' : 'iso', walk: walk.current, mode: reason ? 'fallback' : ready ? '3d' : 'loading', fallbackReason: reason,
    ready: !reason && ready, quality, still, render: reason ? emptyRender : stats.current, camera: cameraState.current, layout,
    counts: { agents: data.model.agents.length, drawnAgents: reason || preferences.lineup ? 0 : data.model.agents.filter(item => !item.overflow && deskForAgent(item)).length, overflow: data.model.agents.filter(item => item.overflow).length, cards: sceneDebug.current.integration.cards, handoffsActive: sceneDebug.current.integration.handoffsActive, handoffsSeen: sceneDebug.current.integration.handoffsSeen },
    focusProjectId: data.model.focusProjectId,
    agents: data.model.agents.map(item => ({
      ...(sceneDebug.current.agents.find(row => row.seatId === item.seatId) ?? { seatId: item.seatId, ownerSeatId: item.ownerSeatId, slot: item.slot, name: item.name, pose: item.pose, podKey: item.podKey, deskId: deskForAgent(item)?.id ?? null, walking: false, wandering: false, activity: null }),
      status: item.status,
    })),
    toys: { combo: toys.snapshot().combo, sulking: toys.snapshot().sulking, catSpin: toys.snapshot().catSpin, oiiaMegaSpins: toys.snapshot().oiiaMegaSpins, oiiaSpins: toys.snapshot().oiiaSpins, tool: toys.snapshot().tool, active: toys.snapshot().active.map(({ worker, tool, until }) => ({ worker, tool, until })), counts: toys.snapshot().counts },
    characters: reason ? emptyScene().characters : sceneDebug.current.characters, director: sceneDebug.current.director, props: reason || preferences.lineup ? [] : sceneDebug.current.props, baseline: data.baseline, sources: data.sources, selected: selectedTask ? `task:${selectedTask.taskId}` : selected,
    locate: (kind, id) => reason || preferences.lineup && kind !== 'zone' ? null : locate.current?.(kind, id) ?? null }));
  return <div data-testid="world-screen" className={`world-page${walking ? ' world-walking' : ''}${panelOpen ? ' world-panel-open' : ''}`}>
    {reason ? <WorldFallback reason={reason} projects={projects} onSwitch={() => { setReady(false); change({ mode: '3d', ...(reason === 'reduced-motion' ? { still: true } : {}) }); }} onRetry={() => { setReady(false); setError(false); setAttempt(value => value + 1); }} /> : <>
      <div ref={mapRef} className="world-map" role="region" tabIndex={0} aria-label={t('worldUi.map')} aria-describedby={hintId}>
        <p id={hintId} className="sr-only">{t('worldUi.mapHint')}</p>
        <SceneErrorBoundary key={attempt} onError={onError}><Suspense fallback={<div className="world-loading" role="status"><Mascot seat="Lead" state="thinking" animated={false} /><span>{t('worldUi.loading')}</span></div>}>
          <WorldCanvas onOfficeOpen={openOffice} onWalkExit={walkExit} walking={walking} walk={walk} paused={panelOpen} onWalkInteract={onWalkInteract} events={data.events} scopeKey={scope.current} locations={locations} courier={courier} onTask={openTask} onEventsConsumed={data.consumeEvents} model={data.model} baseline={data.baseline} lineup={!walking && preferences.lineup} selected={selected} attention={attention} positions={positions} sceneDebug={sceneDebug} onSelect={toySelect} onOwner={openOwner} onHover={setHover} mapRef={mapRef} onCamera={onCamera} onLocate={onLocate} qualityPreference={preferences.quality} still={still} effects={preferences.effects} onReady={onReady} onLoading={onLoading} onError={onError} onQuality={setQuality} onRender={onRender} />
        </Suspense></SceneErrorBoundary>
        {walking && <WalkOverlay state={walk} positions={positions} paused={panelOpen} agents={data.model.agents} />}
      </div>
      <WorldHotbar walking={walking} collapsed={preferences.hotbarCollapsed} onCollapse={hotbarCollapsed => change({ hotbarCollapsed })} />
      <div className="world-left"><WorldToolbar canWalk={canWalk} walking={walking} onWalk={toggleWalk} showActivity={showWalkActivity} onActivity={() => setShowWalkActivity(value => !value)} onChairman={() => { if (walking) change({ view: 'iso' }); openOwner(); }} onNavigate={onNavigate} preferences={preferences} onChange={patch => { if (patch.lineup && walking) patch = { ...patch, view: 'iso' }; if (patch.lineup) { camera.follow(null); setSelected(null); setSelectedTask(null); } change(patch); }} />
        <div className="world-focus world-control"><label className="flex min-w-0 flex-1 items-center gap-2">{t('worldUi.campus.projects')} <Choice className="min-w-0 flex-1 truncate bg-transparent" value={data.focusProjectId ?? ''} disabled={!data.model.projects.length} onValueChange={selectedValue => openRoom(selectedValue)}>{!data.model.projects.length && <ChoiceOption value="">—</ChoiceOption>}{data.model.buildings.map(building => <ChoiceGroup key={building.id} label={building.name ?? t('worldUi.campus.shared')}>{building.rooms.map(project => <ChoiceOption key={project.id} value={project.id}>{project.name}</ChoiceOption>)}</ChoiceGroup>)}</Choice></label>{data.focusProjectId && <Button type="button" size="sm" variant="ghost" onClick={() => openRoom(data.focusProjectId!, true)}>{t('worldUi.campus.enter')}</Button>}</div>
        {!!activeSources.length && <div className="world-control flex flex-wrap items-center gap-2 p-2 text-sm"><span role="status">{t('worldUi.sourceError')}</span><Button size="sm" variant="outline" onClick={() => data.refresh(activeSources.map(([key]) => key))}>{t('errors.retry')}</Button></div>}
        <WorldRoster agents={data.model.agents} error={sourceError} loading={!data.model.loaded.activity} selected={selected} onSelect={select} onOwner={openOwner} onTask={openTask} /></div>
      {(!walking || showWalkActivity) && !(selected || selectedTask) && (() => { const focus = data.model.focusProjectId;
        const state = data.sources[`interactions:${focus}`]?.state;
        return <WorldActivity office={focus ? data.interactions[focus] : undefined} projectName={data.model.projects.find(project => project.id === focus)?.name ?? null}
          loading={!!focus && (!state || state === 'pending')} error={state === 'error'} onTask={taskId => { if (focus) openTask(focus, taskId); }} />; })()}
      {agent && <AgentPanel key={agent.seatId} agent={agent} following={following} onFollow={() => camera.follow(following ? null : () => positions.current.get(agent.seatId) ?? deskForAgent(agent)?.seat ?? [0, 0])} onClose={close} onTask={openTask} onReview={need => { onNavigate('needs-attention'); history.replaceState(null, '', attentionHash(attentionItems(inbox).find(item => item.key === `approval:${need.approvalId}`)?.key ?? (need.kind === 'start-gate' ? `gate:${need.taskId}` : `approval:${need.approvalId}`))); }} onTeam={() => { setSelected(`team:${agent.teamId}`); }} />}
      {selected?.startsWith('team:') && <DockedPane label={t('worldUi.team')} onClose={close} className="world-panel" fallbackFocus={() => mapRef.current}><Button variant="ghost" size="sm" onClick={close}>{t('worldUi.close')}</Button>{data.model.agents.filter(agent => `team:${agent.teamId}` === selected).map(agent => <Button key={agent.seatId} className="my-2 w-full" variant="outline" onClick={() => select(agent.seatId)}>{agent.name} · {agent.role}</Button>)}</DockedPane>}
      {selectedTask && <DockedPane key={`task:${selectedTask.projectId}:${selectedTask.taskId}`} label={t('worldUi.taskDetails.title')} onClose={close} className="world-panel" fallbackFocus={() => mapRef.current}><div className="mb-3 flex justify-end"><Button variant="ghost" size="sm" onClick={close}>{t('worldUi.close')}</Button></div><TaskPanel store={store} projectId={selectedTask.projectId} taskId={selectedTask.taskId} agents={data.model.agents} onTask={onTask} onFollow={seatId => { const target = data.model.agents.find(item => item.seatId === seatId); if (target) { camera.follow(() => positions.current.get(seatId) ?? deskForAgent(target)?.seat ?? [0, 0]); setFollowing(true); } }} onReview={key => { onNavigate('needs-attention'); history.replaceState(null, '', attentionHash(key)); }} /></DockedPane>}
      {selected === 'owner' && <OwnerPanel store={store} data={data} attention={attention} tab={hubTab} onTab={chooseHubTab} onClose={close} onNavigate={onNavigate} onTask={openTask} />}
      {!walking && hover && hovered && !preferences.lineup && <div id={tooltipId} role="tooltip" className="world-tooltip rounded-md border border-border bg-popover p-2 text-xs text-popover-foreground shadow-md" style={{ left: Math.max(8, Math.min(hover.x - (mapRef.current?.getBoundingClientRect().left ?? 0) + 14, (mapRef.current?.clientWidth ?? 800) - 230)), top: Math.max(8, Math.min(hover.y - (mapRef.current?.getBoundingClientRect().top ?? 0) + 14, (mapRef.current?.clientHeight ?? 600) - 100)) }}><strong>{hovered.name}</strong><p>{hovered.role}</p><p>{t(agentStatusKey(hovered))}</p>{hovered.runs[0] && <p>{hovered.runs[0].code}{hovered.runs[0].progress?.percent != null ? ` · ${hovered.runs[0].progress.percent}%` : ''}</p>}</div>}
    </>}
  </div>;
}
