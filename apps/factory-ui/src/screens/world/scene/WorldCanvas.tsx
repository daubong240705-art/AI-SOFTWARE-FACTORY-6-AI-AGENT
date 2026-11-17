import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { WorldPreferences } from '../preferences';
import type { RenderStats } from '../debugHook';
import { Ticker } from './Ticker';
import { softwareRenderer, useWorldQuality, type WorldQuality } from './quality';

type Props = {
  qualityPreference: WorldPreferences['quality']; still: boolean;
  onReady: () => void; onLoading: () => void; onError: () => void;
  onQuality: (quality: WorldQuality) => void; onRender: (stats: RenderStats) => void;
};
const background = new THREE.Color('#F7EEDC');
const cream = new THREE.Color('#FFF8E7');
const skirting = new THREE.Color('#E9D4AE');
const sky = new THREE.Color('#FFF6E0');
const ground = new THREE.Color('#E8D3B0');
const rugColors = [new THREE.Color('#E6D9BF'), new THREE.Color('#EBDDC6')] as const;
const cameraPosition: [number, number, number] = [80 / Math.sqrt(3), 80 / Math.sqrt(3), 80 / Math.sqrt(3)];

function StudioSlab() {
  const slab = useMemo(() => new RoundedBoxGeometry(36, 0.4, 28, 3, 0.18), []);
  const base = useMemo(() => new RoundedBoxGeometry(36.25, 0.25, 28.25, 3, 0.12), []);
  useEffect(() => () => { slab.dispose(); base.dispose(); }, [slab, base]);
  return <group>
    <mesh geometry={base} position={[0, -0.325, 0]}><meshStandardMaterial color={skirting} /></mesh>
    <mesh geometry={slab}><meshStandardMaterial color={cream} /></mesh>
    {Array.from({ length: 24 }, (_, index) => <mesh key={index} position={[(index % 6 - 2.5) * 5, 0.212, (Math.floor(index / 6) - 1.5) * 5]}>
      <boxGeometry args={[4.8, 0.024, 4.8]} /><meshStandardMaterial color={rugColors[(index + Math.floor(index / 6)) % 2] ?? rugColors[0]} />
    </mesh>)}
  </group>;
}
function SceneLifecycle({ onReady, onLoading, onError, onRender, fps }: Pick<Props, 'onReady' | 'onLoading' | 'onError' | 'onRender'> & { fps: number }) {
  const { gl, camera, size, invalidate } = useThree();
  const ready = useRef(false);
  const disposal = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(false);
  useEffect(() => {
    if (camera instanceof THREE.OrthographicCamera) {
      camera.zoom = Math.max(0.1, Math.min(size.width / 48, size.height / 30));
      camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); invalidate();
    }
  }, [camera, size.width, size.height, invalidate]);
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
    <hemisphereLight args={[sky, ground, 2]} />
    <directionalLight color={sky} position={[-30, 45, -20]} intensity={2.2} />
    <Ticker quality={quality} still={props.still} onMeasure={measure}>
      <SceneLifecycle onReady={props.onReady} onLoading={props.onLoading} onError={props.onError} onRender={props.onRender} fps={fps} />
      <StudioSlab />
    </Ticker>
  </Canvas>;
}
