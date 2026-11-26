import { setScreenUploader } from './screenTexture';
import { WalkRig } from './walk/WalkRig';
import { OperatorAvatar } from './walk/OperatorAvatar';
import { WalkScenery, WalkLighting } from './walk/WalkScenery';
import { WalkPresenceContext, type WalkPresence } from './walk/awareness';
import type { WalkState, WalkTarget } from './walk/state';
import { memo, useEffect, useMemo, useRef, type MutableRefObject, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CharacterAnimator, characterStats } from '../characters';
import { Lineup, lineupDimensions } from './Lineup';
import { Agents, type AgentHover, type AgentPositions } from './Agents';
import type { WorldModel } from '../data/types';
import { ownerDesk } from '../layout/zones';
import { campusFootprints } from '../layout/campus';
import { podFootprints, type WorldPod } from '../data/scope';
import { studioNavigation } from '../layout/studioNavigation';
import { deskForAgent } from '../agentPresentation';
import { useCameraRig } from '../cameraContext';
import { useT, i18n } from '@/i18n';
import { Environment } from './Environment';
import { CameraRig, type Locate } from './CameraRig';
import type { CameraState } from '../cameraContext';
import type { WorldPreferences } from '../preferences';
import type { SceneDebug, RenderStats } from '../debugHook';
import { ToyPrewarm } from './toys/prewarm';
import { Ticker } from './Ticker';
import { Studio } from './Studio';
import { Campus } from './Campus';
import type { WorldEvent } from '../data/events';
import type { WorldLocations } from './CameraRig';
import { softwareRenderer, useWorldQuality, type WorldQuality } from './quality';
import type { ChairmanTab } from '../panels/chairmanTabs';

type Props = {
  onWalkExit: () => void; walking: boolean; walk: RefObject<WalkState>; paused: boolean; onWalkInteract: (target: WalkTarget) => void;
  model: WorldModel; pods: readonly WorldPod[]; compact: boolean; baseline: boolean; events: readonly WorldEvent[]; locations: WorldLocations; scopeKey: string; lineup: boolean; selected: string | null; attention: number;
  highlight: string | null;
  positions: AgentPositions; sceneDebug: MutableRefObject<SceneDebug>;
  onSelect: (id: string) => void; onTask: (projectId: string, taskId: string) => void; onEventsConsumed: (ids: readonly string[]) => void; onOwner: () => void; onHover: (hover: AgentHover) => void; onOfficeOpen?: (tab: ChairmanTab | 'chair') => void; approvalPulse?: number; phonePulse?: number;
  qualityPreference: WorldPreferences['quality']; still: boolean; effects: WorldPreferences['effects'];
  mapRef: RefObject<HTMLDivElement | null>; onCamera: (state: CameraState) => void; onLocate: (locate: Locate | null) => void;
  onReady: () => void; onLoading: () => void; onError: () => void;
  onQuality: (quality: WorldQuality) => void; onRender: (stats: RenderStats) => void;
};
const background = new THREE.Color('#F7EEDC');
const sky = new THREE.Color('#FFF6E0');
const ground = new THREE.Color('#E8D3B0');
const cameraPosition: [number, number, number] = [80 / Math.sqrt(3), 80 / Math.sqrt(3), 80 / Math.sqrt(3)];

