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
import { useT, i18n } from '@/i18n';
import type { Bug, GalleryItem, Handoff } from './data/types';
import { FocusGamePicker } from './panels/FocusGamePicker';
import { BugPanel } from './panels/BugPanel';
import { ReleasePanel } from './panels/ReleasePanel';
import { DockedPane } from '../DockedPane';
import './world.css';
import type { Store } from '@/state/store';
import type { View } from '../shell/navigation';
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
import { StagePanel } from './panels/StagePanel';
import { TaskPanel } from './panels/TaskPanel';
import { agentStatusKey, deskForAgent } from './agentPresentation';

type Props = { store: Store; projects: readonly Project[]; onNavigate: (view: View) => void; onTask: (projectId: string, taskId: string) => void; onCreate: (kind: 'game' | 'task' | 'project') => void; onChat: (projectId: string) => void };
const WorldCanvas = lazy(() => import('./scene/WorldCanvas'));
export default function WorldPage(props: Props) { return <CameraRigProvider><WorldStudio {...props} /></CameraRigProvider>; }
function WorldStudio({ store, projects, onNavigate, onTask, onCreate, onChat }: Props) {
  const data = useWorldData(store); const camera = useCameraRig();
  const inbox = store.useStoreSelector(state => state.globalInbox); const attention = attentionItems(inbox).length;
  const [selected, setSelected] = useState<string | null>(null); const [following, setFollowing] = useState(false);
  const [selectedBug, setSelectedBug] = useState<Bug | null>(null); const [selectedRelease, setSelectedRelease] = useState<GalleryItem | null>(null);
  const [selectedStage, setSelectedStage] = useState<{ projectId: string; instanceId: string; key: string } | null>(null);
  const [selectedTask, setSelectedTask] = useState<{ projectId: string; taskId: string } | null>(null);
  const [announcement, setAnnouncement] = useState(''); const [celebration, setCelebration] = useState(0);
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
  const [showWalkActivity, setShowWalkActivity] = useState(false);
  const canWalk = !capability.narrow && capability.finePointer;
  const walking = preferences.view === 'walk' && canWalk && !error && preferences.mode !== '2d';
  const panelOpen = !!(selected || selectedBug || selectedRelease || selectedStage || selectedTask);
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
    setSelectedBug(null); setSelectedRelease(null); setSelectedTask(null); setSelectedStage(null); setSelected(id); setHover(null); change({ lineup: false }); data.setFocusProjectId(agent.runs[0]?.projectId ?? null);
    const point = positions.current.get(id) ?? deskForAgent(agent)?.seat;
    if (point && !agent.overflow) camera.focusPoint(point, 70); else camera.follow(null);
  }, [data.model.agents, data.setFocusProjectId, camera, change]);
  const toySelect = useCallback((id: string) => { const tool = toys.snapshot().tool; if (tool) playToy(id, tool, still || preferences.effects === 'off'); else select(id); }, [still, preferences.effects, select]);
  const walkExit = useCallback(() => change({ view: 'iso' }), [change]);
  const openOwner = useCallback(() => { setSelectedBug(null); setSelectedRelease(null); setSelectedTask(null); setSelectedStage(null); setSelected('owner'); setHover(null); change({ lineup: false }); camera.focusPoint(ownerDesk.position, 70); }, [camera, change]);
  const close = () => { setSelected(null); setSelectedBug(null); setSelectedRelease(null); setSelectedTask(null); setSelectedStage(null); camera.follow(null); };
  const openBug = useCallback((bug: Bug) => { setSelected(null); setSelectedRelease(null); setSelectedTask(null); setSelectedStage(null); setSelectedBug(bug); setHover(null); camera.follow(null); }, [camera]);
  const openRelease = useCallback((item: GalleryItem) => { setSelected(null); setSelectedBug(null); setSelectedTask(null); setSelectedStage(null); setSelectedRelease(item); setHover(null); camera.follow(null); }, [camera]);
  const openTask = useCallback((projectId: string, taskId: string) => { setSelected(null); setSelectedBug(null); setSelectedRelease(null); setSelectedStage(null); setSelectedTask({ projectId, taskId }); setHover(null); camera.follow(null); }, [camera]);
  const openStage = useCallback((key: string) => { const game = data.model.games.find(game => game.projectId === data.model.focusProjectId); if (!game?.workflow) return; setSelected(null); setSelectedBug(null); setSelectedRelease(null); setSelectedTask(null); setSelectedStage({ projectId: game.projectId, instanceId: game.workflow.instanceId, key }); camera.follow(null); }, [data.model.games, data.model.focusProjectId, camera]);
  const celebrate = useCallback((item: GalleryItem) => { setCelebration(performance.now()); setAnnouncement(i18n.t('worldUi.releaseAnnouncement').replace('{game}', item.name).replace('{version}', String(item.version ?? '—'))); }, []);
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
  const onWalkInteract = useCallback((target: WalkTarget) => {
    if (target.kind === 'agent') select(target.id);
    else if (target.kind === 'owner') openOwner();
    else if (target.kind === 'task' && target.projectId) openTask(target.projectId, target.id);
    else if (target.kind === 'stage') openStage(target.id);
    else if (target.kind === 'cat') { toys.spin(false, true); if (toys.snapshot().sound && !still && preferences.effects !== 'off') tone('oiia'); }
    else if (target.kind === 'bug') { const bug = data.model.bugs.find(item => item.id === target.id); if (bug) openBug(bug); }
    else if (target.kind === 'release') { const item = data.model.gallery.find(item => item.releaseId === target.id); if (item) openRelease(item); }
  }, [select, openOwner, openTask, openStage, openBug, openRelease, still, preferences.effects, data.model.bugs, data.model.gallery]);
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
  const sourceError = data.sources.activity?.state === 'error' || data.sources.teams?.state === 'error';
  useWorldDebug(() => ({ version: 1, view: walking && !reason ? 'walk' : 'iso', walk: walk.current, mode: reason ? 'fallback' : ready ? '3d' : 'loading', fallbackReason: reason,
    ready: !reason && ready, quality, still, render: reason ? emptyRender : stats.current, camera: cameraState.current, layout,
    counts: { agents: data.model.agents.length, drawnAgents: reason || preferences.lineup ? 0 : data.model.agents.filter(item => !item.overflow && deskForAgent(item)).length, overflow: data.model.agents.filter(item => item.overflow).length, cards: sceneDebug.current.integration.cards, handoffsActive: sceneDebug.current.integration.handoffsActive, handoffsSeen: sceneDebug.current.integration.handoffsSeen, bugs: sceneDebug.current.integration.bugs, galleryFrames: sceneDebug.current.integration.galleryFrames },
    table: { focusProjectId: data.model.focusProjectId, stages: data.model.stages }, events: { bugsDefeated: sceneDebug.current.integration.bugsDefeated, releasesCelebrated: sceneDebug.current.integration.releasesCelebrated }, celebrating: sceneDebug.current.integration.celebrating,
    agents: data.model.agents.map(item => ({
      ...(sceneDebug.current.agents.find(row => row.seatId === item.seatId) ?? { seatId: item.seatId, ownerSeatId: item.ownerSeatId, slot: item.slot, name: item.name, pose: item.pose, podKey: item.podKey, deskId: deskForAgent(item)?.id ?? null, walking: false, wandering: false, activity: null }),
      status: item.status,
    })),
    toys: { combo: toys.snapshot().combo, sulking: toys.snapshot().sulking, catSpin: toys.snapshot().catSpin, oiiaMegaSpins: toys.snapshot().oiiaMegaSpins, oiiaSpins: toys.snapshot().oiiaSpins, tool: toys.snapshot().tool, active: toys.snapshot().active.map(({ worker, tool, until }) => ({ worker, tool, until })), counts: toys.snapshot().counts },
    characters: reason ? emptyScene().characters : sceneDebug.current.characters, director: sceneDebug.current.director, props: reason || preferences.lineup ? [] : sceneDebug.current.props, baseline: data.baseline, sources: data.sources, selected: selectedTask ? `task:${selectedTask.taskId}` : selectedStage ? `stage:${selectedStage.key}` : selectedBug ? `bug:${selectedBug.id}` : selectedRelease ? `frame:${selectedRelease.releaseId}` : selected,
    locate: (kind, id) => reason || preferences.lineup && kind !== 'zone' ? null : locate.current?.(kind, id) ?? null }));
  return <div className={`world-page${walking ? ' world-walking' : ''}${panelOpen ? ' world-panel-open' : ''}`}>
    {reason ? <WorldFallback reason={reason} projects={projects} onNavigate={onNavigate} onSwitch={() => { setReady(false); change({ mode: '3d', ...(reason === 'reduced-motion' ? { still: true } : {}) }); }} onRetry={() => { setReady(false); setError(false); setAttempt(value => value + 1); }} /> : <>
      <div ref={mapRef} className="world-map" role="region" tabIndex={0} aria-label={t('worldUi.map')} aria-describedby={hintId}>
        <p id={hintId} className="sr-only">{t('worldUi.mapHint')}</p>
        <SceneErrorBoundary key={attempt} onError={onError}><Suspense fallback={<div className="world-loading" role="status"><Mascot seat="Lead" state="thinking" animated={false} /><span>{t('worldUi.loading')}</span></div>}>
          <WorldCanvas onWalkExit={walkExit} walking={walking} walk={walk} paused={panelOpen} onWalkInteract={onWalkInteract} events={data.events} reports={data.reports} scopeKey={scope.current} locations={locations} courier={courier} celebration={celebration} onTask={openTask} onStage={openStage} onBug={openBug} onRelease={openRelease} onCelebrate={celebrate} onEventsConsumed={data.consumeEvents} model={data.model} baseline={data.baseline} lineup={!walking && preferences.lineup} selected={selected} attention={attention} positions={positions} sceneDebug={sceneDebug} onSelect={toySelect} onOwner={openOwner} onHover={setHover} mapRef={mapRef} onCamera={onCamera} onLocate={onLocate} qualityPreference={preferences.quality} still={still} effects={preferences.effects} onReady={onReady} onLoading={onLoading} onError={onError} onQuality={setQuality} onRender={onRender} />
        </Suspense></SceneErrorBoundary>
        {walking && <WalkOverlay state={walk} positions={positions} paused={panelOpen} agents={data.model.agents} />}
      </div>
      <WorldHotbar walking={walking} collapsed={preferences.hotbarCollapsed} onCollapse={hotbarCollapsed => change({ hotbarCollapsed })} />
      <div className="world-left"><WorldToolbar canWalk={canWalk} walking={walking} onWalk={toggleWalk} showActivity={showWalkActivity} onActivity={() => setShowWalkActivity(value => !value)} preferences={preferences} onChange={patch => { if (patch.lineup && walking) patch = { ...patch, view: 'iso' }; if (patch.lineup) { camera.follow(null); setSelected(null); setSelectedBug(null); setSelectedRelease(null); setSelectedTask(null); setSelectedStage(null); } change(patch); }} /><FocusGamePicker className="world-focus world-control" games={data.model.games} focusProjectId={data.focusProjectId} onFocusGame={data.setFocusProjectId} locale={i18n.locale} /><WorldRoster agents={data.model.agents} error={sourceError} loading={!data.model.loaded.activity} selected={selected} onSelect={select} onOwner={openOwner} onTask={openTask} /></div>
      {(!walking || showWalkActivity) && !(selected || selectedBug || selectedRelease || selectedStage || selectedTask) && (() => { const focus = data.model.focusProjectId;
        return <WorldActivity office={focus ? data.interactions[focus] : undefined} gameName={data.model.games.find(game => game.projectId === focus)?.name ?? null}
          loading={!!focus && !data.sources[`interactions:${focus}`]} onTask={taskId => { if (focus) openTask(focus, taskId); }} />; })()}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
      {selectedBug && <DockedPane key={`bug:${selectedBug.id}`} label={t('worldUi.lab.bugDetails')} onClose={close} className="world-panel" fallbackFocus={() => mapRef.current}><BugPanel store={store} bug={data.model.bugs.find(b => b.id === selectedBug.id) ?? selectedBug} gameName={data.model.games.find(g => g.projectId === selectedBug.projectId)?.name ?? selectedBug.projectId} onClose={close} locale={i18n.locale} onTask={openTask} onOpenProject={projectId => onNavigate(`project:${projectId}`)} /></DockedPane>}
      {selectedRelease && <DockedPane key={`release:${selectedRelease.releaseId}`} label={selectedRelease.name} onClose={close} className="world-panel" fallbackFocus={() => mapRef.current}><div className="mb-4 flex justify-end"><Button variant="ghost" size="sm" onClick={close}>{t('worldUi.close')}</Button></div><ReleasePanel item={data.model.gallery.find(item => item.releaseId === selectedRelease.releaseId) ?? selectedRelease} locale={i18n.locale} releaseDate={data.model.releaseVersions[selectedRelease.projectId]?.releaseId === selectedRelease.releaseId ? data.model.releaseVersions[selectedRelease.projectId]?.at ?? null : null} /></DockedPane>}
      {agent && <AgentPanel key={agent.seatId} agent={agent} store={store} following={following} onFollow={() => camera.follow(following ? null : () => positions.current.get(agent.seatId) ?? deskForAgent(agent)?.seat ?? [0, 0])} onClose={close} onTask={openTask} onReview={need => { onNavigate('needs-attention'); history.replaceState(null, '', attentionHash(attentionItems(inbox).find(item => item.key === `approval:${need.approvalId}`)?.key ?? (need.kind === 'start-gate' ? `gate:${need.taskId}` : `approval:${need.approvalId}`))); }} onTeam={() => { setSelected(`team:${agent.teamId}`); }} />}
      {selectedStage && <DockedPane key={`stage:${selectedStage.projectId}:${selectedStage.key}`} label={t('worldUi.taskDetails.stage')} onClose={close} className="world-panel" fallbackFocus={() => mapRef.current}><Button variant="ghost" size="sm" onClick={close}>{t('worldUi.close')}</Button><StagePanel store={store} projectId={selectedStage.projectId} instanceId={selectedStage.instanceId} stageKey={selectedStage.key} onTask={openTask} /></DockedPane>}
      {selected?.startsWith('team:') && <DockedPane label={t('worldUi.team')} onClose={close} className="world-panel" fallbackFocus={() => mapRef.current}><Button variant="ghost" size="sm" onClick={close}>{t('worldUi.close')}</Button>{data.model.agents.filter(agent => `team:${agent.teamId}` === selected).map(agent => <Button key={agent.seatId} className="my-2 w-full" variant="outline" onClick={() => select(agent.seatId)}>{agent.name} · {agent.role}</Button>)}</DockedPane>}
      {selectedTask && <DockedPane key={`task:${selectedTask.projectId}:${selectedTask.taskId}`} label={t('worldUi.taskDetails.title')} onClose={close} className="world-panel" fallbackFocus={() => mapRef.current}><div className="mb-3 flex justify-end"><Button variant="ghost" size="sm" onClick={close}>{t('worldUi.close')}</Button></div><TaskPanel store={store} projectId={selectedTask.projectId} taskId={selectedTask.taskId} agents={data.model.agents} onTask={onTask} onFollow={seatId => { const target = data.model.agents.find(item => item.seatId === seatId); if (target) { camera.follow(() => positions.current.get(seatId) ?? deskForAgent(target)?.seat ?? [0, 0]); setFollowing(true); } }} onReview={key => { onNavigate('needs-attention'); history.replaceState(null, '', attentionHash(key)); }} /></DockedPane>}
      {selected === 'owner' && <OwnerPanel model={data.model} attention={attention} error={sourceError || data.sources.games?.state === 'error'} onClose={close} onCreate={onCreate} onChat={onChat} onAttention={() => onNavigate('needs-attention')} onTask={openTask} onStage={openStage} />}
      {!walking && hover && hovered && !preferences.lineup && <div id={tooltipId} role="tooltip" className="world-tooltip rounded-md border border-border bg-popover p-2 text-xs text-popover-foreground shadow-md" style={{ left: Math.max(8, Math.min(hover.x - (mapRef.current?.getBoundingClientRect().left ?? 0) + 14, (mapRef.current?.clientWidth ?? 800) - 230)), top: Math.max(8, Math.min(hover.y - (mapRef.current?.getBoundingClientRect().top ?? 0) + 14, (mapRef.current?.clientHeight ?? 600) - 100)) }}><strong>{hovered.name}</strong><p>{hovered.role}</p><p>{t(agentStatusKey(hovered))}</p>{hovered.runs[0] && <p>{hovered.runs[0].code}{hovered.runs[0].progress?.percent != null ? ` · ${hovered.runs[0].progress.percent}%` : ''}</p>}</div>}
    </>}
  </div>;
}
