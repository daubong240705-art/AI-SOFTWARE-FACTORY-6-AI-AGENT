import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PodKey, WorldAgent } from '../../data/types';
import { useWorldMotion } from '../Ticker';

export type AuraKind = 'flame' | 'super' | 'chill' | 'alarm' | 'storm' | 'stars' | null;
export type EffectsLevel = 'full' | 'lite' | 'off';
export function auraFor(agent: Pick<WorldAgent, 'status' | 'pose' | 'runs' | 'paused'>, now = Date.now()): AuraKind {
  if (agent.paused) return null;
  if (agent.status === 'working') {
    const started = Date.parse(agent.runs[0]?.startedAt ?? '');
    return Number.isFinite(started) && now - started > 20 * 60_000 ? 'super' : 'flame';
  }
  if (agent.status === 'waiting') return 'alarm';
  if (agent.status === 'problem') return 'storm';
  if (agent.status === 'done') return 'stars';
  return agent.status === 'idle' || agent.pose === 'thinking' ? 'chill' : null;
}
export const roleFlame: Record<PodKey, string> = {
  lead: '#F7C948', design: '#A78BFA', rules: '#F08A3C', art: '#F58FB0', client: '#2FBFA5', qa: '#4C9BF5', portal: '#F59E5B', annex: '#9BCB8B',
};
const ignore = () => {};
const tongue = new THREE.LatheGeometry([[0, 0], [0.15, 0.08], [0.17, 0.3], [0.09, 0.58], [0, 0.85]].map(([x, y]) => new THREE.Vector2(x!, y!)), 8);
const shell = new THREE.LatheGeometry([[0.49, 0], [0.66, 0.1], [0.7, 0.42], [0.59, 0.8], [0.48, 1.1]].map(([x, y]) => new THREE.Vector2(x!, y!)), 16);
const ring = new THREE.RingGeometry(0.55, 0.82, 24);
const bubble = new THREE.SphereGeometry(0.075, 8, 6);
const star = new THREE.OctahedronGeometry(0.08);
const pillar = new THREE.CylinderGeometry(0.65, 0.65, 2.3, 16, 1, true);
const cloud = (() => {
  const pieces = [[0, 0, 0.34], [-0.3, -0.06, 0.26], [0.3, -0.07, 0.27], [0.12, 0.17, 0.26]].map(([x, y, r]) => new THREE.SphereGeometry(r!, 10, 8).translate(x!, y!, 0));
  const merged = mergeGeometries(pieces)!; pieces.forEach(p => p.dispose()); return merged;
})();
const bolt = new THREE.ShapeGeometry(new THREE.Shape([[0.05, 0], [-0.12, -0.3], [0.02, -0.3], [-0.1, -0.6], [0.18, -0.2], [0.06, -0.2], [0.18, 0]].map(([x, y]) => new THREE.Vector2(x!, y!))));
const note = (() => {
  const head = new THREE.SphereGeometry(0.07, 8, 6).scale(1.3, 0.7, 0.6);
  const stem = new THREE.BoxGeometry(0.025, 0.24, 0.025).translate(0.07, 0.1, 0);
  const flag = new THREE.BoxGeometry(0.1, 0.035, 0.025).translate(0.11, 0.2, 0);
  const merged = mergeGeometries([head, stem, flag])!; head.dispose(); stem.dispose(); flag.dispose(); return merged;
})();
const materials = new Map<string, THREE.MeshBasicMaterial>();
function ink(color: string, opacity = 1) {
  const key = `${color}:${opacity}`;
  let material = materials.get(key);
  if (!material) {
    material = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity === 1, side: THREE.DoubleSide, forceSinglePass: true });
    materials.set(key, material);
  }
  return material;
}
/** Four draws maximum: shell, core tongues, outer tongues, embers. Particles are instances. */
export function Aura({ agent, level, quality, still, boost = 0, floorOffset = 0 }: {
  agent: Pick<WorldAgent, 'seatId' | 'status' | 'pose' | 'runs' | 'paused' | 'podKey'>; level: EffectsLevel; quality: 'high' | 'low'; still: boolean; boost?: number; floorOffset?: number;
}) {
  const kind = level === 'off' ? null : auraFor(agent);
  const lite = level === 'lite' || quality === 'low';
  const motion = useWorldMotion();
  const first = useRef<THREE.InstancedMesh>(null), second = useRef<THREE.InstancedMesh>(null), particles = useRef<THREE.InstancedMesh>(null);
  const column = useRef<THREE.Mesh>(null), flash = useRef<THREE.Mesh>(null);
  const born = useRef(performance.now()); const [finished, setFinished] = useState(false);
  const matrix = useMemo(() => new THREE.Object3D(), []);
  const alarm = useMemo(() => ink('#EE3344', 0.28).clone(), []);
  useEffect(() => () => alarm.dispose(), [alarm]);
  const seed = useMemo(() => [...agent.seatId].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 1000 / 159, [agent.seatId]);
  useEffect(() => {
    born.current = performance.now(); setFinished(false);
    if (kind !== 'stars' || still || lite) return;
    const timer = setTimeout(() => setFinished(true), 1600);
    return () => clearTimeout(timer);
  }, [kind, still, lite]);
  const animated = !!kind && !still && !lite && !(kind === 'stars' && finished);
  useEffect(() => { if (animated) return motion.request('ambient'); }, [animated, motion]);
  const percent = agent.runs[0]?.progress?.percent;
  const height = 0.75 + (percent == null ? 0.25 : Math.max(0, Math.min(100, percent)) / 200) + boost * 0.6;
  const color = kind === 'super' ? '#FFBB24' : roleFlame[agent.podKey];
  const flat = kind === 'flame' || kind === 'super' ? color : kind === 'alarm' ? '#EE3344' : kind === 'storm' ? '#6F7789' : kind === 'stars' ? '#E7AE24' : '#89BDAA';
  function paint(t: number, burst: number) {
    const put = (mesh: THREE.InstancedMesh | null, i: number, x: number, y: number, z: number, sx: number, sy = sx, sz = sx) => {
      if (!mesh) return;
      matrix.position.set(x, y, z); matrix.rotation.set(0, t * 0.4 + i, Math.sin(t + i) * 0.12); matrix.scale.set(sx, sy, sz); matrix.updateMatrix(); mesh.setMatrixAt(i, matrix.matrix);
    };
    if (kind === 'flame' || kind === 'super') {
      for (let i = 0; i < 5; i++) {
        const a = i * Math.PI * 2 / 5 + t * 0.35, flicker = 0.8 + Math.sin(t * 7 + i * 2) * 0.18;
        put(first.current, i, Math.cos(a) * 0.53, 0.02 + Math.max(0, Math.sin(t * 3 + i)) * 0.16, Math.sin(a) * 0.53, 0.9, height * flicker, 0.9);
        put(second.current, i, Math.cos(a + 0.35) * 0.65, 0.04 + ((t * 0.4 + i / 5) % 1) * 0.2, Math.sin(a + 0.35) * 0.65, 1.2, height * (1.05 + Math.sin(t * 5 + i) * 0.25), 1.2);
      }
      for (let i = 0; i < 6; i++) {
        const p = (t * 0.3 + i / 6) % 1, a = i * 2.4 + t * 0.2;
        put(particles.current, i, Math.cos(a) * (0.55 + p * 0.25), 0.2 + p * height * 1.8, Math.sin(a) * (0.55 + p * 0.25), (1 - p) * (kind === 'super' ? 0.9 : 0.55));
      }
    } else if (kind === 'chill') {
      for (let i = 0; i < 4; i++) {
        const a = i * 1.6 + t * 0.12, p = (t * 0.08 + i / 4) % 1;
        put(first.current, i, Math.cos(a) * 0.68, 0.25 + p * 1.6, Math.sin(a) * 0.68, 0.7 + p * 0.5);
        if (i < 2) put(second.current, i, Math.cos(a + 1) * 0.65, 0.35 + ((p + 0.25) % 1) * 1.6, Math.sin(a + 1) * 0.65, 0.75);
      }
    } else if (kind === 'stars') {
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        put(particles.current, i, Math.cos(a) * (0.3 + burst), 0.6 + burst * 0.8, Math.sin(a) * (0.3 + burst), Math.max(0, 1 - burst) * 1.4);
      }
    }
    for (const mesh of [first.current, second.current, particles.current]) if (mesh) { mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); }
    if (column.current) alarm.opacity = 0.18 + Math.abs(Math.sin(t * 3)) * 0.2;
    if (flash.current) flash.current.visible = !still && (t % 4.8 < 0.12 || t % 4.8 > 0.22 && t % 4.8 < 0.28);
  }
  useEffect(() => { paint(seed, 0.25); }, [kind, lite, seed, height]);
  useFrame(() => { if (animated) paint(performance.now() / 1000 + seed, Math.min(1, (performance.now() - born.current) / 1600)); });
  if (!kind) return null;
  if (lite) return <mesh geometry={ring} material={ink(flat, 0.75)} position={[0, floorOffset + 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={ignore} />;
  if (kind === 'flame' || kind === 'super') return <group>
    <mesh geometry={shell} material={ink(color, 0.3)} scale={[1, height, 1]} raycast={ignore} />
    <instancedMesh ref={first} args={[tongue, ink(kind === 'super' ? '#FFF3A6' : color, 0.94), 5]} raycast={ignore} />
    <instancedMesh ref={second} args={[tongue, ink(color, 0.38), 5]} raycast={ignore} />
    <instancedMesh ref={particles} args={[kind === 'super' ? star : bubble, ink('#FFD36A'), 6]} raycast={ignore} />
  </group>;
  if (kind === 'chill') return <group>
    <instancedMesh ref={first} args={[bubble, ink('#9BC9BF', 0.72), 4]} raycast={ignore} />
    <instancedMesh ref={second} args={[note, ink('#AA8DC4', 0.85), 2]} raycast={ignore} />
  </group>;
  if (kind === 'alarm') return <group>
    <mesh ref={column} geometry={pillar} material={alarm} position={[0, 1.15, 0]} raycast={ignore} />
    <mesh geometry={ring} material={ink('#EE3344', 0.8)} position={[0, floorOffset + 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={ignore} />
  </group>;
  if (kind === 'storm') return <group position={[0.15, 2.4, 0]}>
    <mesh geometry={cloud} material={ink('#697384')} raycast={ignore} />
    <mesh ref={flash} geometry={bolt} material={ink('#FFE34B')} position={[0, -0.15, 0.29]} rotation={[0, Math.PI / 4, 0]} visible={false} raycast={ignore} />
  </group>;
  return finished && !still ? null : <instancedMesh ref={particles} args={[star, ink('#EFB82E'), 8]} raycast={ignore} />;
}
