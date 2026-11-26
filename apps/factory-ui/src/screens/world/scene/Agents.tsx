import { WorkerAwareness } from './walk/awareness';
import { oiiaSpot } from '../layout/zones';
import { tone } from './toys/sound';
import { useToys } from './toys/useToys';
import { ToyWorker } from './toys/visuals';
import { NeedsBell, CatClap } from './toys/WorldFun';
import { createScreenTexture, type ScreenTexture } from './screenTexture';
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { CharacterRig, hopAlong, phaseForSeat, specForRole, type HopMotion } from '../characters';
import type { WorldAgent } from '../data/types';
import { deskForAgent } from '../agentPresentation';
import { agentStation, deskDestination, type Position } from '../layout/campus';
import type { Station } from '../layout/roleOffice';
import { pathsConflict, type studioNavigation } from '../layout/studioNavigation';
import { ownerDesk, type Point } from '../layout/zones';
import { useWorldMotion } from './Ticker';
import type { AgentDebug, SceneDebug } from '../debugHook';
import type { WorldQuality } from './quality';
import type { WorldEvent } from '../data/events';
import { DeskFeedback } from './props/DeskFeedback';
import { Aura, auraFor, type EffectsLevel } from './effects/Aura';

export type AgentPositions = MutableRefObject<Map<string, Point>>;
export type AgentHover = { seatId: string; x: number; y: number } | null;
type Placement = { pose: WorldAgent['pose']; position: Position; trip: HopMotion | null; started: number; path?: Position[] };
const ignore = () => {};
const nameTagHeight = 1.9; // Clears the above-right pose bubbles while remaining centred on the rig.
function NameTag({ name, project, color }: { name: string; project: string; color: string }) {
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
      ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(22, 68, 468, 44, 13); ctx.fill();
      ctx.fillStyle = '#4A3B2F'; ctx.font = '600 36px "Inter Variable", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(name, 256, 38, 480);
      ctx.font = '500 28px "Inter Variable", sans-serif'; ctx.fillText(project, 256, 90, 440);
    });
    draw(); void document.fonts.load('600 36px "Inter Variable"').then(() => { if (active) draw(); }).catch(() => {});
    return () => { active = false; screen.cancel(); };
  }, [name, project, color, screen]);
  return screen ? <sprite position={[0, nameTagHeight, 0]} scale={[2, 0.375, 1]} raycast={ignore}><spriteMaterial ref={material => { if (material) screen.attach(material); }} map={screen.texture} transparent depthWrite={false} /></sprite> : null;
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
export function Agents({ events, agents, stations, route, highlight, baseline, quality, still, hidden, selected, positions, debug, onSelect, onHover, attention, effects = 'full' }: {
  effects?: EffectsLevel;
  events: readonly WorldEvent[]; agents: readonly WorldAgent[]; baseline: boolean; quality: WorldQuality; still: boolean; hidden: boolean; selected: string | null;
  stations: readonly Station[]; route: ReturnType<typeof studioNavigation>; highlight: string | null;
  positions: AgentPositions; debug: MutableRefObject<SceneDebug>; onSelect: (id: string) => void; onOwner: () => void; onHover: (hover: AgentHover) => void; attention: number;
}) {
  const toyState = useToys();
  const drawnAgents = useMemo(() => agents.filter(a => !a.overflow && deskForAgent(a)), [agents]);
  const [placements, setPlacements] = useState(new Map<string, Placement>());
  const current = useRef(placements);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tags, setTags] = useState(new Set<string>());
  const groups = useRef(new Map<string, THREE.Group>()); const transitions = useRef(debug.current.director.transitions);
  const [catAudience, setCatAudience] = useState(new Set<string>());
  const idleIds = useMemo(() => new Set(agents.filter(agent => agent.status === 'idle').map(agent => agent.seatId)), [agents]);
  const previousRoute = useRef(route);
  const poseEvents = useRef(new Set(events.map(event => event.id)));
  const motion = useWorldMotion(); const invalidate = useThree(state => state.invalidate);
  useEffect(() => {
    const update = () => {
      const now = performance.now(), serverNow = Date.now(); const next = new Map<string, Placement>();
      const sameFloor = previousRoute.current === route;
      previousRoute.current = route;
      const occupied = new Map<string, string>();
      const moving: Position[][] = [];
      const animate = baseline && !still && !hidden && sameFloor;
      const key = (position: Position) => `${position[0]},${position[2]}`;
      if (sameFloor) for (const [id, old] of current.current) {
        occupied.set(key(old.position), id);
        if (animate && old.trip && old.path) {
          occupied.set(key(old.path[0]!), id);
          moving.push(old.path);
        }
      }
      drawnAgents.forEach(agent => {
        const old = sameFloor ? current.current.get(agent.seatId) : undefined;
        if (animate && old?.trip) { next.set(agent.seatId, { ...old, pose: agent.pose }); return; }
        const spots = stations.find(item => item.id === agentStation(agent, serverNow))?.spots ?? [];
        const spot = (old && spots.find(([x, z]) => x === old.position[0] && z === old.position[2])) ?? spots.find(([x, z]) => !occupied.has(`${x},${z}`));
        let position: Position = old && spot ? [spot[0], .04, spot[1]] : deskDestination(agent);
        let trip: HopMotion | null = null;
        let path: Position[] | undefined;
        if (animate && old && key(position) !== key(old.position)) {
          const candidate = route(old.position, position);
          if (candidate.length && !moving.some(active => pathsConflict(candidate, active))) {
            path = candidate; moving.push(path); trip = hopAlong(path, 3.2);
          }
          else position = old.position;
        }
        occupied.set(key(position), agent.seatId);
        next.set(agent.seatId, { pose: agent.pose, position, trip, started: now, ...(path ? { path } : {}) });
        if (!trip || !positions.current.has(agent.seatId)) positions.current.set(agent.seatId, [position[0], position[2]]);
      });
      const changed = next.size !== current.current.size || [...next].some(([id, value]) => {
        const old = current.current.get(id);
        return !old || old.pose !== value.pose || old.trip !== value.trip || value.position.some((part, index) => part !== old.position[index]);
      });
      current.current = next;
      if (changed) { setPlacements(next); invalidate(); }
    };
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [drawnAgents, baseline, still, hidden, positions, invalidate, route, stations]);
  useEffect(() => { if (!hidden && !still && [...placements.values()].some(p => p.trip)) return motion.request('live'); }, [placements, hidden, still, motion]);
  useEffect(() => { if (hidden) { setHovered(null); onHover(null); } }, [hidden, onHover]);
  useEffect(() => { const ids = new Set(agents.filter(a => !a.overflow).map(a => a.seatId)); for (const id of positions.current.keys()) if (!ids.has(id)) positions.current.delete(id); }, [agents, positions]);
  useEffect(() => {
    for (const event of events) {
      if (event.type !== 'poseChanged' || poseEvents.current.has(event.id)) continue;
      poseEvents.current.add(event.id); transitions.current++;
    }
  }, [events]);
  useEffect(() => {
    const spin = toyState.catSpin;
    if (still || hidden || effects === 'off' || !spin.audience || Date.now() - spin.started > 3000) { setCatAudience(new Set()); return; }
    const audience = new Set(agents.filter(a => {
      const p = current.current.get(a.seatId);
      return a.status === 'idle' && !a.paused && p && !p.trip && Math.hypot(p.position[0] - oiiaSpot[0], p.position[2] - oiiaSpot[1]) < 7;
    }).slice(0, 2).map(a => a.seatId));
    setCatAudience(audience);
    if (audience.size && toyState.sound) tone('clap');
    const stop = audience.size ? motion.request('live') : undefined;
    const timer = setTimeout(() => setCatAudience(new Set()), 3500);
    return () => { clearTimeout(timer); stop?.(); };
  }, [toyState.catSpin, still, hidden, effects, agents, motion]);
  const debugRows = useMemo<AgentDebug[]>(() => agents.map(agent => ({ seatId: agent.seatId, ownerSeatId: agent.ownerSeatId, slot: agent.slot, name: agent.name, status: agent.status, pose: agent.pose, podKey: agent.podKey, deskId: deskForAgent(agent)?.id ?? null, wandering: false, activity: null, aura: effects === 'off' ? null : auraFor(agent), walking: false })), [agents, effects]);
  const ranked = useMemo(() => {
    const priority = (agent: WorldAgent) => agent.seatId === selected ? 5 : agent.seatId === hovered ? 4 : highlight === agent.projectId ? 3 : agent.needsYou.length ? 2 : agent.status === 'working' ? 1 : 0;
    return [...drawnAgents].sort((left, right) => priority(right) - priority(left) || left.seatId.localeCompare(right.seatId));
  }, [drawnAgents, selected, hovered, highlight]);
  const scratch = useMemo(() => ({ projected: new THREE.Vector3(), sample: { position: [0, 0, 0] as Position, yaw: 0, squash: 1, done: false }, rectangles: Array.from({ length: 8 }, () => ({ id: '', x: 0, y: 0, w: 0, h: 0 })) }), []);
  useFrame(({ camera, size }) => {
    let finished = false;
    const now = performance.now();
    for (const [id, placement] of current.current) {
      const group = groups.current.get(id); if (!group) continue;
      const trip = placement.trip;
      if (trip && !still && !hidden) {
        const sample = trip.sample((now - placement.started) / 1000, scratch.sample);
        group.position.set(...sample.position); group.rotation.y = sample.done ? 0 : sample.yaw - Math.PI / 4; group.scale.y = sample.squash;
        const point = positions.current.get(id) as [number, number] | undefined;
        if (point) { point[0] = group.position.x; point[1] = group.position.z; }
        if (sample.done) { placement.trip = null; finished = true; }
      } else {
        group.position.set(...placement.position); group.rotation.set(0, 0, 0); group.scale.y = 1;
        if (catAudience.has(id) && idleIds.has(id) && !still && !hidden) {
          group.rotation.y = Math.atan2(oiiaSpot[0] - group.position.x, oiiaSpot[1] - group.position.z) - Math.PI / 4;
          group.scale.x = 1 + Math.abs(Math.sin(Date.now() / 100)) * 0.06;
          group.scale.y = 1 - Math.abs(Math.sin(Date.now() / 100)) * 0.05;
        } else group.scale.x = 1;
      }
    }
    if (finished) setPlacements(new Map(current.current));
    for (const row of debugRows) row.walking = !hidden && !still && !!current.current.get(row.seatId)?.trip;
    debug.current.agents = debugRows; debug.current.director.transitions = transitions.current;
    const { rectangles, projected } = scratch;
    let count = 0;
    for (const agent of ranked) {
      if (hidden || count >= rectangles.length) break;
      if (camera.zoom < 40 && agent.seatId !== hovered && agent.seatId !== selected && agent.projectId !== highlight && !agent.needsYou.length) continue;
      const group = groups.current.get(agent.seatId); if (!group) continue;
      projected.copy(group.position); projected.y += nameTagHeight * group.scale.y; projected.project(camera);
      const x = (projected.x + 1) * size.width / 2, y = (1 - projected.y) * size.height / 2;
      const w = 2 * camera.zoom + 8, h = 0.375 * camera.zoom * Math.abs(group.scale.y) + 6;
      if (hidden || projected.z < -1 || projected.z > 1 || x - w / 2 < 0 || x + w / 2 > size.width || y - h / 2 < 0 || y + h / 2 > size.height) continue;
      let overlaps = false;
      for (let index = 0; index < count; index++) {
        const rect = rectangles[index]!;
        if (Math.abs(x - rect.x) < (w + rect.w) / 2 && Math.abs(y - rect.y) < (h + rect.h) / 2) { overlaps = true; break; }
      }
      if (overlaps) continue;
      const rect = rectangles[count++]!;
      rect.x = x; rect.y = y; rect.w = w; rect.h = h; rect.id = agent.seatId;
    }
    let changed = count !== tags.size;
    for (let index = 0; index < count && !changed; index++) changed = !tags.has(rectangles[index]!.id);
    if (changed) setTags(new Set(rectangles.slice(0, count).map(rect => rect.id)));

  }, -1);
  return <group visible={!hidden}>
    <DeskFeedback agents={drawnAgents.filter(agent => !agent.compact)} still={still || hidden} />
    {agents.filter(a => !a.overflow && deskForAgent(a)).map(agent => {
      const placement = placements.get(agent.seatId); if (!placement) return null;
      const toy = toyState.active.find(e => e.worker === agent.seatId);
      const toyMotion = !still && !hidden && effects !== 'off' && !toy?.quiet;
      return <group key={agent.seatId}>
        <group ref={node => { if (node) groups.current.set(agent.seatId, node); else groups.current.delete(agent.seatId); }} position={placement.position}>
          <WorkerAwareness agent={agent} still={still || hidden} toyAnimated={toyMotion}>
          <ToyWorker effect={toy} still={!toyMotion} low={quality === 'low' || effects === 'lite'}>
          <CharacterRig reaction={toyMotion ? toy : undefined} spec={specForRole(agent.role)} pose={catAudience.has(agent.seatId) && agent.status === 'idle' ? 'success' : placement.pose} position={[0, 0, 0]} phase={phaseForSeat(agent.seatId)} quality={quality} visible={!hidden} speed={toyMotion && toy?.tool === 'megaphone' ? 2 : 1} />
          </ToyWorker>
          </WorkerAwareness>
          {catAudience.has(agent.seatId) && agent.status === 'idle' && !still && !hidden && effects !== 'off' && <CatClap />}
          {!hidden && <Aura agent={{ ...agent, pose: placement.pose }} boost={toyMotion && (toy?.tool === 'coffee' || toy?.tool === 'whip' && agent.status === 'working') ? 1 : 0} level={effects} quality={quality} still={still || hidden} floorOffset={-placement.position[1]} />}
          {tags.has(agent.seatId) && <NameTag name={agent.name} project={agent.teamName ?? ''} color={agent.projectColor} />}
          {!hidden && <HitTarget walkId={agent.seatId} position={[0, 0.55, 0]} onSelect={() => onSelect(agent.seatId)} onHover={event => { setHovered(event ? agent.seatId : null); onHover(event ? { seatId: agent.seatId, x: event.clientX, y: event.clientY } : null); }} />}
        </group>
      </group>;
    })}
    {!hidden && <NeedsBell attention={attention} still={still} off={effects === 'off'} />}
    {/* Office objects provide individual targets; the old desk-sized capsule obscured the inbox. */}
    <mesh position={[ownerDesk.position[0] + 0.86, 1.1, ownerDesk.position[1] - 0.26]} raycast={ignore}><sphereGeometry args={[0.09, 10, 6]} /><meshStandardMaterial color={attention > 0 ? '#F2B8A9' : '#4A3B2F'} emissive="#F2B8A9" emissiveIntensity={attention > 0 ? 1.5 : 0} /></mesh>
  </group>;
}
