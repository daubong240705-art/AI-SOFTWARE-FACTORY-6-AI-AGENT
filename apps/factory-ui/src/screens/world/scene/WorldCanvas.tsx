import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CharacterAnimator, characterStats } from '../characters';
import { Lineup, lineupDimensions } from './Lineup';
import { Agents, type AgentHover, type AgentPositions } from './Agents';
import type { WorldModel } from '../data/types';
import { ownerDesk } from '../layout/zones';
import { deskForAgent } from '../agentPresentation';
import { useCameraRig } from '../cameraContext';
import { useT, i18n } from '@/i18n';
import { Environment } from './Environment';
import { CameraRig, type Locate } from './CameraRig';
import type { CameraState } from '../cameraContext';
import type { WorldPreferences } from '../preferences';
import type { SceneDebug, RenderStats } from '../debugHook';
import { Ticker } from './Ticker';
import { softwareRenderer, useWorldQuality, type WorldQuality } from './quality';

type Props = {
  model: WorldModel; baseline: boolean; lineup: boolean; selected: string | null; attention: number;
  positions: AgentPositions; sceneDebug: MutableRefObject<SceneDebug>;
  onSelect: (id: string) => void; onOwner: () => void; onHover: (hover: AgentHover) => void;
  qualityPreference: WorldPreferences['quality']; still: boolean;
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
function Cast({ props, quality }: { props: Props; quality: WorldQuality }) {
  const camera = useCameraRig(); useT();
  useEffect(() => { if (props.lineup) camera.focusPoint([0, 4], Math.min(62, 900 / lineupDimensions.width, 600 / lineupDimensions.depth)); else { const agent = props.model.agents.find(item => item.seatId === props.selected); const point = props.selected === 'owner' ? ownerDesk.position : props.positions.current.get(props.selected ?? '') ?? (agent ? deskForAgent(agent)?.seat : null); if (point) camera.focusPoint(point, 70); else camera.home(); } }, [props.lineup, camera]);
  useFrame(() => { props.sceneDebug.current.characters = characterStats(); });
  return <CharacterAnimator still={props.still}>
    <Agents agents={props.model.agents} baseline={props.baseline} quality={quality} still={props.still} hidden={props.lineup} selected={props.selected} positions={props.positions} debug={props.sceneDebug} onSelect={props.onSelect} onOwner={props.onOwner} onHover={props.onHover} attention={props.attention} />
    {props.lineup && <Lineup origin={[0, 4]} quality={quality} still={props.still} locale={i18n.locale} />}
  </CharacterAnimator>;
}
export default function WorldCanvas(props: Props) {
  const { quality, fps, measure, setSoftware } = useWorldQuality(props.qualityPreference);
  useEffect(() => props.onQuality(quality), [quality, props.onQuality]);
  return <Canvas key={quality} orthographic flat frameloop="demand" dpr={[1, quality === 'low' ? 1 : 2]}
    gl={{ antialias: quality === 'high', powerPreference: 'default' }}
    camera={{ position: cameraPosition, near: 0.1, far: 300, zoom: 16 }} aria-hidden="true"
    onCreated={({ gl }) => {
      gl.domElement.setAttribute('aria-hidden', 'true');
      setSoftware(softwareRenderer(gl.getContext()));
    }}>
    <color attach="background" args={[background]} />
    <hemisphereLight args={[sky, ground, 1.1]} />
    <directionalLight color={sky} position={[-30, 45, -20]} intensity={1.1} />
    <Ticker quality={quality} still={props.still} onMeasure={measure}>
      <SceneLifecycle onReady={props.onReady} onLoading={props.onLoading} onError={props.onError} onRender={props.onRender} fps={fps} />
      <CameraRig agentPositions={props.positions} mapRef={props.mapRef} still={props.still} onState={props.onCamera} onLocate={props.onLocate} />
      <group visible={!props.lineup}><Environment /></group>
      <Cast props={props} quality={quality} />
    </Ticker>
  </Canvas>;
}
