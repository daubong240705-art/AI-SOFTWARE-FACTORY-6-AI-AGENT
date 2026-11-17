import type { WorldLocations } from '../CameraRig';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Bug } from '../../data/types';
import type { WorldEvent } from '../../data/events';
import { pen, palette } from '../../layout/zones';
import { useWorldMotion } from '../Ticker';
import { LabCanvasLabel, labScreenOrigin, makeLabGradient, type LabGame } from './TestingLab';
import { worldCopy, type LabLocale } from '../../copy';

export type BugMonstersProps = {
  locations?: WorldLocations;
  bugs: readonly Bug[];
  bugOverflow?: number;
  events?: readonly WorldEvent[];
  games?: readonly LabGame[];
  /** Change with the data scope to establish a new baseline. */
  scopeKey?: string;
  still?: boolean;
  quality?: 'high' | 'low';
  locale?: LabLocale;
  onSelectBug?: (bug: Bug) => void;
  onHoverBug?: (bug: Bug | null) => void;
};

type Stats = { bugs: number; retesting: number; defeated: number };
const mountedStats = new Map<symbol, Stats>();
/** Read-only snapshot; counts all supplied bugs (including overflow), not just drawn ones. */
export function labStats(): Stats {
  return [...mountedStats.values()].reduce((sum, item) => ({
    bugs: sum.bugs + item.bugs, retesting: sum.retesting + item.retesting, defeated: sum.defeated + item.defeated,
  }), { bugs: 0, retesting: 0, defeated: 0 });
}

export function bugHash(id: string) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return hash >>> 0;
}
const colors = [palette.rose, palette.sky, palette.sage, palette.butter, palette.lavender, palette.mint];

/** Each slot is a separate cell: its bounded wander disk never touches a neighbour. */
export function bugSlotPosition(slot: number, id: string, elapsed: number, still = false) {
  const [x0, x1, z0, z1] = pen.rect;
  const column = slot % 6, row = Math.floor(slot / 6);
  const phase = bugHash(id) / 4294967296 * Math.PI * 2;
  const time = still ? 0 : elapsed;
  return {
    x: x0 + 0.4 + (column + 0.5) * (x1 - x0 - 0.8) / 6 + Math.sin(time * 0.32 + phase) * 0.11,
    z: z0 + 0.4 + (row + 0.5) * (z1 - z0 - 0.8) / 2 + Math.cos(time * 0.27 + phase) * 0.06,
    y: 0.3,
    yaw: 0.65 + Math.sin(time * 0.24 + phase) * 0.3,
  };
}

type Point = { x: number; z: number };
type Flight = { started: number };
type Puff = Point & { started: number };
const flightSeconds = 1.35, puffSeconds = 0.8;

/** Event state is explicit so rerenders, queue acknowledgement and still changes cannot replay it. */
export class LabEventTracker {
  baseline = false;
  seen = new Set<string>();
  defeated = 0;
  flights = new Map<string, Flight>();
  puffs: Puff[] = [];
  positions = new Map<string, Point>();

  observe(events: readonly WorldEvent[], bugs: readonly Bug[], now: number, still: boolean) {
    if (!this.baseline) {
      events.forEach(event => this.seen.add(event.id));
      this.baseline = true;
      return;
    }
    const current = new Set(bugs.map(bug => bug.id));
    for (const event of events) {
      if (this.seen.has(event.id)) continue;
      this.seen.add(event.id);
      if (event.type === 'bugSpawned' && current.has(event.bug.id) && !still) {
        this.flights.set(event.bug.id, { started: now });
      } else if (event.type === 'bugDefeated') {
        this.defeated++;
        const position = this.positions.get(event.bug.id);
        if (position && !still) this.puffs.push({ ...position, started: now });
        this.flights.delete(event.bug.id);
      }
    }
    // Retain IDs only from the current queue: acknowledged queues are never re-delivered.
    // Also keep a recent tail to survive short queue replacement races.
    if (this.seen.size > 2048) this.seen = new Set([...events.map(event => event.id), ...[...this.seen].slice(-1024)]);
    for (const id of this.flights.keys()) if (!current.has(id)) this.flights.delete(id);
    if (still) { this.flights.clear(); this.puffs = []; }
    this.puffs = this.puffs.slice(-12);
  }

