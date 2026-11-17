import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { CharacterRig, characterStats, hopAlong, phaseForSeat, specForSeat, type HopMotion } from '../characters';
import type { Handoff, WorldAgent } from '../data/types';
import { anchorsForAgents, deskForAgent } from '../agentPresentation';
import { ownerDesk, type Point } from '../layout/zones';
import { pathBetween } from '../layout/waypoints';
import { useWorldMotion } from './Ticker';
import type { AgentDebug, SceneDebug } from '../debugHook';
import type { WorldQuality } from './quality';
import type { WorldEvent } from '../data/events';
import type { Courier } from './Studio';

export type AgentPositions = MutableRefObject<Map<string, Point>>;
export type AgentHover = { seatId: string; x: number; y: number } | null;
type Placement = { pose: WorldAgent['pose']; anchor: string; position: [number, number, number]; trip: HopMotion | null; started: number; pending: string; since: number };
const ignore = () => {};
const lampColor = { working: '#E0A458', waiting: '#F2B8A9', problem: '#F05252', done: '#82BF91', queued: '#4A3B2F', idle: '#4A3B2F' };
function NameTag({ name, register }: { name: string; register: (sprite: THREE.Sprite | null) => void }) {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  const invalidate = useThree(state => state.invalidate);
  useEffect(() => {
    let alive = true; let current: THREE.CanvasTexture | null = null;
    const draw = () => {
      if (!alive) return;
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#FFF8E7'; ctx.beginPath(); ctx.roundRect(2, 2, 508, 92, 20); ctx.fill();
      ctx.fillStyle = '#4A3B2F'; ctx.font = '600 36px "Inter Variable", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(name, 256, 48, 480);
      current?.dispose(); current = new THREE.CanvasTexture(canvas); current.colorSpace = THREE.SRGBColorSpace; setTexture(current); invalidate();
    };
    draw(); void document.fonts.load('600 36px "Inter Variable"').then(draw);
    return () => { alive = false; current?.dispose(); };
  }, [name, invalidate]);
  return texture ? <sprite ref={register} position={[0, 1.65, 0]} scale={[2, 0.375, 1]} raycast={ignore}><spriteMaterial map={texture} transparent depthWrite={false} /></sprite> : null;
}
function Feedback({ agent, still }: { agent: WorldAgent; still: boolean }) {
  const desk = deskForAgent(agent)!; const bar = useRef<THREE.Mesh>(null); const motion = useWorldMotion();
  const percent = agent.runs[0]?.progress?.percent ?? null;
  const working = agent.status === 'working'; const sweep = percent === null && working;
  useEffect(() => { if (sweep && !still) return motion.request('ambient'); }, [sweep, still, motion]);
  useFrame(() => { if (bar.current && sweep) bar.current.position.x = still ? 0 : Math.sin(performance.now() / 650) * 0.4; });
  const amount = percent === null ? 0.3 : Math.max(0, Math.min(100, percent)) / 100;
  return <group>
    {[desk.monitor, desk.sideMonitor].map((point, index) => <mesh key={index} position={[point[0] + Math.sin(index ? Math.PI / 2 : 0.6) * 0.053, index ? 1.07 : 1.08, point[1] + Math.cos(index ? Math.PI / 2 : 0.6) * 0.053]} rotation={[0, index ? Math.PI / 2 : 0.6, 0]} raycast={ignore}>
      <planeGeometry args={[index ? 0.56 : 0.7, index ? 0.28 : 0.32]} />
      <meshStandardMaterial color={working && (index === 0 || agent.runs.length >= 2) ? '#BDE3D2' : '#425555'} emissive="#BDE3D2" emissiveIntensity={working && (index === 0 || agent.runs.length >= 2) ? 1.1 : 0.02} />
    </mesh>)}
    <mesh position={[desk.position[0] + 0.65, 1.26, desk.position[1] + 0.18]} raycast={ignore}><sphereGeometry args={[0.13, 10, 6]} /><meshStandardMaterial color={lampColor[agent.status]} emissive={lampColor[agent.status]} emissiveIntensity={['working', 'waiting', 'problem', 'done'].includes(agent.status) ? 1 : 0} /></mesh>
    {(working || percent !== null) && <group position={[desk.position[0], 1.65, desk.position[1]]} rotation={[0, Math.PI / 4, 0]}>
      <mesh raycast={ignore}><planeGeometry args={[1.3, 0.1]} /><meshBasicMaterial color="#4A3B2F" /></mesh>
      <mesh ref={bar} position={[percent === null ? 0 : (amount - 1) * 0.62, 0, 0.006]} raycast={ignore}><planeGeometry args={[Math.max(0.001, amount * 1.24), 0.065]} /><meshBasicMaterial color="#BDE3D2" /></mesh>
    </group>}
  </group>;
}
function HitTarget({ position, owner = false, onSelect, onHover }: { position: [number, number, number]; owner?: boolean; onSelect: () => void; onHover?: (event: ThreeEvent<PointerEvent> | null) => void }) {
  const down = useRef<[number, number] | null>(null);
  return <mesh position={position} onPointerDown={event => { down.current = [event.clientX, event.clientY]; }} onPointerUp={event => {
    const start = down.current; down.current = null;
    if (start && Math.hypot(event.clientX - start[0], event.clientY - start[1]) <= 4 && event.delta <= 4) { event.stopPropagation(); onSelect(); }
  }} onPointerOver={event => { event.stopPropagation(); onHover?.(event); }} onPointerMove={event => { if (down.current && Math.hypot(event.clientX - down.current[0], event.clientY - down.current[1]) > 4) down.current = null; event.stopPropagation(); onHover?.(event); }} onPointerOut={() => { down.current = null; onHover?.(null); }}>
    <capsuleGeometry args={[owner ? 0.8 : 0.55, owner ? 0.3 : 0.7, 4, 8]} />
    <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
  </mesh>;
}
export function Agents({ events, courier, celebration, agents, baseline, quality, still, hidden, selected, positions, debug, onSelect, onOwner, onHover, attention }: {
  events: readonly WorldEvent[]; courier: Courier; celebration: number; agents: readonly WorldAgent[]; baseline: boolean; quality: WorldQuality; still: boolean; hidden: boolean; selected: string | null;
  positions: AgentPositions; debug: MutableRefObject<SceneDebug>; onSelect: (id: string) => void; onOwner: () => void; onHover: (hover: AgentHover) => void; attention: number;
}) {
  const [placements, setPlacements] = useState(new Map<string, Placement>());
  const current = useRef(placements); current.current = placements;
  const [hovered, setHovered] = useState<string | null>(null);
  const [tags, setTags] = useState(new Set<string>()); const tagsKey = useRef('');
  const tagSprites = useRef(new Map<string, THREE.Sprite>());
  const groups = useRef(new Map<string, THREE.Group>()); const transitions = useRef(debug.current.director.transitions);
  const couriers = useRef(new Map<string, { trip: HopMotion; started: number }>());
  const [courierCount, setCourierCount] = useState(0);
  const [celebrants, setCelebrants] = useState(new Set<string>());
  const poseEvents = useRef(new Set(events.map(event => event.id)));
  const motion = useWorldMotion(); const invalidate = useThree(state => state.invalidate);
  useEffect(() => {
    const update = () => {
      const allowed = new Set(agents.filter(a => !a.overflow && deskForAgent(a)).map(a => a.seatId));
      for (const id of couriers.current.keys()) if (!allowed.has(id)) couriers.current.delete(id);
      setCourierCount(couriers.current.size);
      const now = performance.now(); const next = new Map<string, Placement>(); let waiting = false;
      const anchors = anchorsForAgents(agents);
      agents.filter(agent => !agent.overflow && deskForAgent(agent)).forEach(agent => {
        const target = anchors.get(agent.seatId)!;
        const old = current.current.get(agent.seatId);
        const pending = `${agent.status}:${agent.pose}`;
        const since = old?.pending === pending ? old.since : now;
        const apply = !old || !baseline || now - since >= 1500;
        const pose = apply ? agent.pose : old.pose;
        // Idle and resting agents remain at their assigned desk. Lounge spots are reserved for a paused lifecycle.
        const anchor = target.id;
        const point = target.point;
        const position: [number, number, number] = [point[0], target.height, point[1]];
        let trip = baseline && !still ? old?.trip ?? null : null; let started = old?.started ?? now;
        if (old && apply && (old.pose !== pose || old.anchor !== anchor)) {
          if (baseline && old.anchor !== anchor && !still) {
            const route = pathBetween(old.anchor, anchor);
            if (route.length) { const actual = groups.current.get(agent.seatId)?.position; trip = hopAlong([actual ? [actual.x, actual.y, actual.z] : old.position, ...route, position], 3.2); started = now; }
          } else trip = null;
        }
        if (!apply) waiting = true;
        next.set(agent.seatId, { pose, anchor, position, trip, started, pending, since });
        if ((!trip && !couriers.current.has(agent.seatId)) || still) positions.current.set(agent.seatId, point);
      });
      current.current = next; setPlacements(next); invalidate();
      return waiting;
    };
    update();
    const timer = setInterval(() => { if (!update()) clearInterval(timer); }, 100);
    return () => clearInterval(timer);
  }, [agents, baseline, still, positions, invalidate]);
  useEffect(() => { if (!hidden && !still && [...placements.values()].some(p => p.trip)) return motion.request('live'); }, [placements, hidden, still, motion]);
  useEffect(() => { if (hidden) { setHovered(null); onHover(null); } }, [hidden, onHover]);
  useEffect(() => { const ids = new Set(agents.filter(a => !a.overflow).map(a => a.seatId)); for (const id of positions.current.keys()) if (!ids.has(id)) positions.current.delete(id); }, [agents, positions]);
  useLayoutEffect(() => {
    const launch = (handoff: Handoff) => {
      if (still || hidden || handoff.from.kind !== 'seat' || couriers.current.size >= 2) return;
      const id = handoff.from.seatId;
      const agent = agents.find(a => a.seatId === id);
      const placement = current.current.get(id);
      if (!agent || agent.paused || !['idle', 'done'].includes(agent.status) || !placement || placement.trip || couriers.current.has(id)) return;
      const route = pathBetween(placement.anchor, 'table-0');
      if (route.length < 2) return;
      const at = groups.current.get(id)?.position;
      const ground = route.map(([x, z]) => [x, 0.04, z] as [number, number, number]);
      const path = [at ? [at.x, at.y, at.z] as [number, number, number] : placement.position, ...ground, ...ground.slice(0, -1).reverse(), placement.position];
      couriers.current.set(id, { trip: hopAlong(path, 5), started: performance.now() });
      setCourierCount(couriers.current.size); invalidate();
    };
    courier.current = launch;
    return () => { if (courier.current === launch) courier.current = null; };
  }, [courier, agents, still, hidden, invalidate]);
  useEffect(() => {
    if (still || hidden) { couriers.current.clear(); setCourierCount(0); }
    else if (courierCount) return motion.request('live');
  }, [still, hidden, courierCount, motion]);
  useEffect(() => {
    for (const event of events) {
      if (event.type !== 'poseChanged' || poseEvents.current.has(event.id)) continue;
      poseEvents.current.add(event.id); transitions.current++;
    }
  }, [events]);
  useEffect(() => {
    if (!celebration || still || hidden || performance.now() - celebration >= 2500) { setCelebrants(new Set()); return; }
    setCelebrants(new Set(agents.filter(a => a.status === 'idle' && !a.paused && !a.overflow && !couriers.current.has(a.seatId)).map(a => a.seatId)));
    const release = motion.request('live');
    const timer = setTimeout(() => { setCelebrants(new Set()); release(); }, Math.max(0, celebration + 2500 - performance.now()));
    return () => { clearTimeout(timer); release(); };
  }, [celebration, still, hidden, motion]);
  useFrame(({ camera, size }) => {
    let finished = false;
    for (const [id, placement] of current.current) {
      const group = groups.current.get(id); if (!group) continue;
      const courierTrip = couriers.current.get(id);
      const trip = courierTrip?.trip ?? placement.trip;
      if (trip && !still && !hidden) {
        const sample = trip.sample((performance.now() - (courierTrip?.started ?? placement.started)) / 1000);
        group.position.set(...sample.position); group.rotation.y = sample.done ? 0 : sample.yaw - Math.PI / 4; group.scale.y = sample.squash;
        positions.current.set(id, [sample.position[0], sample.position[2]]);
        if (sample.done) { placement.trip = null; couriers.current.delete(id); finished = true; }
      } else {
        group.position.set(...placement.position); group.rotation.y = 0; group.scale.y = 1;
        const elapsed = (performance.now() - celebration) / 1000;
        if (!still && !hidden && celebrants.has(id) && elapsed >= 0 && elapsed < 2.5 && agents.some(a => a.seatId === id && a.status === 'idle')) {
          group.position.y += Math.sin(Math.min(1, elapsed / 0.65) * Math.PI) * 0.18;
        }
      }
    }
    if (finished) { setPlacements(new Map(current.current)); setCourierCount(couriers.current.size); }
    const rows: AgentDebug[] = agents.map(agent => ({ seatId: agent.seatId, name: agent.name, status: agent.status, pose: current.current.get(agent.seatId)?.pose ?? agent.pose, podKey: agent.podKey, deskId: deskForAgent(agent)?.id ?? null, walking: !hidden && !still && (!!current.current.get(agent.seatId)?.trip || couriers.current.has(agent.seatId)) }));
    debug.current = { ...debug.current, agents: rows, characters: characterStats(), director: { transitions: transitions.current } };
    const rectangles: { x: number; y: number; w: number; h: number }[] = [];
    const accepted = new Set<string>();
    const priority = (a: WorldAgent) => a.seatId === selected ? 4 : a.needsYou.length ? 3 : a.status === 'working' ? 2 : 1;
    for (const agent of [...agents].filter(a => !a.overflow && (camera.zoom >= 40 || a.seatId === hovered || a.seatId === selected || a.needsYou.length)).sort((a, b) => priority(b) - priority(a) || a.seatId.localeCompare(b.seatId))) {
      if (accepted.size >= 8) break;
      const group = groups.current.get(agent.seatId); if (!group) continue;
      const projected = group.position.clone().add(new THREE.Vector3(0, 1.65 * group.scale.y, 0)).project(camera);
      const x = (projected.x + 1) * size.width / 2, y = (1 - projected.y) * size.height / 2;
      const w = 2 * camera.zoom + 8, h = 0.375 * camera.zoom * Math.abs(group.scale.y) + 6;
      if (hidden || projected.z < -1 || projected.z > 1 || x - w / 2 < 0 || x + w / 2 > size.width || y - h / 2 < 0 || y + h / 2 > size.height) continue;
      if (rectangles.some(r => Math.abs(x - r.x) < (w + r.w) / 2 && Math.abs(y - r.y) < (h + r.h) / 2)) continue;
      rectangles.push({ x, y, w, h }); accepted.add(agent.seatId);
    }
    tagSprites.current.forEach((sprite, id) => { sprite.visible = accepted.has(id); });
    const key = [...accepted].join('|'); if (key !== tagsKey.current) { tagsKey.current = key; setTags(accepted); }

  });
  return <group visible={!hidden}>
    {agents.filter(a => !a.overflow && deskForAgent(a)).map(agent => {
      const placement = placements.get(agent.seatId); if (!placement) return null;
      return <group key={agent.seatId}>
        <Feedback agent={agent} still={still || hidden} />
        <group ref={node => { if (node) groups.current.set(agent.seatId, node); else groups.current.delete(agent.seatId); }} position={placement.position}>
          <CharacterRig spec={specForSeat(agent.name, agent.isLead)} pose={celebrants.has(agent.seatId) && agent.status === 'idle' ? 'success' : placement.pose} position={[0, 0, 0]} phase={phaseForSeat(agent.seatId)} quality={quality} visible={!hidden} />
          {tags.has(agent.seatId) && <NameTag name={agent.name} register={sprite => { if (sprite) tagSprites.current.set(agent.seatId, sprite); else tagSprites.current.delete(agent.seatId); }} />}
          {!hidden && <HitTarget position={[0, 0.55, 0]} onSelect={() => onSelect(agent.seatId)} onHover={event => { setHovered(event ? agent.seatId : null); onHover(event ? { seatId: agent.seatId, x: event.clientX, y: event.clientY } : null); }} />}
        </group>
      </group>;
    })}
    {!hidden && <HitTarget owner position={[ownerDesk.position[0], 1, ownerDesk.position[1]]} onSelect={onOwner} />}
    <mesh position={[ownerDesk.position[0] + 0.86, 1.1, ownerDesk.position[1] - 0.26]} raycast={ignore}><sphereGeometry args={[0.09, 10, 6]} /><meshStandardMaterial color={attention > 0 ? '#F2B8A9' : '#4A3B2F'} emissive="#F2B8A9" emissiveIntensity={attention > 0 ? 1.5 : 0} /></mesh>
  </group>;
}
