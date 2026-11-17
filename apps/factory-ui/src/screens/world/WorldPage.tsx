import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Project } from '@factory/contracts';
import { Mascot } from '@/components/mascot/Mascot';
import { useT } from '@/i18n';
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
import { AgentPanel } from './panels/AgentPanel';
import { OwnerPanel } from './panels/OwnerPanel';
import { agentStatusKey, deskForAgent, restForAgent } from './agentPresentation';

type Props = { store: Store; projects: readonly Project[]; onNavigate: (view: View) => void; onTask: (projectId: string, taskId: string) => void; onCreate: (kind: 'game' | 'task' | 'project') => void; onChat: (projectId: string) => void };
const WorldCanvas = lazy(() => import('./scene/WorldCanvas'));
export default function WorldPage(props: Props) { return <CameraRigProvider><WorldStudio {...props} /></CameraRigProvider>; }
function WorldStudio({ store, projects, onNavigate, onTask, onCreate, onChat }: Props) {
  const data = useWorldData(); const camera = useCameraRig();
  const inbox = store.useStoreSelector(state => state.globalInbox); const attention = attentionItems(inbox).length;
  const [selected, setSelected] = useState<string | null>(null); const [following, setFollowing] = useState(false);
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
  const reason: FallbackReason | null = preferences.mode === '2d' ? 'preference' : !capability.webgl2 ? 'webgl' : capability.narrow ? 'narrow'
    : capability.reducedMotion && preferences.mode !== '3d' ? 'reduced-motion' : error ? 'error' : null;
  const onReady = useCallback(() => setReady(true), []);
  const onError = useCallback(() => { setReady(false); stats.current = emptyRender; setError(true); }, []);
  const onRender = useCallback((value: RenderStats) => { stats.current = value; }, []);
  const onLoading = useCallback(() => { setReady(false); stats.current = emptyRender; }, []);
  const select = useCallback((id: string) => {
    const agent = data.model.agents.find(item => item.seatId === id); if (!agent) return;
    setSelected(id); setHover(null); change({ lineup: false }); data.setFocusProjectId(agent.runs[0]?.projectId ?? null);
    const drawn = data.model.agents.filter(item => !item.overflow);
    const point = positions.current.get(id) ?? (agent.pose === 'resting' ? restForAgent(Math.max(0, drawn.findIndex(item => item.seatId === id))).point : deskForAgent(agent)?.seat);
    if (point && !agent.overflow) camera.focusPoint(point, 70); else camera.follow(null);
  }, [data.model.agents, data.setFocusProjectId, camera, change]);
  const openOwner = useCallback(() => { setSelected('owner'); setHover(null); change({ lineup: false }); camera.focusPoint(ownerDesk.position, 70); }, [camera, change]);
  const close = () => { setSelected(null); camera.follow(null); data.setFocusProjectId(null); };
  useEffect(() => { if (data.events.length) data.consumeEvents(); }, [data.events, data.consumeEvents]);
  useEffect(() => { if (selected && selected !== 'owner' && !data.model.agents.some(agent => agent.seatId === selected)) { setSelected(null); camera.follow(null); } }, [data.model.agents, selected, camera]);
  const agent = data.model.agents.find(item => item.seatId === selected);
  const hovered = hover ? data.model.agents.find(item => item.seatId === hover.seatId) : null;
  const sourceError = data.sources.activity?.state === 'error' || data.sources.teams?.state === 'error';
  useWorldDebug(() => ({ version: 1, mode: reason ? 'fallback' : ready ? '3d' : 'loading', fallbackReason: reason,
    ready: !reason && ready, quality, still: preferences.still, render: reason ? emptyRender : stats.current, camera: cameraState.current, layout,
    counts: { agents: data.model.agents.length, drawnAgents: reason || preferences.lineup ? 0 : data.model.agents.filter(item => !item.overflow && deskForAgent(item)).length, overflow: data.model.agents.filter(item => item.overflow).length },
    agents: data.model.agents.map(item => sceneDebug.current.agents.find(row => row.seatId === item.seatId) ?? { seatId: item.seatId, name: item.name, status: item.status, pose: item.pose, podKey: item.podKey, deskId: deskForAgent(item)?.id ?? null, walking: false }),
    characters: reason ? emptyScene().characters : sceneDebug.current.characters, director: sceneDebug.current.director, baseline: data.baseline, sources: data.sources, selected,
    locate: (kind, id) => reason || preferences.lineup && kind !== 'zone' ? null : locate.current?.(kind, id) ?? null }));
  return <div className="world-page">
    {reason ? <WorldFallback reason={reason} projects={projects} onNavigate={onNavigate} onSwitch={() => { setReady(false); change({ mode: '3d', ...(reason === 'reduced-motion' ? { still: true } : {}) }); }} onRetry={() => { setReady(false); setError(false); setAttempt(value => value + 1); }} /> : <>
      <div ref={mapRef} className="world-map" role="region" tabIndex={0} aria-label={t('worldUi.map')} aria-describedby={hintId}>
        <p id={hintId} className="sr-only">{t('worldUi.mapHint')}</p>
        <SceneErrorBoundary key={attempt} onError={onError}><Suspense fallback={<div className="world-loading" role="status"><Mascot seat="Lead" state="thinking" animated={false} /><span>{t('worldUi.loading')}</span></div>}>
          <WorldCanvas model={data.model} baseline={data.baseline} lineup={preferences.lineup} selected={selected} attention={attention} positions={positions} sceneDebug={sceneDebug} onSelect={select} onOwner={openOwner} onHover={setHover} mapRef={mapRef} onCamera={onCamera} onLocate={onLocate} qualityPreference={preferences.quality} still={preferences.still} onReady={onReady} onLoading={onLoading} onError={onError} onQuality={setQuality} onRender={onRender} />
        </Suspense></SceneErrorBoundary>
      </div>
      <div className="world-left"><WorldToolbar preferences={preferences} onChange={patch => { if (patch.lineup) { camera.follow(null); setSelected(null); } change(patch); }} /><WorldRoster agents={data.model.agents} error={sourceError} loading={!data.model.loaded.activity} selected={selected} onSelect={select} onOwner={openOwner} /></div>
      {agent && <AgentPanel key={agent.seatId} agent={agent} store={store} following={following} onFollow={() => camera.follow(following ? null : () => positions.current.get(agent.seatId) ?? deskForAgent(agent)?.seat ?? [0, 0])} onClose={close} onTask={onTask} onReview={need => { onNavigate('needs-attention'); history.replaceState(null, '', attentionHash(attentionItems(inbox).find(item => item.key === `approval:${need.approvalId}`)?.key ?? (need.kind === 'start-gate' ? `gate:${need.taskId}` : `approval:${need.approvalId}`))); }} onTeam={() => onNavigate('team')} />}
      {selected === 'owner' && <OwnerPanel model={data.model} attention={attention} error={sourceError || data.sources.games?.state === 'error'} onClose={close} onCreate={onCreate} onChat={onChat} onAttention={() => onNavigate('needs-attention')} />}
      {hover && hovered && !preferences.lineup && <div id={tooltipId} role="tooltip" className="world-tooltip rounded-md border border-border bg-popover p-2 text-xs text-popover-foreground shadow-md" style={{ left: Math.max(8, Math.min(hover.x - (mapRef.current?.getBoundingClientRect().left ?? 0) + 14, (mapRef.current?.clientWidth ?? 800) - 230)), top: Math.max(8, Math.min(hover.y - (mapRef.current?.getBoundingClientRect().top ?? 0) + 14, (mapRef.current?.clientHeight ?? 600) - 100)) }}><strong>{hovered.name}</strong><p>{hovered.role}</p><p>{t(agentStatusKey(hovered))}</p>{hovered.runs[0] && <p>{hovered.runs[0].code}{hovered.runs[0].progress?.percent != null ? ` · ${hovered.runs[0].progress.percent}%` : ''}</p>}</div>}
    </>}
  </div>;
}