  expire(now: number) {
    for (const [id, flight] of this.flights) if (now - flight.started >= flightSeconds) this.flights.delete(id);
    this.puffs = this.puffs.filter(puff => now - puff.started < puffSeconds);
  }
}

function merged(parts: THREE.BufferGeometry[]) {
  const result = mergeGeometries(parts)!;
  parts.forEach(part => part.dispose());
  return result;
}
function sphere(x: number, y: number, z: number, sx: number, sy: number, sz: number, segments: number) {
  return new THREE.SphereGeometry(1, segments, 5).scale(sx, sy, sz).translate(x, y, z);
}
function box(x: number, y: number, z: number, sx: number, sy: number, sz: number, rz = 0) {
  return new THREE.BoxGeometry(sx, sy, sz).rotateZ(rz).translate(x, y, z);
}
function paint(geometry: THREE.BufferGeometry, color: string) {
  const rgb = new THREE.Color(color);
  const values = new Float32Array(geometry.getAttribute('position').count * 3);
  for (let i = 0; i < values.length; i += 3) { values[i] = rgb.r; values[i + 1] = rgb.g; values[i + 2] = rgb.b; }
  geometry.setAttribute('color', new THREE.BufferAttribute(values, 3));
  return geometry;
}

export function makeBugBatch(quality: 'high' | 'low') {
  const segments = quality === 'low' ? 6 : 10;
  const bodyParts = [paint(sphere(0, 0, 0, 0.25, 0.22, 0.23, segments), 'white')];
  for (const side of [-1, 1]) {
    bodyParts.push(paint(box(side * 0.13, 0.25, 0, 0.025, 0.23, 0.025, -side * 0.35), palette.ink));
    bodyParts.push(paint(sphere(side * 0.17, 0.37, 0, 0.045, 0.045, 0.045, 6), palette.cream));
    for (const z of [-0.12, 0, 0.12]) bodyParts.push(paint(box(side * 0.24, -0.16, z, 0.16, 0.035, 0.035, side * 0.45), palette.ink));
  }
  const body = merged(bodyParts);
  const faceFor = (nervous: boolean) => {
    const parts: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      parts.push(paint(sphere(side * 0.09, 0.045, 0.205, 0.06, 0.07, 0.028, 6), palette.cream));
      parts.push(paint(sphere(side * 0.09, 0.04, 0.231, 0.025, 0.035, 0.014, 6), palette.ink));
      parts.push(paint(box(side * 0.09, 0.135, 0.215, 0.11, 0.024, 0.02, side * (nervous ? 0.4 : -0.4)), palette.ink));
    }
    parts.push(paint(box(0, -0.065, 0.229, nervous ? 0.025 : 0.075, 0.02, 0.012), palette.ink));
    if (nervous) parts.push(paint(sphere(0.19, 0.12, 0.18, 0.025, 0.06, 0.025, 6), palette.sky));
    return merged(parts);
  };
  const face = faceFor(false), nervousFace = faceFor(true);
  const gradient = makeLabGradient();
  const toon = new THREE.MeshToonMaterial({ color: 'white', vertexColors: true, gradientMap: gradient });
  const nervous = new THREE.MeshToonMaterial({ color: 'white', vertexColors: true, gradientMap: gradient, transparent: true, opacity: 0.56, depthWrite: false });
  const group = new THREE.Group();
  const cohorts = [false, true].map(retesting => {
    const bodies = new THREE.InstancedMesh(body, retesting ? nervous : toon, 12);
    const faces = new THREE.InstancedMesh(retesting ? nervousFace : face, toon, 12);
    bodies.frustumCulled = faces.frustumCulled = false;
    bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage); faces.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    faces.raycast = () => {};
    bodies.count = faces.count = 0; group.add(bodies, faces);
    return { retesting, bodies, faces, bugs: [] as Bug[] };
  });
  const smokeGeometry = new THREE.IcosahedronGeometry(1, 0);
  const smokeMaterial = new THREE.MeshBasicMaterial({ color: palette.cream, transparent: true, opacity: 0.65, depthWrite: false });
  const sparkleGeometry = new THREE.OctahedronGeometry(1, 0);
  const sparkleMaterial = new THREE.MeshBasicMaterial({ color: palette.butter, toneMapped: false });
  const smoke = new THREE.InstancedMesh(smokeGeometry, smokeMaterial, 48);
  const sparkles = new THREE.InstancedMesh(sparkleGeometry, sparkleMaterial, 24);
  smoke.raycast = sparkles.raycast = () => {};
  smoke.frustumCulled = sparkles.frustumCulled = false;
  smoke.count = sparkles.count = 0; group.add(smoke, sparkles);
  const dummy = new THREE.Object3D(), tint = new THREE.Color();
  return {
    group, cohorts, smoke, sparkles, dummy, tint,
    dispose() {
      for (const cohort of cohorts) { cohort.bodies.dispose(); cohort.faces.dispose(); }
      smoke.dispose(); sparkles.dispose();
      for (const geometry of [body, face, nervousFace, smokeGeometry, sparkleGeometry]) geometry.dispose();
      for (const material of [toon, nervous, smokeMaterial, sparkleMaterial]) material.dispose();
      gradient.dispose();
    },
  };
}
type Batch = ReturnType<typeof makeBugBatch>;

