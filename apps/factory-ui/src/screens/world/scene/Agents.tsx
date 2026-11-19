import { WorkerAwareness } from './walk/awareness';
import { oiiaSpot } from '../layout/zones';
import { tone } from './toys/sound';
import { useToys } from './toys/useToys';
import { ToyWorker } from './toys/visuals';
import { NeedsBell, CatClap } from './toys/WorldFun';
import { createScreenTexture, type ScreenTexture } from './screenTexture';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { CharacterRig, characterStats, hopAlong, phaseForSeat, specForSeat, type HopMotion } from '../characters';
import type { Handoff, WorldAgent } from '../data/types';
import { deskForAgent } from '../agentPresentation';
import { activitySpots, ownerDesk, type Point } from '../layout/zones';
import { navigationAnchors, pathBetween } from '../layout/waypoints';
import { useWorldMotion } from './Ticker';
import type { AgentDebug, SceneDebug } from '../debugHook';
import type { WorldQuality } from './quality';
import type { WorldEvent } from '../data/events';
import type { Courier } from './Studio';
import { WanderingDirector, type Activity } from './wandering';
import { catCanBePetted } from './props/state';
import { DeskFeedback } from './props/DeskFeedback';
import { LeisureItem } from './props/LeisureItem';
import { Aura, auraFor, type EffectsLevel } from './effects/Aura';

export type AgentPositions = MutableRefObject<Map<string, Point>>;
export type AgentHover = { seatId: string; x: number; y: number } | null;
type Placement = { pose: WorldAgent['pose']; anchor: string; position: [number, number, number]; trip: HopMotion | null; started: number; pending: string; since: number; activity: Activity | null };
const ignore = () => {};
const nameTagHeight = 1.9; // Clears the above-right pose bubbles while remaining centred on the rig.
function NameTag({ name, register }: { name: string; register: (sprite: THREE.Sprite | null) => void }) {
  const [screen, setScreen] = useState<ScreenTexture | null>(null);
  const invalidate = useThree(state => state.invalidate);
  useEffect(() => {
    const value = createScreenTexture(512, 128, invalidate); setScreen(value);
    return () => value.dispose();
  }, [invalidate]);
  useEffect(() => {
    if (!screen) return;
    let active = true;
    const draw = () => screen.draw(ctx => {
      if (!active) return;
      ctx.fillStyle = '#FFF8E7'; ctx.beginPath(); ctx.roundRect(2, 2, 508, 124, 20); ctx.fill();
      ctx.fillStyle = '#4A3B2F'; ctx.font = '600 36px "Inter Variable", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(name, 256, 64, 480);
    });
    draw(); void document.fonts.load('600 36px "Inter Variable"').then(() => { if (active) draw(); }).catch(() => {});
    return () => { active = false; screen.cancel(); };
  }, [name, screen]);
  return screen ? <sprite ref={register} position={[0, nameTagHeight, 0]} scale={[2, 0.375, 1]} raycast={ignore}><spriteMaterial ref={material => { if (material) screen.attach(material); }} map={screen.texture} transparent depthWrite={false} /></sprite> : null;
}

