import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useWorldMotion } from '../scene/Ticker';
import { blendPose, samplePose, type PoseFrame } from './poses';
import type { Pose } from './spec';
import { updateReactionMarks } from './reactionMarks';
import { reactToToy, type Reaction, type ReactionSample } from './reaction';

type Entry = { reaction: Reaction; speed: number; root: THREE.Group; pose: Pose; phase: number; frame: PoseFrame; from: PoseFrame; changedAt: number; open: THREE.Object3D; closed: THREE.Object3D; effects: THREE.Object3D; marks: THREE.Object3D; sample: ReactionSample; held: PoseFrame; holding: boolean };
type Registry = { entries: Set<Entry>; now: number; still: boolean; notify: () => void; owner: symbol | null };
const registries = new WeakMap<THREE.Scene, Registry>();
const AnimatorContext = createContext(false);
function registryFor(scene: THREE.Scene) {
  let registry = registries.get(scene);
  if (!registry) { registry = { entries: new Set(), now: 0, still: false, notify: () => {}, owner: null }; registries.set(scene, registry); }
  return registry;
}
function visible(root: THREE.Object3D) { let current: THREE.Object3D | null = root; while (current) { if (!current.visible) return false; current = current.parent; } return true; }
const flashInk = new THREE.MeshBasicMaterial({ color: '#D9F5FF' });
function apply(entry: Entry, base: PoseFrame, still = true) {
  const now = Date.now(), age = entry.reaction ? now - entry.reaction.started : -1;
  const hold = !still && (entry.reaction?.tool === 'whip' || entry.reaction?.tool === 'hammer') && age >= 680 && age < 750;
  if (hold && !entry.holding) Object.assign(entry.held, base);
  entry.holding = hold;
  const reaction = reactToToy(hold ? entry.held : base, still ? undefined : entry.reaction, now, entry.sample);
  const frame = reaction.frame;
  updateReactionMarks(entry.marks, entry.reaction, Date.now(), still);
  entry.root.position.x = reaction.x;
  for (const name of ['solid', 'outline']) {
    const mesh = entry.root.getObjectByName(name) as THREE.Mesh | undefined;
    if (!mesh) continue;
    if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[0] = reaction.ears;
    mesh.userData.restMaterial ??= mesh.material;
    mesh.material = reaction.flash && name === 'solid' ? flashInk : mesh.userData.restMaterial as THREE.Material;
  }
  entry.root.position.y = frame.y; entry.root.scale.set(frame.sx, frame.sy, frame.sz); entry.root.rotation.set(frame.rx, frame.ry, frame.rz);
  entry.open.visible = !frame.closed && !(entry.reaction?.tool === 'coffee' && !still && Date.now() - entry.reaction.started < 3000); entry.closed.visible = frame.closed; entry.effects.visible = frame.effect !== null;
  entry.effects.position.y = frame.effectY;
  for (const mark of entry.effects.children) {
    mark.visible = mark.name === frame.effect || (frame.effect === '✦' && mark.name === 'sparkle-2');
    if (mark.name === '✦' || mark.name === 'sparkle-2') {
      mark.userData.restPosition ??= mark.position.clone();
      const coffee = !still && entry.reaction?.tool === 'coffee' && Date.now() - entry.reaction.started < 3000;
      if (coffee) mark.position.set(mark.name === '✦' ? -0.15 : 0.15, 0.52, 0.46);
      else if (!still && entry.reaction?.tool === 'hammer' && now - entry.reaction.started < 3000) {
        const a = age / 260 + (mark.name === '✦' ? 0 : Math.PI);
        mark.position.set(Math.cos(a) * 0.55, 1.15, Math.sin(a) * 0.4);
      } else mark.position.copy(mark.userData.restPosition as THREE.Vector3);
      mark.scale.setScalar((coffee ? 0.16 : mark.name === '✦' ? 0.27 : 0.18) * frame.sparkle);
    }
  }
  entry.frame = base;
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
      apply(entry, progress < 1 ? blendPose(entry.from, target, progress * progress * (3 - 2 * progress)) : target, registry.still);
    }
    const active = !registry.still && [...registry.entries].some(entry => visible(entry.root));
    if (active && !release.current) release.current = motion.request('ambient');
    else if (!active && release.current) { release.current(); release.current = undefined; }
  }, -2);
}
function AnimatorOwner({ children, still }: { children?: ReactNode; still: boolean }) {
  useCharacterAnimator({ still }); return <AnimatorContext.Provider value={true}>{children}</AnimatorContext.Provider>;
}
/** Wrapping Lineup in a scene animator reuses the scene's one subscriber. */
export function CharacterAnimator({ children, still = false }: { children?: ReactNode; still?: boolean }) {
  const inherited = useContext(AnimatorContext);
  return inherited ? <>{children}</> : <AnimatorOwner still={still}>{children}</AnimatorOwner>;
}
export function useAnimatedCharacter(root: THREE.Group, pose: Pose, phase: number, speed = 1, reaction: Reaction = undefined) {
  const scene = useThree(state => state.scene); const registry = useMemo(() => registryFor(scene), [scene]);
  const entry = useMemo<Entry>(() => {
    const frame = samplePose(pose, 0, phase, true);
    return { root, pose, phase, speed, reaction, frame, from: frame, sample: { frame: { ...frame }, x: 0, ears: 0, flash: false }, held: { ...frame }, holding: false, changedAt: -Infinity,
      open: root.getObjectByName('eyes-open')!, closed: root.getObjectByName('eyes-closed')!, effects: root.getObjectByName('effects')!, marks: root.getObjectByName('reaction-marks')! };
    // Pose/phase are updated below, without replacing the entry or losing its blend state.
  }, [root]);
  useLayoutEffect(() => { registry.entries.add(entry); apply(entry, samplePose(entry.pose, registry.now, entry.phase, registry.still)); registry.notify();
    return () => { registry.entries.delete(entry); registry.notify(); };
  }, [entry, registry]);
  useEffect(() => {
    if (entry.pose !== pose) { entry.from = { ...entry.frame }; entry.changedAt = registry.now; entry.pose = pose; }
    entry.phase = phase; entry.speed = speed; entry.reaction = reaction; registry.notify();
  }, [entry, pose, phase, speed, reaction, registry]);
}
