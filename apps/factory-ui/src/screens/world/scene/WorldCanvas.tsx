import { useEffect, useRef, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Environment } from './Environment';
import { CameraRig, type Locate } from './CameraRig';
import type { CameraState } from '../cameraContext';
import type { WorldPreferences } from '../preferences';
import type { RenderStats } from '../debugHook';
import { Ticker } from './Ticker';
import { softwareRenderer, useWorldQuality, type WorldQuality } from './quality';

type Props = {
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
      <CameraRig mapRef={props.mapRef} still={props.still} onState={props.onCamera} onLocate={props.onLocate} />
      <Environment />
    </Ticker>
  </Canvas>;
}