function HitTarget({ position, owner = false, onSelect, onHover, walkId }: { position: [number, number, number]; owner?: boolean; walkId?: string; onSelect: () => void; onHover?: (event: ThreeEvent<PointerEvent> | null) => void }) {
  const down = useRef<[number, number] | null>(null);
  return <mesh userData={{ walkTarget: owner ? { kind: 'owner', id: 'owner' } : { kind: 'agent', id: walkId } }} position={position} onPointerDown={event => { down.current = [event.clientX, event.clientY]; }} onPointerUp={event => {
    const start = down.current; down.current = null;
    if (start && Math.hypot(event.clientX - start[0], event.clientY - start[1]) <= 4 && event.delta <= 4) { event.stopPropagation(); onSelect(); }
  }} onPointerOver={event => { event.stopPropagation(); onHover?.(event); }} onPointerMove={event => { if (down.current && Math.hypot(event.clientX - down.current[0], event.clientY - down.current[1]) > 4) down.current = null; event.stopPropagation(); onHover?.(event); }} onPointerOut={() => { down.current = null; onHover?.(null); }}>
    <capsuleGeometry args={[owner ? 0.8 : 0.55, owner ? 0.3 : 0.7, 4, 8]} />
    <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
  </mesh>;
}
export function Agents({ events, courier, celebration, agents, baseline, quality, still, hidden, selected, positions, debug, onSelect, onOwner, onHover, attention, effects = 'full' }: {
  effects?: EffectsLevel;
  events: readonly WorldEvent[]; courier: Courier; celebration: number; agents: readonly WorldAgent[]; baseline: boolean; quality: WorldQuality; still: boolean; hidden: boolean; selected: string | null;
  positions: AgentPositions; debug: MutableRefObject<SceneDebug>; onSelect: (id: string) => void; onOwner: () => void; onHover: (hover: AgentHover) => void; attention: number;
}) {
  const toyState = useToys();
  const drawnAgents = useMemo(() => agents.filter(a => !a.overflow && deskForAgent(a)), [agents]);
  const [placements, setPlacements] = useState(new Map<string, Placement>());
  const current = useRef(placements); current.current = placements;
  const [hovered, setHovered] = useState<string | null>(null);
  const [tags, setTags] = useState(new Set<string>()); const tagsKey = useRef('');
  const tagSprites = useRef(new Map<string, THREE.Sprite>());
  const groups = useRef(new Map<string, THREE.Group>()); const transitions = useRef(debug.current.director.transitions);
  const couriers = useRef(new Map<string, { trip: HopMotion; started: number }>());
  const [courierCount, setCourierCount] = useState(0);
  const [celebrants, setCelebrants] = useState(new Set<string>());
  const [catAudience, setCatAudience] = useState(new Set<string>());
  const wandering = useRef(new WanderingDirector());
  const poseEvents = useRef(new Set(events.map(event => event.id)));
  const motion = useWorldMotion(); const invalidate = useThree(state => state.invalidate);
  useEffect(() => {
    const update = () => {
      const allowed = new Set(agents.filter(a => !a.overflow && deskForAgent(a)).map(a => a.seatId));
      for (const id of couriers.current.keys()) if (!allowed.has(id)) couriers.current.delete(id);
      setCourierCount(couriers.current.size);
      const now = performance.now(); const next = new Map<string, Placement>();
      const drawn = agents.filter(agent => !agent.overflow && deskForAgent(agent));
      const spots = Object.entries(navigationAnchors).filter(([id]) => (id in activitySpots && (id !== 'cat' || catCanBePetted())) || id === 'coffee' || id === 'rest-1').map(([id, point]) => ({ id, point }));
      const actions = new Map(wandering.current.update(drawn.map(agent => ({ seatId: agent.seatId, idle: agent.status === 'idle' && !agent.paused, desk: deskForAgent(agent)!.seat, home: deskForAgent(agent)!.id })), spots, now, baseline && !still && !hidden, Math.max(0, (quality === 'low' ? 1 : 3) - couriers.current.size),
        new Set([...couriers.current.keys(), ...[...current.current].filter(([, p]) => !!p.trip).map(([id]) => id)])).map(action => [action.seatId, action]));
      drawn.forEach(agent => {
        const desk = deskForAgent(agent)!;
        const old = current.current.get(agent.seatId);
        const action = actions.get(agent.seatId);
        const pending = `${agent.status}:${agent.pose}`;
        const since = old?.pending === pending ? old.since : now;
        const apply = !old || !baseline || agent.status !== 'idle' || now - since >= 1500;
        const activity = agent.status === 'idle' && !agent.paused ? wandering.current.activity(agent.seatId) : null;
        const pose = activity ? activity === 'sofa' ? 'resting' : 'idle' : apply ? agent.pose : old.pose;
        const anchor = action?.kind === 'depart' ? action.spot!.id : action || !wandering.current.wandering(agent.seatId) ? desk.id : old?.anchor ?? desk.id;
        const point = anchor === desk.id ? desk.seat : navigationAnchors[anchor]!;
        const seated = activity === 'sofa' && !old?.trip && action?.kind !== 'depart';
        const position: [number, number, number] = seated ? [-14.5, 0.8, 12.1] : [point[0], anchor === desk.id ? 0.57 : 0.04, point[1]];
        let trip = baseline && !still && !hidden ? old?.trip ?? null : null; let started = old?.started ?? now;
        // Real work interrupts leisure immediately, including a trip still on its outbound leg.
        if (agent.status !== 'idle' && couriers.current.has(agent.seatId)) {
          const actual = groups.current.get(agent.seatId)?.position;
          couriers.current.delete(agent.seatId);
          trip = baseline && !still && !hidden && actual ? hopAlong([[actual.x, actual.y, actual.z], position], 3.2) : null; started = now;
        }
        if (action && old) {
          couriers.current.delete(agent.seatId);
          if (action.kind === 'reset' || !baseline || still || hidden) trip = null;
          else {
            const actual = groups.current.get(agent.seatId)?.position;
            const from: [number, number, number] = actual ? [actual.x, actual.y, actual.z] : old.position;
            const route = action.urgent ? [] : pathBetween(old.anchor, anchor).map(([x, z]) => [x, 0.04, z] as [number, number, number]);
            trip = hopAlong([from, ...route, position], 3.2); started = now;
          }
        }
        next.set(agent.seatId, { pose, anchor, position, trip, started, pending, since, activity });
        if ((!trip && !couriers.current.has(agent.seatId)) || still || hidden) positions.current.set(agent.seatId, [position[0], position[2]]);
      });
      const changed = next.size !== current.current.size || [...next].some(([id, value]) => {
        const old = current.current.get(id);
        return !old || old.pose !== value.pose || old.anchor !== value.anchor || old.trip !== value.trip || old.pending !== value.pending || old.activity !== value.activity || old.position[1] !== value.position[1];
      });
      current.current = next;
      if (changed) { setPlacements(next); invalidate(); }
    };
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [agents, baseline, still, hidden, quality, positions, invalidate]);
  useEffect(() => { if (!hidden && !still && [...placements.values()].some(p => p.trip)) return motion.request('live'); }, [placements, hidden, still, motion]);
  useEffect(() => { if (!hidden && !still && [...placements.values()].some(p => p.activity)) return motion.request('ambient'); }, [placements, hidden, still, motion]);
  useEffect(() => { if (hidden) { setHovered(null); onHover(null); } }, [hidden, onHover]);
  useEffect(() => { const ids = new Set(agents.filter(a => !a.overflow).map(a => a.seatId)); for (const id of positions.current.keys()) if (!ids.has(id)) positions.current.delete(id); }, [agents, positions]);
  useLayoutEffect(() => {
    const launch = (handoff: Handoff) => {
      if (still || hidden || handoff.from.kind !== 'seat' || couriers.current.size >= 1 || couriers.current.size + wandering.current.reservedSpots().size >= (quality === 'low' ? 1 : 3)) return;
      const id = handoff.from.seatId;
      const agent = agents.find(a => a.seatId === id);
      const placement = current.current.get(id);
      if (!agent || agent.paused || agent.status !== 'idle' || !placement || placement.trip || wandering.current.wandering(id) || couriers.current.has(id)) return;
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
  }, [courier, agents, still, hidden, quality, invalidate]);
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
    if (!celebration || still || hidden || effects === 'off' || performance.now() - celebration >= 2500) { setCelebrants(new Set()); return; }
    setCelebrants(new Set(agents.filter(a => a.status === 'idle' && !a.paused && !a.overflow && !couriers.current.has(a.seatId) && !wandering.current.wandering(a.seatId)).map(a => a.seatId)));
    const release = motion.request('live');
    const timer = setTimeout(() => { setCelebrants(new Set()); release(); }, Math.max(0, celebration + 2500 - performance.now()));
    return () => { clearTimeout(timer); release(); };
  }, [celebration, still, hidden, effects, motion]);
  useEffect(() => {
    const spin = toyState.catSpin;
    if (still || hidden || effects === 'off' || !spin.audience || Date.now() - spin.started > 3000) { setCatAudience(new Set()); return; }
    const audience = new Set(agents.filter(a => {
      const p = current.current.get(a.seatId);
      return a.status === 'idle' && !a.paused && !a.overflow && p && !p.trip && !couriers.current.has(a.seatId) && !wandering.current.wandering(a.seatId) && Math.hypot(p.position[0] - oiiaSpot[0], p.position[2] - oiiaSpot[1]) < 7;
    }).slice(0, 2).map(a => a.seatId));
    setCatAudience(audience);
    if (audience.size && toyState.sound) tone('clap');
    const stop = audience.size ? motion.request('live') : undefined;
    const timer = setTimeout(() => setCatAudience(new Set()), 3500);
    return () => { clearTimeout(timer); stop?.(); };
  }, [toyState.catSpin, still, hidden, effects, agents, motion]);
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
        if (sample.done) { placement.trip = null; if (!courierTrip) wandering.current.arrive(id, performance.now()); couriers.current.delete(id); finished = true; }
      } else {
        group.position.set(...placement.position); group.rotation.set(0, 0, 0); group.scale.y = 1;
        const activityTime = performance.now() / 1000;
        if (!still && !hidden && agents.some(a => a.seatId === id && a.status === 'idle')) {
          if (placement.activity === 'dance') { group.rotation.y = Math.sin(activityTime * 5) * 0.45; group.position.y += Math.abs(Math.sin(activityTime * 7)) * 0.16; }
          if (placement.activity === 'pet-cat') group.rotation.z = Math.sin(activityTime * 2) * 0.09;
          if (placement.activity === 'ping-pong') { group.rotation.y = placement.anchor === 'ping-left' ? Math.PI / 4 : -Math.PI * 0.75; group.rotation.z = Math.sin(activityTime * 4) * 0.09; }
          if (placement.activity === 'coffee') group.rotation.y = -Math.PI * 0.75;
          if (placement.activity === 'pet-cat' || placement.activity === 'water-plant') group.rotation.y = -Math.PI / 4;
          if (placement.activity === 'water-plant') group.rotation.z = Math.sin(activityTime * 1.3) * 0.06;
        } else group.rotation.z = 0;
        if (catAudience.has(id) && agents.some(a => a.seatId === id && a.status === 'idle') && !still && !hidden) {
          group.rotation.y = Math.atan2(oiiaSpot[0] - group.position.x, oiiaSpot[1] - group.position.z) - Math.PI / 4;
          group.scale.x = 1 + Math.abs(Math.sin(Date.now() / 100)) * 0.06;
          group.scale.y = 1 - Math.abs(Math.sin(Date.now() / 100)) * 0.05;
        } else group.scale.x = 1;
        const elapsed = (performance.now() - celebration) / 1000;
        if (!still && !hidden && celebrants.has(id) && elapsed >= 0 && elapsed < 2.5 && agents.some(a => a.seatId === id && a.status === 'idle')) {
          group.position.y += Math.sin(Math.min(1, elapsed / 0.65) * Math.PI) * 0.18;
        }
      }
    }
    if (finished) { setPlacements(new Map(current.current)); setCourierCount(couriers.current.size); }
    const rows: AgentDebug[] = agents.map(agent => ({ seatId: agent.seatId, ownerSeatId: agent.ownerSeatId, slot: agent.slot, name: agent.name, status: agent.status, pose: current.current.get(agent.seatId)?.pose ?? agent.pose, podKey: agent.podKey, deskId: deskForAgent(agent)?.id ?? null, wandering: wandering.current.wandering(agent.seatId), activity: agent.status === 'idle' && !still && !hidden ? wandering.current.activity(agent.seatId) : null, aura: effects === 'off' ? null : auraFor({ ...agent, pose: current.current.get(agent.seatId)?.pose ?? agent.pose }), walking: !hidden && !still && (!!current.current.get(agent.seatId)?.trip || couriers.current.has(agent.seatId)) }));
    debug.current = { ...debug.current, agents: rows, characters: characterStats(), director: { transitions: transitions.current } };
    const rectangles: { x: number; y: number; w: number; h: number }[] = [];
    const accepted = new Set<string>();
    const priority = (a: WorldAgent) => a.seatId === selected ? 4 : a.needsYou.length ? 3 : a.status === 'working' ? 2 : 1;
    for (const agent of [...agents].filter(a => !a.overflow && (camera.zoom >= 40 || a.seatId === hovered || a.seatId === selected || a.needsYou.length)).sort((a, b) => priority(b) - priority(a) || a.seatId.localeCompare(b.seatId))) {
      if (accepted.size >= 8) break;
      const group = groups.current.get(agent.seatId); if (!group) continue;
      const projected = group.position.clone().add(new THREE.Vector3(0, nameTagHeight * group.scale.y, 0)).project(camera);
      const x = (projected.x + 1) * size.width / 2, y = (1 - projected.y) * size.height / 2;
      const w = 2 * camera.zoom + 8, h = 0.375 * camera.zoom * Math.abs(group.scale.y) + 6;
      if (hidden || projected.z < -1 || projected.z > 1 || x - w / 2 < 0 || x + w / 2 > size.width || y - h / 2 < 0 || y + h / 2 > size.height) continue;
      if (rectangles.some(r => Math.abs(x - r.x) < (w + r.w) / 2 && Math.abs(y - r.y) < (h + r.h) / 2)) continue;
      rectangles.push({ x, y, w, h }); accepted.add(agent.seatId);
    }
    tagSprites.current.forEach((sprite, id) => { sprite.visible = accepted.has(id); });
    const key = [...accepted].join('|'); if (key !== tagsKey.current) { tagsKey.current = key; setTags(accepted); }

  }, -1);
  return <group visible={!hidden}>
    <DeskFeedback agents={drawnAgents} still={still || hidden} />
    {agents.filter(a => !a.overflow && deskForAgent(a)).map(agent => {
      const placement = placements.get(agent.seatId); if (!placement) return null;
      const toy = toyState.active.find(e => e.worker === agent.seatId);
      const toyMotion = !still && !hidden && effects !== 'off' && !toy?.quiet;
      return <group key={agent.seatId}>
        <group ref={node => { if (node) groups.current.set(agent.seatId, node); else groups.current.delete(agent.seatId); }} position={placement.position}>
          <WorkerAwareness agent={agent} still={still || hidden} toyAnimated={toyMotion}>
          <ToyWorker effect={toy} still={!toyMotion} low={quality === 'low' || effects === 'lite'}>
          <CharacterRig reaction={toyMotion ? toy : undefined} spec={specForSeat(agent.seatName, agent.isLead)} pose={(celebrants.has(agent.seatId) || catAudience.has(agent.seatId)) && agent.status === 'idle' ? 'success' : placement.pose} position={[0, 0, 0]} phase={phaseForSeat(agent.seatId)} quality={quality} visible={!hidden} speed={toyMotion && toy?.tool === 'megaphone' ? 2 : 1} />
          </ToyWorker>
          </WorkerAwareness>
          {catAudience.has(agent.seatId) && agent.status === 'idle' && !still && !hidden && effects !== 'off' && <CatClap />}
          {!hidden && <Aura agent={{ ...agent, pose: placement.pose }} boost={toyMotion && (toy?.tool === 'coffee' || toy?.tool === 'whip' && agent.status === 'working') ? 1 : 0} level={effects} quality={quality} still={still || hidden} floorOffset={-placement.position[1]} />}
          {!hidden && !placement.trip && agent.status === 'idle' && <LeisureItem activity={placement.activity} />}
          {tags.has(agent.seatId) && <NameTag name={agent.name} register={sprite => { if (sprite) tagSprites.current.set(agent.seatId, sprite); else tagSprites.current.delete(agent.seatId); }} />}
          {!hidden && <HitTarget walkId={agent.seatId} position={[0, 0.55, 0]} onSelect={() => onSelect(agent.seatId)} onHover={event => { setHovered(event ? agent.seatId : null); onHover(event ? { seatId: agent.seatId, x: event.clientX, y: event.clientY } : null); }} />}
        </group>
      </group>;
    })}
    {!hidden && <NeedsBell attention={attention} still={still} off={effects === 'off'} />}
    {!hidden && <HitTarget owner position={[ownerDesk.position[0], 1, ownerDesk.position[1]]} onSelect={onOwner} />}
    <mesh position={[ownerDesk.position[0] + 0.86, 1.1, ownerDesk.position[1] - 0.26]} raycast={ignore}><sphereGeometry args={[0.09, 10, 6]} /><meshStandardMaterial color={attention > 0 ? '#F2B8A9' : '#4A3B2F'} emissive="#F2B8A9" emissiveIntensity={attention > 0 ? 1.5 : 0} /></mesh>
  </group>;
}
