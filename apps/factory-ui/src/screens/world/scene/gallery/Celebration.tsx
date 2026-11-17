import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { GalleryItem } from '../../data/types';
import type { WorldEvent } from '../../data/events';
import type { WorldQuality } from '../quality';
import { useWorldMotion } from '../Ticker';
import { canvasTexture } from './coverTexture';
import { type GalleryLocale } from '../../copy';

export type CelebrationFrame = { item: GalleryItem; position: readonly [number, number, number]; yaw: number };
export type CelebrationProps = {
  frames: readonly CelebrationFrame[];
  events: readonly WorldEvent[];
  /** False while the caller is establishing/resetting the data baseline. */
  baselineReady?: boolean;
  quality: WorldQuality;
  still: boolean;
  locale?: GalleryLocale;
  onCelebrate?: (item: GalleryItem) => void;
};
type Active = { key: string; started: number; confetti: boolean };
const activeCounts = new Map<object, number>(); let celebrated = 0;
export function celebrationStats() {
  return { celebrating: [...activeCounts.values()].reduce((sum, count) => sum + count, 0), celebrated };
}
const releaseKey = (item: GalleryItem) => `${item.projectId}:${item.releaseId}`;
function makeRibbon(text: string) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
  const ctx = canvas.getContext('2d')!; const texture = canvasTexture(canvas); let disposed = false;
  function paint() {
    ctx.clearRect(0, 0, 512, 96); ctx.fillStyle = '#AF496B'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(512, 0); ctx.lineTo(488, 48); ctx.lineTo(512, 96); ctx.lineTo(0, 96); ctx.lineTo(24, 48); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#FFF8E7'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '600 42px "Inter Variable", sans-serif'; ctx.fillText(text, 256, 48, 450); texture.needsUpdate = true;
  }
  paint(); return { texture, refresh: () => { if (!disposed) paint(); }, dispose: () => { disposed = true; texture.dispose(); } };
}
function Ribbon({ locale }: { locale: GalleryLocale }) {
  const invalidate = useThree(state => state.invalidate); const [resource, setResource] = useState<ReturnType<typeof makeRibbon> | null>(null);
  useEffect(() => {
    const created = makeRibbon('New!'); setResource(created); invalidate();
    void document.fonts?.load('600 42px "Inter Variable"').then(() => { created.refresh(); invalidate(); }).catch(() => {});
    return created.dispose;
  }, [locale, invalidate]);
  return resource && <mesh position={[0, 2.22, 0.39]}>
    <planeGeometry args={[1.48, 0.28]} /><meshBasicMaterial map={resource.texture} transparent side={THREE.DoubleSide} depthWrite={false} />
  </mesh>;
}
function makeBurst(count: number, seed: string) {
  let state = 2166136261; for (let i = 0; i < seed.length; i += 1) state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  const random = () => { state = Math.imul(state, 1664525) + 1013904223 | 0; return (state >>> 0) / 4294967296; };
  const geometry = new THREE.PlaneGeometry(0.075, 0.11);
  const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });
  const mesh = new THREE.InstancedMesh(geometry, material, count); mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const colors = ['#E0A458', '#F2B8A9', '#AFCFE6', '#B5D3A7', '#CDBFE6', '#F7DC8A'];
  const particles = Array.from({ length: count }, (_, index) => {
    mesh.setColorAt(index, new THREE.Color(colors[index % colors.length]!));
    const angle = random() * Math.PI * 2; const speed = 0.35 + random() * 1.35;
    return { x: Math.cos(angle) * speed, z: Math.sin(angle) * speed, y: 1.2 + random() * 1.8, phase: random() * Math.PI * 2, spin: 1 + random() * 4 };
  });
  const matrix = new THREE.Object3D();
  function sample(elapsed: number) {
    const t = Math.max(0, Math.min(3, elapsed));
    particles.forEach((particle, index) => {
      matrix.position.set(particle.x * t + Math.sin(t * 2 + particle.phase) * t * 0.08, 1.65 + particle.y * t - 0.85 * t * t, 0.4 + particle.z * t);
      matrix.rotation.set(particle.phase + t * particle.spin, t * particle.spin * 0.7, t * particle.spin * 0.3);
      matrix.scale.setScalar(0.7 + index % 4 * 0.15); matrix.updateMatrix(); mesh.setMatrixAt(index, matrix.matrix);
    });
    material.opacity = 0.75 * Math.max(0, 1 - Math.pow(t / 3, 3)); mesh.instanceMatrix.needsUpdate = true;
  }
  sample(0);
  return { mesh, sample, dispose() { geometry.dispose(); material.dispose(); mesh.dispose(); } };
}
function Confetti({ started, quality, seed }: { started: number; quality: WorldQuality; seed: string }) {
  const motion = useWorldMotion(); const invalidate = useThree(state => state.invalidate);
  const resource = useRef<ReturnType<typeof makeBurst> | null>(null); const [mesh, setMesh] = useState<THREE.InstancedMesh | null>(null);
  useEffect(() => {
    const created = makeBurst(quality === 'high' ? 200 : 60, seed); resource.current = created; setMesh(created.mesh);
    created.sample((performance.now() - started) / 1000); const stop = motion.request('live'); invalidate();
    return () => { stop(); resource.current = null; created.dispose(); };
  }, [quality, seed, motion, invalidate, started]);
  useFrame(() => resource.current?.sample((performance.now() - started) / 1000));
  return mesh && <primitive object={mesh} dispose={null} />;
}
export function Celebration({ frames, events, baselineReady = true, quality, still, locale = 'vi', onCelebrate }: CelebrationProps) {
  const [active, setActive] = useState<Active[]>([]); const first = useRef(true); const seen = useRef(new Set<string>());
  const token = useRef({}); const invalidate = useThree(state => state.invalidate);
  useEffect(() => {
    // Every mount (including quality/context remounts) establishes a baseline.
    // Existing queued events never become a replay of historical releases.
    if (first.current || !baselineReady) {
      first.current = false; for (const frame of frames) seen.current.add(releaseKey(frame.item));
      for (const event of events) if (event.type === 'release') seen.current.add(`${event.release.projectId}:${event.release.releaseId}`);
      if (!baselineReady) setActive(old => old.length ? [] : old);
      return;
    }
    const next: Active[] = []; const notifications: GalleryItem[] = [];
    for (const event of events) {
      if (event.type !== 'release') continue;
      const key = `${event.release.projectId}:${event.release.releaseId}`;
      if (seen.current.has(key)) continue;
      const frame = frames.find(entry => releaseKey(entry.item) === key && entry.item.state === 'done');
      // Wait for its model slice if the queue arrives one render earlier.
      if (!frame) continue;
      seen.current.add(key); next.push({ key, started: performance.now(), confetti: !still }); notifications.push(frame.item);
    }
    if (next.length) {
      celebrated += next.length; setActive(old => [...old, ...next]); invalidate();
      for (const item of notifications) onCelebrate?.(item);
    }
  }, [events, frames, baselineReady, still, onCelebrate, invalidate]);
  useEffect(() => {
    if (still) setActive(old => old.some(entry => entry.confetti) ? old.map(entry => ({ ...entry, confetti: false })) : old);
  }, [still]);
  useEffect(() => {
    const now = performance.now(); const key = token.current;
    activeCounts.set(key, active.filter(entry => now - entry.started < 60000 && frames.some(frame => releaseKey(frame.item) === entry.key)).length);
    return () => { activeCounts.delete(key); };
  }, [active, frames]);
  useEffect(() => {
    if (!active.length) return;
    const now = performance.now(); const deadlines = active.map(entry => entry.started + (entry.confetti && now < entry.started + 3000 ? 3000 : 60000));
    const timer = window.setTimeout(() => {
      const time = performance.now();
      setActive(old => old.filter(entry => time < entry.started + 60000).map(entry => ({ ...entry, confetti: entry.confetti && time < entry.started + 3000 })));
      invalidate();
    }, Math.max(1, Math.min(...deadlines) - now));
    return () => window.clearTimeout(timer);
  }, [active, invalidate]);
  return <group>{active.map(entry => {
    const frame = frames.find(candidate => releaseKey(candidate.item) === entry.key);
    if (!frame || performance.now() >= entry.started + 60000) return null;
    return <group key={entry.key} position={frame.position} rotation={[0, frame.yaw, 0]}>
      <Ribbon locale={locale} />
      {!still && entry.confetti && <Confetti started={entry.started} quality={quality} seed={entry.key} />}
    </group>;
  })}</group>;
}
