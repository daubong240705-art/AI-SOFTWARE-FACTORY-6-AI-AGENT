import { WalkOverlay } from './scene/walk/WalkOverlay';
import { initialWalk, type WalkTarget } from './scene/walk/state';
import { toys } from './scene/toys/store';
import { tone } from './scene/toys/sound';
import { WorldHotbar } from './WorldHotbar';
import { playToy } from './scene/toys/playToy';
import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Project } from '@factory/contracts';
import { Mascot } from '@/components/mascot/Mascot';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { DockedPane } from '../DockedPane';
import './world.css';
import type { Store } from '@/state/store';
import type { View } from '../shell/navigation';
import { openAgentCreate, openFlowRoute } from '../shell/navigation';
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
import { podCenter, readScope, resolveScope, saveScope, scopeFloor, scopeGroups, type WorldScope } from './data/scope';
import { WorldOtherGroups, WorldScopePicker } from './WorldScope';
import { shareEqual } from './data/shareEqual';

type Props = { store: Store; projects: readonly Project[]; onNavigate: (view: View) => void; onTask: (projectId: string, taskId: string) => void };
const WorldCanvas = lazy(() => import('./scene/WorldCanvas'));
export default function WorldPage(props: Props) { return <CameraRigProvider><WorldStudio {...props} /></CameraRigProvider>; }
function WorldStudio({ store, projects, onNavigate, onTask }: Props) {
  const data = useWorldData(); const camera = useCameraRig();
  const [choice, setChoice] = useState(readScope);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pickProject, setPickProject] = useState(false);
  const projectPickerId = useId();
  const groups = useMemo(() => scopeGroups(data.model), [data.model.groups, data.model.projects, data.model.recentProjects, data.model.agents]);
  const activeScope = resolveScope(groups, choice);
  const group = groups.options.find(option => option.id === activeScope.groupId)!;
  const groupsReady = !!data.model.groups || data.sources.groups?.state === 'error';
  const floor = useMemo(() => scopeFloor(data.model, groupsReady ? group : { ...group, projects: [] }, activeScope.projectId, expanded), [data.model.agents, data.model.projects, groupsReady, group, activeScope.projectId, expanded]);
  const lastPods = useRef(floor.pods);
  const pods = lastPods.current = shareEqual(lastPods.current, floor.pods);
  const focusInScope = floor.projects.some(project => project.id === data.model.focusProjectId);
  const scopeFocus = activeScope.projectId ?? data.model.recentProjects.find(project => floor.projects.some(item => item.id === project.id))?.id ?? null;
  const model = useMemo(() => ({ ...data.model, ...(!focusInScope ? {
    focusProjectId: null, workflows: [], workflowLoaded: false, tasks: { columns: { todo: [], doing: [], review: [], failed: [], done: [] }, overflow: { todo: 0, doing: 0, review: 0, failed: 0, done: 0 } }, handoffs: [],
  } : {}), agents: floor.agents, projects: floor.projects, floorSouth: floor.floorSouth }), [data.model, floor, focusInScope]);
  useEffect(() => {
    if (!focusInScope && scopeFocus !== null) data.setFocusProjectId(scopeFocus);
  }, [focusInScope, scopeFocus, data.setFocusProjectId]);
  useEffect(() => {
    if (choice || !data.model.loaded.projects || !group.projects.length || (!data.model.groups && data.sources.groups?.state !== 'error')) return;
    const observed = data.model.projects.every(project => ['agents', 'attempts', 'interactions'].every(source => {
      const state = data.sources[`${source}:${project.id}`]?.state;
      return state === 'ok' || state === 'error';
    }));
    if (observed) setChoice({ groupId: activeScope.groupId, projectId: null });
  }, [choice, data.model.loaded.projects, data.model.groups, data.model.projects, data.sources, group.projects.length, activeScope.groupId]);
  const visibleSeats = useMemo(() => new Set(floor.agents.map(agent => agent.seatId)), [floor.agents]);
  const events = useMemo(() => data.events.filter(event => event.type === 'poseChanged' ? visibleSeats.has(event.seatId) : event.handoff.projectId === model.focusProjectId
    && [event.handoff.from, event.handoff.to].every(endpoint => endpoint.kind !== 'seat' || visibleSeats.has(endpoint.seatId))), [data.events, visibleSeats, model.focusProjectId]);
  useEffect(() => {
    const visible = new Set(events);
    const omitted = data.events.filter(event => !visible.has(event));
    if (omitted.length) data.consumeEvents(omitted.map(event => event.id));
  }, [data.events, events, data.consumeEvents]);
  const inbox = store.useStoreSelector(state => state.globalInbox); const attention = attentionItems(inbox).length;
  const [selected, setSelected] = useState<string | null>(() => chairmanTabFromHash() ? 'owner' : null); const [following, setFollowing] = useState(false);
  const [selectedTask, setSelectedTask] = useState<{ projectId: string; taskId: string } | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const locations = useRef(new Map<string, readonly [number, number, number]>());
  const baselineScope = useRef(0); const previousBaseline = useRef(data.baseline);
  if (previousBaseline.current && !data.baseline) baselineScope.current++; previousBaseline.current = data.baseline;
  const sceneKey = JSON.stringify([baselineScope.current, activeScope.groupId, activeScope.projectId]);
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
  useEffect(() => { toys.clear(); }, [sceneKey]);
  const onReady = useCallback(() => setReady(true), []);
  const onError = useCallback(() => { setReady(false); stats.current = emptyRender; setError(true); }, []);
  const onRender = useCallback((value: RenderStats) => { stats.current = value; }, []);
  const onLoading = useCallback(() => { setReady(false); stats.current = emptyRender; }, []);
  const select = useCallback((id: string) => {
    const agent = floor.roster.find(item => item.seatId === id); if (!agent) return;
    setSelectedTask(null); setSelected(id); setHover(null); change({ lineup: false }); data.setFocusProjectId(agent.projectId);
    const pod = floor.pods.find(item => item.projectId === agent.projectId);
    if (pod?.collapsed) setExpanded(pod.projectId);
    const target = (pod?.collapsed ? scopeFloor(data.model, group, activeScope.projectId, pod.projectId).agents : floor.agents).find(item => item.seatId === id);
    const point = (!pod?.collapsed ? positions.current.get(id) : undefined) ?? (target ? deskForAgent(target)?.seat : undefined);
    if (point && !agent.overflow) camera.focusPoint(point, 70); else camera.follow(null);
  }, [floor, data.model, group, activeScope.projectId, data.setFocusProjectId, camera, change]);
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
  useEffect(() => { if (selected && selected !== 'owner' && !floor.roster.some(agent => agent.seatId === selected || `team:${agent.teamId}` === selected)) { setSelected(null); camera.follow(null); } }, [floor.roster, selected, camera]);
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
  const changeScope = (next: WorldScope) => {
    if (next.groupId === activeScope.groupId && next.projectId === activeScope.projectId) return;
    setChoice(next); saveScope(next); setExpanded(null); setPickProject(false); setHighlight(null);
    close(); setHover(null); positions.current.clear();
    const nextGroup = groups.options.find(option => option.id === next.groupId);
    data.setFocusProjectId(next.projectId ?? data.model.recentProjects.find(project => nextGroup?.projects.some(item => item.id === project.id))?.id ?? null);
    if (walking) { walk.current.position = [0, 0, 20]; walk.current.target = null; }
    else camera.focusPoint([0, 24], 16);
  };
  const addAgent = () => {
    if (activeScope.projectId) openAgentCreate(activeScope.projectId);
    else { setPickProject(true); document.getElementById(projectPickerId)?.focus(); }
  };
  const togglePod = useCallback((id: string) => {
    if (!floor.pods.some(pod => pod.projectId === id)) return;
    const next = expanded === id ? null : id;
    setExpanded(next); setHighlight(next); setHover(null);
    if (next) data.setFocusProjectId(next);
    const pod = scopeFloor(data.model, group, activeScope.projectId, next).pods.find(item => item.projectId === id);
    if (!walking && pod) { const { x, z } = podCenter(pod); camera.focusPoint([x, z], 24); }
  }, [activeScope.projectId, camera, data.model, data.setFocusProjectId, expanded, floor.pods, group, walking]);
  const onWalkInteract = useCallback((target: WalkTarget) => {
    if (target.kind === 'agent') select(target.id);
    else if (target.kind === 'owner') openOffice('chair');
    else if (target.kind === 'office') { if (target.id === 'chair' || chairmanTabs.some(tab => tab === target.id)) openOffice(target.id as ChairmanTab | 'chair'); }
    else if (target.kind === 'task' && target.projectId) openTask(target.projectId, target.id);
    else if (target.kind === 'run' && target.projectId) openFlowRoute(target.projectId, { kind: 'runs', id: target.id });
    else if (target.kind === 'library') onNavigate('library');
    else if (target.kind === 'approval') onNavigate('needs-attention');
    else if (target.kind === 'board') { data.setFocusProjectId(target.id); openOffice('flows'); }
    else if (target.kind === 'pod') togglePod(target.id);
    else if (target.kind === 'cat') { toys.spin(false, true); if (toys.snapshot().sound && !still && preferences.effects !== 'off') tone('oiia'); }
  }, [select, openOffice, openTask, data.setFocusProjectId, onNavigate, togglePod, still, preferences.effects]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
      if (event.key.toLowerCase() === 'v' && !panelOpen && canWalk && !reason) { event.preventDefault(); toggleWalk(); }
      else if (event.key === 'Escape' && walking && !panelOpen) { event.preventDefault(); change({ view: 'iso' }); }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  });
  const agent = floor.roster.find(item => item.seatId === selected);
  const hovered = hover ? floor.agents.find(item => item.seatId === hover.seatId) : null;
  const sourceError = data.sources.projects?.state === 'error' || floor.projects.some(project => data.sources[`agents:${project.id}`]?.state === 'error');
  const scopePicker = <WorldScopePicker groups={groups.options} group={group} scope={activeScope} onChange={changeScope} projectPickerId={projectPickerId} />;
  const otherGroups = <WorldOtherGroups groups={groups.options} group={group} onChange={changeScope} />;
  const activeSources = Object.entries(data.sources).filter(([key, value]) => value.state === 'error' && (
    ['projects', 'groups'].includes(key) || data.model.projects.some(project => ['agents', 'attempts', 'tasks', 'interactions', 'inbox', 'flows'].some(source => key === `${source}:${project.id}`))
    || data.model.workflows.some(item => key === `run:${item.run.id}`)));
  useWorldDebug(() => ({ version: 1, view: walking && !reason ? 'walk' : 'iso', walk: walk.current, mode: reason ? 'fallback' : ready ? '3d' : 'loading', fallbackReason: reason,
    ready: !reason && ready, quality, still, render: reason ? emptyRender : stats.current, camera: cameraState.current, layout,
    counts: { agents: floor.roster.length, drawnAgents: reason || preferences.lineup ? 0 : floor.agents.length, overflow: floor.roster.length - floor.agents.length, cards: sceneDebug.current.integration.cards, handoffsActive: sceneDebug.current.integration.handoffsActive, handoffsSeen: sceneDebug.current.integration.handoffsSeen },
    focusProjectId: model.focusProjectId,
    agents: floor.agents.map(item => ({
      ...(sceneDebug.current.agents.find(row => row.seatId === item.seatId) ?? { seatId: item.seatId, ownerSeatId: item.ownerSeatId, slot: item.slot, name: item.name, pose: item.pose, podKey: item.podKey, deskId: deskForAgent(item)?.id ?? null, walking: false, wandering: false, activity: null }),
      status: item.status,
    })),
    toys: { combo: toys.snapshot().combo, sulking: toys.snapshot().sulking, catSpin: toys.snapshot().catSpin, oiiaMegaSpins: toys.snapshot().oiiaMegaSpins, oiiaSpins: toys.snapshot().oiiaSpins, tool: toys.snapshot().tool, active: toys.snapshot().active.map(({ worker, tool, until }) => ({ worker, tool, until })), counts: toys.snapshot().counts },
    characters: reason ? emptyScene().characters : sceneDebug.current.characters, director: sceneDebug.current.director, props: reason || preferences.lineup ? [] : sceneDebug.current.props, baseline: data.baseline, sources: data.sources, selected: selectedTask ? `task:${selectedTask.taskId}` : selected,
    locate: (kind, id) => reason || preferences.lineup && kind !== 'zone' ? null : locate.current?.(kind, id) ?? null }));
  return <div data-testid="world-screen" className={`world-page${walking ? ' world-walking' : ''}${panelOpen ? ' world-panel-open' : ''}`}>
    {reason ? <WorldFallback reason={reason} projects={data.sources.projects?.state === 'error' && !data.model.loaded.projects ? projects : floor.projects} onSwitch={() => { setReady(false); change({ mode: '3d', ...(reason === 'reduced-motion' ? { still: true } : {}) }); }} onRetry={() => { setReady(false); setError(false); setAttempt(value => value + 1); }}>
      {scopePicker}{otherGroups}
      <Button size="sm" variant="outline" onClick={addAgent}>{t('worldUi.addAgent')}</Button>
      {pickProject && <p role="status" className="text-sm text-muted-foreground">{t('worldUi.pickProject')}</p>}
    </WorldFallback> : <>
      <div ref={mapRef} className="world-map" role="region" tabIndex={0} aria-label={t('worldUi.map')} aria-describedby={hintId}>
        <p id={hintId} className="sr-only">{t('worldUi.mapHint')}</p>
        <SceneErrorBoundary key={attempt} onError={onError}><Suspense fallback={<div className="world-loading" role="status"><Mascot seat="Lead" state="thinking" animated={false} /><span>{t('worldUi.loading')}</span></div>}>
          <WorldCanvas onOfficeOpen={openOffice} onWalkExit={walkExit} walking={walking} walk={walk} paused={panelOpen} onWalkInteract={onWalkInteract} events={events} scopeKey={sceneKey} locations={locations} onTask={openTask} onEventsConsumed={data.consumeEvents} model={model} pods={pods} compact={floor.compact} highlight={highlight ?? activeScope.projectId} baseline={data.baseline} lineup={!walking && preferences.lineup} selected={selected} attention={attention} positions={positions} sceneDebug={sceneDebug} onSelect={toySelect} onOwner={openOwner} onHover={setHover} mapRef={mapRef} onCamera={onCamera} onLocate={onLocate} qualityPreference={preferences.quality} still={still} effects={preferences.effects} onReady={onReady} onLoading={onLoading} onError={onError} onQuality={setQuality} onRender={onRender} />
        </Suspense></SceneErrorBoundary>
        {walking && <WalkOverlay state={walk} positions={positions} paused={panelOpen} agents={floor.agents} />}
      </div>
      <WorldHotbar walking={walking} collapsed={preferences.hotbarCollapsed} onCollapse={hotbarCollapsed => change({ hotbarCollapsed })} />
      <div className="world-left"><WorldToolbar canWalk={canWalk} walking={walking} onWalk={toggleWalk} showActivity={showWalkActivity} onActivity={() => setShowWalkActivity(value => !value)} onChairman={() => { if (walking) change({ view: 'iso' }); openOwner(); }} onNavigate={onNavigate} preferences={preferences} onChange={patch => { if (patch.lineup && walking) patch = { ...patch, view: 'iso' }; if (patch.lineup) { camera.follow(null); setSelected(null); setSelectedTask(null); } change(patch); }} />
        {scopePicker}{otherGroups}
        {!!activeSources.length && <div className="world-control flex flex-wrap items-center gap-2 p-2 text-sm"><span role="status">{t('worldUi.sourceError')}</span><Button size="sm" variant="outline" onClick={() => data.refresh(activeSources.map(([key]) => key))}>{t('errors.retry')}</Button></div>}
        <WorldRoster agents={floor.roster} pods={pods} compact={floor.compact} onPod={togglePod} highlight={highlight ?? activeScope.projectId} error={sourceError} loading={!groupsReady || !data.model.loaded.projects || floor.projects.some(project => !data.sources[`agents:${project.id}`] || data.sources[`agents:${project.id}`]?.state === 'pending')} selected={selected} onSelect={select} onOwner={openOwner} onTask={openTask} onAdd={addAgent} pickProject={pickProject} /></div>
      {(!walking || showWalkActivity) && !(selected || selectedTask) && (() => { const focus = model.focusProjectId;
        const state = data.sources[`interactions:${focus}`]?.state;
        return <WorldActivity office={focus ? data.interactions[focus] : undefined} projectName={data.model.projects.find(project => project.id === focus)?.name ?? null}
          loading={!!focus && (!state || state === 'pending')} error={state === 'error'} onTask={taskId => { if (focus) openTask(focus, taskId); }} />; })()}
      {agent && <AgentPanel key={agent.seatId} agent={agent} following={following} onFollow={() => camera.follow(following ? null : () => positions.current.get(agent.seatId) ?? deskForAgent(agent)?.seat ?? [0, 0])} onClose={close} onTask={openTask} onReview={need => { onNavigate('needs-attention'); history.replaceState(null, '', attentionHash(attentionItems(inbox).find(item => item.key === `approval:${need.approvalId}`)?.key ?? (need.kind === 'start-gate' ? `gate:${need.taskId}` : `approval:${need.approvalId}`))); }} onTeam={() => { setSelected(`team:${agent.teamId}`); }} />}
      {selected?.startsWith('team:') && <DockedPane label={t('worldUi.team')} onClose={close} className="world-panel" fallbackFocus={() => mapRef.current}><Button variant="ghost" size="sm" onClick={close}>{t('worldUi.close')}</Button>{floor.roster.filter(agent => `team:${agent.teamId}` === selected).map(agent => <Button key={agent.seatId} className="my-2 w-full" variant="outline" onClick={() => select(agent.seatId)}>{agent.name} · {agent.role}</Button>)}</DockedPane>}
      {selectedTask && <DockedPane key={`task:${selectedTask.projectId}:${selectedTask.taskId}`} label={t('worldUi.taskDetails.title')} onClose={close} className="world-panel" fallbackFocus={() => mapRef.current}><div className="mb-3 flex justify-end"><Button variant="ghost" size="sm" onClick={close}>{t('worldUi.close')}</Button></div><TaskPanel store={store} projectId={selectedTask.projectId} taskId={selectedTask.taskId} agents={floor.agents} onTask={onTask} onFollow={seatId => { const target = floor.agents.find(item => item.seatId === seatId); if (target) { camera.follow(() => positions.current.get(seatId) ?? deskForAgent(target)?.seat ?? [0, 0]); setFollowing(true); } }} onReview={key => { onNavigate('needs-attention'); history.replaceState(null, '', attentionHash(key)); }} /></DockedPane>}
      {selected === 'owner' && <OwnerPanel store={store} data={data} attention={attention} tab={hubTab} onTab={chooseHubTab} onClose={close} onNavigate={onNavigate} onTask={openTask} />}
      {!walking && hover && hovered && !preferences.lineup && <div id={tooltipId} role="tooltip" className="world-tooltip rounded-md border border-border bg-popover p-2 text-xs text-popover-foreground shadow-md" style={{ left: Math.max(8, Math.min(hover.x - (mapRef.current?.getBoundingClientRect().left ?? 0) + 14, (mapRef.current?.clientWidth ?? 800) - 230)), top: Math.max(8, Math.min(hover.y - (mapRef.current?.getBoundingClientRect().top ?? 0) + 14, (mapRef.current?.clientHeight ?? 600) - 100)) }}><strong>{hovered.name}</strong><p>{hovered.role}</p><p>{t(agentStatusKey(hovered))}</p>{hovered.runs[0] && <p>{hovered.runs[0].code}{hovered.runs[0].progress?.percent != null ? ` · ${hovered.runs[0].progress.percent}%` : ''}</p>}</div>}
    </>}
  </div>;
}
