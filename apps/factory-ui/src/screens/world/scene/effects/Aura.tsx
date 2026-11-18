import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { PodKey, WorldAgent } from '../../data/types';
import { useWorldMotion } from '../Ticker';

/** Which aura a worker shows. Derived only from its real state; cosmetic boosts (toys) only change the strength. */
export type AuraKind = 'flame' | 'super' | 'chill' | 'alarm' | 'storm' | 'stars' | null;
export type EffectsLevel = 'full' | 'lite' | 'off';
const SUPER_AFTER_MS = 20 * 60_000;

export function auraFor(agent: Pick<WorldAgent, 'status' | 'pose' | 'runs' | 'paused'>, now = Date.now()): AuraKind {
  if (agent.paused) return null;
  if (agent.status === 'working') {
    const started = Date.parse(agent.runs[0]?.startedAt ?? '');
    return Number.isFinite(started) && now - started >= SUPER_AFTER_MS ? 'super' : 'flame';
  }
  if (agent.status === 'waiting') return 'alarm';
  if (agent.status === 'problem') return 'storm';
  if (agent.status === 'done') return 'stars';
  if (agent.pose === 'idle' || agent.pose === 'thinking') return 'chill';
  return null; // resting keeps its "Zzz"
}

export const roleFlame: Record<PodKey, string> = {
  lead: '#F7C948', design: '#A78BFA', rules: '#F08A3C', art: '#F58FB0', client: '#2FBFA5', qa: '#4C9BF5', portal: '#F59E5B', annex: '#9BCB8B',
};
const ignore = () => {};

