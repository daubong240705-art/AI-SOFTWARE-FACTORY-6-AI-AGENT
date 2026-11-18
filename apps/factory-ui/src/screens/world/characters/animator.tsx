import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useWorldMotion } from '../scene/Ticker';
import { blendPose, samplePose, type PoseFrame } from './poses';
import type { Pose } from './spec';

type Entry = { speed: number; root: THREE.Group; pose: Pose; phase: number; frame: PoseFrame; from: PoseFrame; changedAt: number; open: THREE.Object3D; closed: THREE.Object3D; effects: THREE.Object3D };
type Registry = { entries: Set<Entry>; now: number; still: boolean; notify: () => void; owner: symbol | null };
const registries = new WeakMap<THREE.Scene, Registry>();
const AnimatorContext = createContext(false);
function registryFor(scene: THREE.Scene) {
  let registry = registries.get(scene);
  if (!registry) { registry = { entries: new Set(), now: 0, still: false, notify: () => {}, owner: null }; registries.set(scene, registry); }
  return registry;
}
function visible(root: THREE.Object3D) { let current: THREE.Object3D | null = root; while (current) { if (!current.visible) return false; current = current.parent; } return true; }
function apply(entry: Entry, frame: PoseFrame) {
  entry.root.position.y = frame.y; entry.root.scale.set(frame.sx, frame.sy, frame.sz); entry.root.rotation.set(frame.rx, frame.ry, frame.rz);
  entry.open.visible = !frame.closed; entry.closed.visible = frame.closed; entry.effects.visible = frame.effect !== null;
  entry.effects.position.y = frame.effectY;
  for (const mark of entry.effects.children) {
    mark.visible = mark.name === frame.effect || (frame.effect === '✦' && mark.name === 'sparkle-2');
    if (mark.name === '✦' || mark.name === 'sparkle-2') mark.scale.setScalar((mark.name === '✦' ? 0.27 : 0.18) * frame.sparkle);
  }
  entry.frame = frame;
}
/** Mount once per Canvas, inside Ticker. One frame callback drives every registered rig; Ticker owns all scheduling. */
export function useCharacterAnimator({ still = false }: { still?: boolean } = {}) {
  const scene = useThree(state => state.scene); const invalidate = useThree(state => state.invalidate); const motion = useWorldMotion();
  const registry = useMemo(() => registryFor(scene), [scene]); const token = useRef(Symbol('character-animator'));
  const release = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => {
    if (registry.owner !== null) throw new Error('Mount one CharacterAnimator per Canvas (nesting its component is supported)');
    registry.owner = token.current; registry.still = still;
    const syncMotion = () => {
      const active = !registry.still && [...registry.entries].some(entry => visible(entry.root));
      if (active && !release.current) release.current = motion.request('ambient');
      else if (!active && release.current) { release.current(); release.current = undefined; }
    };
    registry.notify = () => { syncMotion(); invalidate(); };
    registry.notify();
    return () => { registry.owner = null; registry.notify = () => {}; release.current?.(); release.current = undefined; };
  }, [registry, invalidate, motion, still]);
  useFrame(state => {
    const elapsed = state.clock.getElapsedTime(); registry.now = elapsed;
    for (const entry of registry.entries) {
      if (!visible(entry.root)) continue;
      const target = samplePose(entry.pose, entry.pose === 'working' ? elapsed * entry.speed : elapsed, entry.phase, registry.still);
      const progress = registry.still ? 1 : (elapsed - entry.changedAt) / 0.3;
      apply(entry, progress < 1 ? blendPose(entry.from, target, progress * progress * (3 - 2 * progress)) : target);
    }
    const active = !registry.still && [...registry.entries].some(entry => visible(entry.root));
    if (active && !release.current) release.current = motion.request('ambient');
    else if (!active && release.current) { release.current(); release.current = undefined; }
  });
}
function AnimatorOwner({ children, still }: { children?: ReactNode; still: boolean }) {
  useCharacterAnimator({ still }); return <AnimatorContext.Provider value={true}>{children}</AnimatorContext.Provider>;
}
/** Wrapping Lineup in a scene animator reuses the scene's one subscriber. */
export function CharacterAnimator({ children, still = false }: { children?: ReactNode; still?: boolean }) {
  const inherited = useContext(AnimatorContext);
  return inherited ? <>{children}</> : <AnimatorOwner still={still}>{children}</AnimatorOwner>;
}
export function useAnimatedCharacter(root: THREE.Group, pose: Pose, phase: number, speed = 1) {
  const scene = useThree(state => state.scene); const registry = useMemo(() => registryFor(scene), [scene]);
  const entry = useMemo<Entry>(() => {
    const frame = samplePose(pose, 0, phase, true);
    return { root, pose, phase, speed, frame, from: frame, changedAt: -Infinity,
      open: root.getObjectByName('eyes-open')!, closed: root.getObjectByName('eyes-closed')!, effects: root.getObjectByName('effects')! };
    // Pose/phase are updated below, without replacing the entry or losing its blend state.
  }, [root]);
  useLayoutEffect(() => { registry.entries.add(entry); apply(entry, samplePose(entry.pose, registry.now, entry.phase, registry.still)); registry.notify();
    return () => { registry.entries.delete(entry); registry.notify(); };
  }, [entry, registry]);
  useEffect(() => {
    if (entry.pose !== pose) { entry.from = { ...entry.frame }; entry.changedAt = registry.now; entry.pose = pose; }
    entry.phase = phase; entry.speed = speed; registry.notify();
  }, [entry, pose, phase, speed, registry]);
}