function renderBatch(batch: Batch, bugs: readonly Bug[], slots: Map<string, number>, tracker: LabEventTracker, now: number, still: boolean, low: boolean) {
  tracker.expire(now);
  tracker.positions.clear();
  const { dummy, tint } = batch;
  for (const cohort of batch.cohorts) {
    cohort.bugs = bugs.filter(bug => (bug.state === 'retesting') === cohort.retesting);
    cohort.bodies.count = cohort.faces.count = cohort.bugs.length;
    cohort.bugs.forEach((bug, index) => {
      const slot = slots.get(bug.id) ?? 0;
      const position = bugSlotPosition(slot, bug.id, now, still);
      const flight = tracker.flights.get(bug.id);
      const progress = flight && !still ? Math.min(1, Math.max(0, (now - flight.started) / flightSeconds)) : 1;
      // The screen origin and final pen slot are world coordinates, matching Environment.
      dummy.position.set(
        labScreenOrigin[0] + (position.x - labScreenOrigin[0]) * progress,
        position.y + (1 - progress) * (labScreenOrigin[1] - position.y) + Math.sin(progress * Math.PI) * 0.8,
        labScreenOrigin[2] + (position.z - labScreenOrigin[2]) * progress,
      );
      if (cohort.retesting && !still) dummy.position.x += Math.sin(now * 9 + bugHash(bug.id)) * 0.012;
      dummy.rotation.set(0, position.yaw, 0);
      dummy.scale.setScalar(progress < 1 ? 0.25 + Math.min(1, progress * 5) * 0.75 : 1);
      dummy.updateMatrix();
      cohort.bodies.setMatrixAt(index, dummy.matrix); cohort.faces.setMatrixAt(index, dummy.matrix);
      cohort.bodies.setColorAt(index, tint.set(colors[bugHash(bug.projectId) % colors.length]!));
      tracker.positions.set(bug.id, { x: dummy.position.x, z: dummy.position.z });
    });
    cohort.bodies.instanceMatrix.needsUpdate = cohort.faces.instanceMatrix.needsUpdate = true;
    if (cohort.bodies.instanceColor) cohort.bodies.instanceColor.needsUpdate = true;
    // InstancedMesh raycasting uses its cached sphere even with frustum culling
    // disabled. Refit it after movement so selection follows flights and wandering.
    cohort.bodies.computeBoundingSphere();
  }
  let smokeIndex = 0, sparkleIndex = 0;
  if (!still) for (const puff of tracker.puffs) {
    const progress = Math.max(0, Math.min(1, (now - puff.started) / puffSeconds));
    const pieces = low ? 2 : 4;
    for (let i = 0; i < pieces; i++) {
      const angle = i * Math.PI * 2 / pieces;
      dummy.position.set(puff.x + Math.cos(angle) * progress * 0.4, 0.3 + progress * 0.4, puff.z + Math.sin(angle) * progress * 0.4);
      dummy.rotation.set(0, 0, 0); dummy.scale.setScalar((0.07 + progress * 0.15) * (1 - progress)); dummy.updateMatrix();
      batch.smoke.setMatrixAt(smokeIndex++, dummy.matrix);
    }
    for (let i = 0; i < 2; i++) {
      dummy.position.set(puff.x + (i ? -1 : 1) * progress * 0.3, 0.65 + progress * 0.5, puff.z);
      dummy.rotation.set(0, progress * Math.PI, Math.PI / 4); dummy.scale.set(0.06 * (1 - progress), 0.17 * (1 - progress), 0.06 * (1 - progress)); dummy.updateMatrix();
      batch.sparkles.setMatrixAt(sparkleIndex++, dummy.matrix);
    }
  }
  batch.smoke.count = smokeIndex; batch.sparkles.count = sparkleIndex;
  batch.smoke.instanceMatrix.needsUpdate = batch.sparkles.instanceMatrix.needsUpdate = true;
}