// Shared geometry and one material per colour keep every aura at one or two draw calls.
const flameGeometry = (() => {
  const points = [[0, 0], [0.5, 0.05], [0.62, 0.35], [0.55, 0.75], [0.36, 1.1], [0.16, 1.45], [0, 1.75]].map(([x, y]) => new THREE.Vector2(x!, y!));
  return new THREE.LatheGeometry(points, 18);
})();
const tongueGeometry = (() => {
  const points = [[0, 0], [0.13, 0.08], [0.15, 0.32], [0.08, 0.6], [0, 0.82]].map(([x, y]) => new THREE.Vector2(x!, y!));
  return new THREE.LatheGeometry(points, 8);
})();
const ringGeometry = new THREE.RingGeometry(0.55, 0.85, 40);
const bubbleGeometry = new THREE.SphereGeometry(0.07, 10, 8);
const pillarGeometry = new THREE.CylinderGeometry(0.62, 0.62, 2.4, 24, 1, true);
const cloudGeometry = (() => {
  const parts = [[0, 0, 0, 0.28], [0.26, -0.04, 0, 0.22], [-0.26, -0.05, 0, 0.21], [0.1, 0.12, 0.05, 0.2]].map(([x, y, z, r]) => new THREE.SphereGeometry(r!, 10, 8).translate(x!, y!, z!));
  const merged = new THREE.BufferGeometry();
  const positions: number[] = [], normals: number[] = [], index: number[] = [];
  for (const part of parts) {
    const offset = positions.length / 3;
    positions.push(...Array.from(part.getAttribute('position').array));
    normals.push(...Array.from(part.getAttribute('normal').array));
    for (const i of Array.from(part.getIndex()!.array)) index.push(i + offset);
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setIndex(index);
  return merged;
})();
const boltGeometry = new THREE.ShapeGeometry(new THREE.Shape([[0.05, 0], [-0.1, -0.3], [0.02, -0.3], [-0.12, -0.62], [0.16, -0.22], [0.04, -0.22], [0.16, 0]].map(([x, y]) => new THREE.Vector2(x!, y!))));
const starGeometry = new THREE.OctahedronGeometry(0.09, 0);

const glowMaterials = new Map<string, THREE.MeshBasicMaterial>();
function glow(color: string, opacity: number) {
  const key = `${color}:${opacity}`;
  let material = glowMaterials.get(key);
  if (!material) {
    material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    glowMaterials.set(key, material);
  }
  return material;
}
const cloudMaterial = new THREE.MeshStandardMaterial({ color: '#8A8F9C', roughness: 1 });
const boltMaterial = new THREE.MeshBasicMaterial({ color: '#FFE45C', side: THREE.DoubleSide });

/**
 * The aura around one worker. `boost` (0..1) temporarily strengthens it (a cosmetic toy); it never changes real state.
 * Animates only while visible, not still and effects are on; still mode shows a static aura.
 */
export function Aura({ agent, level, quality, still, boost = 0 }: {
  agent: Pick<WorldAgent, 'seatId' | 'status' | 'pose' | 'runs' | 'paused' | 'podKey'>; level: EffectsLevel; quality: 'high' | 'low'; still: boolean; boost?: number;
}) {
  const kind = level === 'off' ? null : auraFor(agent);
  const lite = level === 'lite' || quality === 'low';
  const motion = useWorldMotion();
  const animated = !!kind && !still && !lite;
  useEffect(() => { if (animated) return motion.request('ambient'); }, [animated, motion]);
  const flame = useRef<THREE.Mesh>(null); const tongues = useRef<THREE.Group>(null); const bubbles = useRef<THREE.Group>(null);
  const pillar = useRef<THREE.Mesh>(null); const bolt = useRef<THREE.Mesh>(null); const stars = useRef<THREE.Group>(null);
  const alarmMaterial = useMemo(() => glow('#F05252', 0.25).clone(), []);
  useEffect(() => () => alarmMaterial.dispose(), [alarmMaterial]);
  const born = useRef(performance.now());
  useEffect(() => { born.current = performance.now(); }, [kind]);
  const seed = useMemo(() => [...agent.seatId].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 1000 / 1000 * Math.PI * 2, [agent.seatId]);
  const percent = agent.runs[0]?.progress?.percent ?? null;
  const height = 0.75 + (percent === null ? 0.25 : Math.max(0, Math.min(100, percent)) / 100 * 0.5) + boost * 0.6;
  const color = kind === 'super' ? '#FFD447' : roleFlame[agent.podKey];
  useFrame(() => {
    if (!animated) return;
    const t = performance.now() / 1000 + seed;
    if (flame.current) {
      const f = 1 + Math.sin(t * 7.3) * 0.06 + Math.sin(t * 13.1) * 0.04;
      flame.current.scale.set(1 + Math.sin(t * 5.1) * 0.04, height * f, 1 + Math.cos(t * 4.7) * 0.04);
      flame.current.rotation.y = t * 0.8;
    }
    if (tongues.current) tongues.current.children.forEach((child, i) => {
      const phase = t * (3.2 + i * 0.7) + i * 2.1;
      child.scale.y = height * (0.7 + 0.45 * Math.abs(Math.sin(phase)));
      child.position.y = 0.05 + Math.max(0, Math.sin(phase * 0.5)) * 0.1;
    });
    if (tongues.current) tongues.current.rotation.y = -t * 1.3;
    if (bubbles.current) {
      bubbles.current.rotation.y = t * 0.35;
      bubbles.current.children.forEach((child, i) => { child.position.y = 0.35 + ((t * 0.18 + i / 5) % 1) * 1.1; child.scale.setScalar(0.6 + Math.sin(t * 2 + i) * 0.25); });
    }
    if (pillar.current) (pillar.current.material as THREE.MeshBasicMaterial).opacity = 0.12 + Math.abs(Math.sin(t * 3)) * 0.22;
    if (bolt.current) bolt.current.visible = (t * 0.7) % 3 < 0.18;
    if (stars.current) {
      const p = Math.min(1, (performance.now() - born.current) / 1600);
      stars.current.children.forEach((child, i) => {
        const a = i / stars.current!.children.length * Math.PI * 2;
        child.position.set(Math.cos(a) * (0.2 + p * 0.9), 0.6 + p * 0.7 + Math.sin(a * 2) * 0.1, Math.sin(a) * (0.2 + p * 0.9));
        child.rotation.y = t * 4; child.scale.setScalar(Math.max(0, 1 - p) * 1.4 + 0.001);
      });
    }
  });
  if (!kind) return null;
  if (lite) {
    const flat = kind === 'flame' || kind === 'super' ? color : kind === 'alarm' ? '#F05252' : kind === 'storm' ? '#8A8F9C' : kind === 'stars' ? '#FFD447' : '#BDE3D2';
    return <mesh geometry={ringGeometry} material={glow(flat, 0.55)} position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={ignore} />;
  }
  switch (kind) {
    case 'flame': case 'super':
      return <group raycast={ignore}>
        <mesh ref={flame} geometry={flameGeometry} material={glow(color, kind === 'super' ? 0.3 : 0.22)} scale={[1, height, 1]} raycast={ignore} />
        <group ref={tongues}>{[0, 1, 2].map(i => <mesh key={i} geometry={tongueGeometry} material={glow(kind === 'super' ? '#FFF1A8' : color, 0.45)} position={[Math.cos(i * Math.PI * 2 / 3) * 0.5, 0.05, Math.sin(i * Math.PI * 2 / 3) * 0.5]} scale={[1, height, 1]} raycast={ignore} />)}</group>
        <mesh geometry={ringGeometry} material={glow(color, 0.5)} position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={ignore} />
        {kind === 'super' && <group ref={stars}>{[0, 1, 2, 3, 4, 5].map(i => <mesh key={i} geometry={starGeometry} material={glow('#FFF1A8', 0.9)} raycast={ignore} />)}</group>}
      </group>;
    case 'chill':
      return <group ref={bubbles} raycast={ignore}>{[0, 1, 2, 3, 4].map(i => <mesh key={i} geometry={bubbleGeometry} material={glow(['#BDE3D2', '#CDBFE6', '#AFCFE6', '#F7DC8A', '#F2B8A9'][i]!, 0.6)} position={[Math.cos(i * 1.257) * 0.62, 0.4 + i * 0.2, Math.sin(i * 1.257) * 0.62]} raycast={ignore} />)}</group>;
    case 'alarm':
      return <mesh ref={pillar} geometry={pillarGeometry} material={alarmMaterial} position={[0, 1.2, 0]} raycast={ignore} />;
    case 'storm':
      return <group position={[0, 1.75, 0]} raycast={ignore}>
        <mesh geometry={cloudGeometry} material={cloudMaterial} raycast={ignore} />
        <mesh ref={bolt} geometry={boltGeometry} material={boltMaterial} position={[0, -0.18, 0.05]} raycast={ignore} visible={false} />
      </group>;
    case 'stars':
      return <group ref={stars} raycast={ignore}>{[0, 1, 2, 3, 4, 5, 6, 7].map(i => <mesh key={i} geometry={starGeometry} material={glow('#FFD447', 0.95)} raycast={ignore} />)}</group>;
  }
}
