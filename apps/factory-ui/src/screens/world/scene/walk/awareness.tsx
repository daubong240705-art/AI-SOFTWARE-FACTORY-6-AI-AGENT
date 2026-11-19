import { createContext, useContext, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useT } from '@/i18n';
import type { WorldAgent } from '../../data/types';
import type { WalkState } from './state';
import { ownerDesk } from '../../layout/zones';
import { toys } from '../toys/store';
import { Bubble } from '../toys/visuals';

export type WalkPresence = { active: boolean; state: RefObject<WalkState>; bumps: Map<string, number> };
export const WalkPresenceContext = createContext<WalkPresence | null>(null);
export const useWalkPresence = () => useContext(WalkPresenceContext);
export function greeting(distance: number, working: boolean, waiting: boolean, sulking: boolean) {
  return { notices: distance < 3, waves: !sulking && !working && (waiting || distance < 3), both: waiting && !sulking, nods: distance < 3 && working && !sulking };
}
const ignore = () => {};
/** A separate pivot preserves the director's route, the rig's pose and toy animation. */
export function WorkerAwareness({ agent, still, toyAnimated, children }: { agent: WorldAgent; still: boolean; toyAnimated: boolean; children: ReactNode }) {
  const presence = useWalkPresence(), t = useT();
  const pivot = useRef<THREE.Group>(null), arms = useRef<THREE.Group>(null);
  const point = useRef(new THREE.Vector3()), seenBump = useRef(0);
  const [bump, setBump] = useState(0);
  useFrame((_, delta) => {
    const node = pivot.current; if (!node) return;
    const active = !!presence?.active;
    node.getWorldPosition(point.current);
    const walk = presence?.state.current;
    const wantsOffice = agent.needsYou.length > 0;
    const dx = (wantsOffice ? ownerDesk.position[0] : walk?.position[0] ?? 1000) - point.current.x, dz = (wantsOffice ? ownerDesk.position[1] : walk?.position[2] ?? 1000) - point.current.z;
    const sulking = toys.snapshot().sulking.some(s => s.worker === agent.seatId && s.until > Date.now());
    const response = greeting(active ? Math.hypot(dx, dz) : Infinity, agent.status === 'working', agent.status === 'waiting', sulking);
    const now = performance.now() / 1000;
    const parentYaw = node.parent?.rotation.y ?? 0;
    let yaw = response.notices || wantsOffice ? Math.atan2(dx, dz) - Math.PI / 4 - parentYaw + (sulking ? Math.PI : 0) : 0;
    yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    // The existing toy pose already turns the rig during a sulk; compensate once here.
    const effect = toys.snapshot().active.find(e => e.worker === agent.seatId);
    if (response.notices && sulking && !still && toyAnimated && effect && !effect.quiet) yaw -= Math.PI * THREE.MathUtils.clamp(((Date.now() - effect.started) / 1000 - 1.1) / 0.6, 0, 1);
    // Working workers acknowledge without turning their hands away from the keyboard.
    if (agent.status === 'working' && !sulking) yaw = THREE.MathUtils.clamp(yaw, -0.4, 0.4);
    node.rotation.y += Math.atan2(Math.sin(yaw - node.rotation.y), Math.cos(yaw - node.rotation.y)) * (still ? 1 : 1 - Math.exp(-7 * Math.min(delta, 0.05)));
    const at = presence?.bumps.get(agent.seatId) ?? 0;
    if (at !== seenBump.current) { seenBump.current = at; setBump(at); }
    const age = (Date.now() - at) / 1000;
    if (bump && age >= 1.2) setBump(0);
    node.rotation.z = !still && active && at && age < 0.7 ? Math.sin(age * 30) * 0.17 * (1 - age / 0.7) : 0;
    node.rotation.x = !still && active && response.nods ? Math.max(0, Math.sin(now * 3)) * 0.1 : 0;
    if (arms.current) {
      arms.current.visible = active && !sulking && (response.waves || agent.status === 'working');
      arms.current.rotation.y = Math.PI / 4;
      arms.current.children.forEach((arm, i) => {
        const side = i ? 1 : -1;
        const waving = response.waves && (i === 1 || response.both);
        arm.rotation.z = waving ? side * (2.3 + (still ? 0 : Math.sin(now * 7 + i) * 0.35)) : side * 0.15;
        arm.rotation.x = agent.status === 'working' ? -1.25 + (still ? 0 : Math.sin(now * 18 + i * Math.PI) * 0.1) : 0;
      });
    }
  }, -0.5);
  return <group ref={pivot}>
    {children}
    <group ref={arms} visible={false}>{[-1, 1].map(side => <group key={side} position={[side * 0.4, 0.59, 0]}>
      <mesh position={[0, -0.12, 0]} raycast={ignore}><capsuleGeometry args={[0.075, 0.2, 3, 6]} /><meshToonMaterial color="#FFF0CD" /></mesh>
    </group>)}</group>
    {bump > 0 && Date.now() - bump < 1200 && <Bubble text={t(bump % 2 ? 'worldUi.walk.bump' : 'worldUi.walk.boss')} position={[0, 1.65, 0]} width={1.3} />}
  </group>;
}