const noEvents: readonly WorldEvent[] = [], noGames: readonly LabGame[] = [];
export function BugMonsters({ bugs, bugOverflow = 0, events = noEvents, games = noGames, scopeKey = '', still = false, quality = 'high', locale = 'vi', onSelectBug, onHoverBug, locations }: BugMonstersProps) {
  const root = useRef<THREE.Group>(null);
  const batch = useRef<Batch | null>(null);
  const slots = useRef(new Map<string, number>());
  const tracker = useRef(new LabEventTracker());
  const scope = useRef(scopeKey);
  const statsToken = useRef(Symbol('lab-stats'));
  const liveRelease = useRef<(() => void) | null>(null);
  const motion = useWorldMotion();
  const clock = useThree(s => s.clock), invalidate = useThree(s => s.invalidate);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hoveredRef = useRef<Bug | null>(null);
  const hoverCallback = useRef(onHoverBug); hoverCallback.current = onHoverBug;
  const active = useMemo(() => [...new Map(bugs.map(bug => [bug.id, bug])).values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).slice(0, 12), [bugs]);

  const syncLive = () => {
    const needed = !still && (tracker.current.flights.size > 0 || tracker.current.puffs.length > 0);
    if (needed && !liveRelease.current) liveRelease.current = motion.request('live');
    if (!needed && liveRelease.current) { liveRelease.current(); liveRelease.current = null; }
  };
  useLayoutEffect(() => {
    const created = makeBugBatch(quality); batch.current = created;
    const parent = root.current!; parent.add(created.group);
    return () => { parent.remove(created.group); created.dispose(); batch.current = null; };
  }, [quality]);
  useLayoutEffect(() => {
    if (scope.current !== scopeKey) {
      tracker.current = new LabEventTracker(); slots.current.clear(); scope.current = scopeKey;
    }
    // Demand rendering can be idle before the first bug arrives. Sample the clock
    // here so that the first resumed frame cannot skip an entire spawn flight.
    const now = clock.getElapsedTime();
    tracker.current.observe(events, active, now, still);
    const ids = new Set(active.map(bug => bug.id));
    for (const id of slots.current.keys()) if (!ids.has(id)) slots.current.delete(id);
    const used = new Set(slots.current.values());
    for (const bug of active) if (!slots.current.has(bug.id)) {
      const slot = Array.from({ length: 12 }, (_, i) => i).find(i => !used.has(i))!;
      slots.current.set(bug.id, slot); used.add(slot);
    }
    for (const key of locations?.current.keys() ?? []) if (key.startsWith('bug:') && !ids.has(key.slice(4))) locations?.current.delete(key);
    mountedStats.set(statsToken.current, { bugs: bugs.length + Math.max(0, bugOverflow), retesting: bugs.filter(bug => bug.state === 'retesting').length, defeated: tracker.current.defeated });
    if (batch.current) renderBatch(batch.current, active, slots.current, tracker.current, now, still, quality === 'low');
    tracker.current.positions.forEach((point, id) => locations?.current.set(`bug:${id}`, [point.x, 0.55, point.z]));
    syncLive(); invalidate();
  }, [bugs, active, events, bugOverflow, scopeKey, still, quality, clock, invalidate, motion]);
  useEffect(() => { if (!still && active.length) return motion.request('ambient'); }, [still, active.length, motion]);
  useEffect(() => () => {
    mountedStats.delete(statsToken.current); liveRelease.current?.(); liveRelease.current = null;
    for (const id of tracker.current.positions.keys()) locations?.current.delete(`bug:${id}`);
    if (hoveredRef.current) hoverCallback.current?.(null);
  }, []);
  useEffect(() => {
    const next = active.find(bug => bug.id === hoveredId) ?? null;
    if (hoveredRef.current !== next) { hoveredRef.current = next; hoverCallback.current?.(next); }
    if (!next && hoveredId) setHoveredId(null);
  }, [active, hoveredId]);
  useFrame(state => {
    if (batch.current) renderBatch(batch.current, active, slots.current, tracker.current, state.clock.elapsedTime, still, quality === 'low');
    tracker.current.positions.forEach((point, id) => locations?.current.set(`bug:${id}`, [point.x, 0.55, point.z]));
    syncLive();
  });

  const pickedBug = (event: ThreeEvent<PointerEvent | MouseEvent>) => {
    const cohort = batch.current?.cohorts.find(item => item.bodies === event.object);
    return event.instanceId === undefined ? undefined : cohort?.bugs[event.instanceId];
  };
  const hovered = active.find(bug => bug.id === hoveredId);
  const copy = worldCopy[locale].lab;
  const hoverLines = useMemo(() => hovered ? [
    { text: games.find(game => game.projectId === hovered.projectId)?.name ?? hovered.projectId },
    { text: hovered.state === 'retesting' ? copy.retesting : copy.open, color: palette.apricot },
    { text: hovered.criterion.slice(0, 140) },
  ] : [], [hovered, games, copy]);
  const overflow = Math.max(0, bugOverflow) + Math.max(0, bugs.length - active.length);
  const overflowLines = useMemo(() => [{ text: `+${overflow} ${copy.bugsOverflow}`, size: 0.08 }], [overflow, copy]);
  return <group ref={root} dispose={null}
    onClick={event => { if (event.delta > 4) return; const bug = pickedBug(event); if (bug) { event.stopPropagation(); onSelectBug?.(bug); } }}
    onPointerOver={event => { const bug = pickedBug(event); if (bug) { event.stopPropagation(); setHoveredId(bug.id); } }}
    onPointerMove={event => { const bug = pickedBug(event); if (bug) { event.stopPropagation(); setHoveredId(bug.id); } }}
    onPointerOut={() => setHoveredId(null)}>
    {overflow > 0 && <LabCanvasLabel lines={overflowLines} position={[16.8, 0.9, pen.rect[3] + 0.09]} width={1.25} height={0.3} quality={quality} />}
    {hovered && <LabCanvasLabel lines={hoverLines} position={[13.7, 1.4, pen.rect[3] + 0.1]} width={3.5} height={0.72} quality={quality} />}
  </group>;
}