function SceneLifecycle({ onReady, onLoading, onError, onRender, fps }: Pick<Props, 'onReady' | 'onLoading' | 'onError' | 'onRender'> & { fps: number }) {
  const { gl } = useThree();
  useEffect(() => { setScreenUploader(texture => gl.initTexture(texture)); return () => setScreenUploader(undefined); }, [gl]);
  const ready = useRef(false);
  const disposal = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(false);
  useEffect(() => {
    clearTimeout(disposal.current);
    alive.current = true; ready.current = false; onLoading();
    const lost = (event: Event) => { event.preventDefault(); onError(); };
    gl.domElement.addEventListener('webglcontextlost', lost);
    return () => {
      alive.current = false;
      gl.domElement.removeEventListener('webglcontextlost', lost);
      // Defer disposal so React StrictMode's effect replay can cancel it.
      disposal.current = setTimeout(() => gl.dispose(), 0);
    };
  }, [gl, onError, onLoading]);
  useEffect(() => {
    onRender({ calls: gl.info.render.calls, triangles: gl.info.render.triangles,
      geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, fps });
  }, [fps, gl, onRender]);
  useFrame(() => {
    // R3F renders after useFrame callbacks. Sample only after that render completes.
    queueMicrotask(() => {
      if (!alive.current) return;
      onRender({ calls: gl.info.render.calls, triangles: gl.info.render.triangles,
        geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, fps });
      if (!ready.current) { ready.current = true; onReady(); }
    });
  });
  return null;
}
function Cast({ props, quality, graph }: { props: Props; quality: WorldQuality; graph: ReturnType<typeof studioNavigation> }) {
  const camera = useCameraRig(); useT();
  useEffect(() => { if (props.lineup) camera.focusPoint([0, 4], Math.min(62, 900 / lineupDimensions.width, 600 / lineupDimensions.depth)); else { const agent = props.model.agents.find(item => item.seatId === props.selected); const point = props.selected === 'owner' ? ownerDesk.position : props.positions.current.get(props.selected ?? '') ?? (agent ? deskForAgent(agent)?.seat : null); if (point) camera.focusPoint(point, 70); else camera.home(); } }, [props.lineup, camera]);
  useFrame(() => { props.sceneDebug.current.characters = characterStats(); });
  return <CharacterAnimator still={props.still}>
    <Studio effects={props.effects} key={props.scopeKey} model={props.model} events={props.events} quality={quality} still={props.still} hidden={props.lineup} positions={props.positions} locations={props.locations} debug={props.sceneDebug} consumeEvents={props.onEventsConsumed} onTask={props.onTask} onOfficeOpen={props.onOfficeOpen ?? (() => {})} attention={props.attention} approvalPulse={props.approvalPulse ?? 0} phonePulse={props.phonePulse ?? 0} />
    <Campus model={props.model} pods={props.pods} compact={props.compact} highlight={props.highlight} hidden={props.lineup} onOpen={props.onWalkInteract} />
    <Agents key={props.scopeKey} events={props.events} agents={props.model.agents} floorSouth={props.model.floorSouth} route={graph} highlight={props.highlight} baseline={props.baseline} quality={quality} still={props.still} hidden={props.lineup} selected={props.selected} positions={props.positions} debug={props.sceneDebug} onSelect={props.onSelect} onOwner={props.onOwner} onHover={props.onHover} attention={props.attention} effects={props.effects} />
    {props.lineup && <Lineup origin={[0, 4]} quality={quality} still={props.still} locale={i18n.locale} />}
  </CharacterAnimator>;
}
function WorldCanvas(props: Props) {
  const { floorSouth } = props.model;
  const furniture = useMemo(() => [...campusFootprints(0), ...podFootprints(props.pods)], [props.pods]);
  const graph = useMemo(() => studioNavigation(floorSouth, furniture), [floorSouth, furniture]);
  const { quality, fps, measure, setSoftware, software } = useWorldQuality(props.qualityPreference);
  useEffect(() => props.onQuality(quality), [quality, props.onQuality]);
  const bumps = useRef(new Map<string, number>());
  const presence: WalkPresence = { active: props.walking && !props.paused, state: props.walk, bumps: bumps.current };
  return <Canvas key={quality} orthographic flat frameloop="demand" dpr={[1, quality === 'low' || software ? 1 : 2]}
    gl={{ antialias: quality === 'high', powerPreference: 'default' }}
    camera={{ position: cameraPosition, near: 0.1, far: 300, zoom: 16 }} aria-hidden="true"
    onCreated={({ gl }) => {
      gl.domElement.setAttribute('aria-hidden', 'true');
      setSoftware(softwareRenderer(gl.getContext()));
    }}>
    <color attach="background" args={[background]} />
    {props.walking ? <WalkLighting quality={quality} /> : <><hemisphereLight args={[sky, ground, 1.1]} /><directionalLight color={sky} position={[-30, 45, -20]} intensity={1.1} /></>}
    <WalkPresenceContext.Provider value={presence}>
    <Ticker interactive={props.walking} quality={quality} still={props.still} onMeasure={measure}>
      <ToyPrewarm />
      <SceneLifecycle onReady={props.onReady} onLoading={props.onLoading} onError={props.onError} onRender={props.onRender} fps={fps} />
      <CameraRig enabled={!props.walking} floorSouth={props.model.floorSouth} returnPoint={props.walk} agentPositions={props.positions} locations={props.locations} mapRef={props.mapRef} still={props.still} onState={props.onCamera} onLocate={props.onLocate} />
      <group visible={!props.lineup}><Environment graph={graph} /></group>
      {props.walking && <WalkScenery quality={quality} floorSouth={props.model.floorSouth} />}
      <Cast props={props} quality={quality} graph={graph} />
      {!props.walking && !props.lineup && <ReturnMarker state={props.walk} quality={quality} />}
      {props.walking && <WalkRig onExit={props.onWalkExit} state={props.walk} positions={props.positions} model={props.model} furniture={furniture} paused={props.paused} still={props.still} quiet={props.still || props.effects === 'off'} quality={quality} onInteract={props.onWalkInteract} />}
    </Ticker>
    </WalkPresenceContext.Provider>
  </Canvas>;
}

function ReturnMarker({ state, quality }: { state: RefObject<WalkState>; quality: WorldQuality }) {
  if (!state.current.visited) return null;
  const p = state.current.position;
  return <group position={[p[0], 0.055, p[2]]} raycast={() => {}}>
    <group rotation={[0, state.current.yaw + Math.PI, 0]}><OperatorAvatar quality={quality} /></group>
    <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.4, 0.48, 32]} /><meshBasicMaterial color="#C65742" transparent opacity={0.8} depthWrite={false} /></mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.1, 12]} /><meshBasicMaterial color="#FFF8E7" /></mesh>
  </group>;
}

export default memo(WorldCanvas);
