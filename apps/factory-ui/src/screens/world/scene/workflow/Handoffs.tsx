import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';

import type { WorldEvent } from '../../data/events';
import type { Endpoint, Handoff } from '../../data/types';
import { meetingTable, anchors } from '../../layout/zones';
import { useWorldMotion } from '../Ticker';
import { createWorkflowAtlas, createWorkflowToon } from './TaskBoard';
import { workflowDebug, handoffColors } from './support';

export type HandoffPoint = readonly [number, number] | readonly [number, number, number];
export type TableArrival = { handoff: Handoff; passedAt: number };
export type HandoffsProps = {
  effects?: import('../effects/Aura').EffectsLevel;
  /** Only diffWorld events. The batch present at mount is acknowledged as baseline. */
  events: readonly WorldEvent[];
  positionOf: (endpoint: Endpoint) => HandoffPoint | null;
  quality?: 'high' | 'low';
  still?: boolean;
  /** Courier is called only when senderIdle explicitly confirms idle/done. */
  courier?: (handoff: Handoff) => void;
  senderIdle?: (seatId: string) => boolean;
  onTask?: (projectId: string, taskId: string) => void;
  onTablePass?: (arrival: TableArrival) => void;
};
type Flight = { handoff: Handoff; from: THREE.Vector3; to: THREE.Vector3; viaTable: boolean; start: number; passed: boolean };
type Badge = { point: THREE.Vector3; start: number; sprite: THREE.Sprite };
function point3(point: HandoffPoint) {
  return point.length === 3 ? new THREE.Vector3(point[0], point[1], point[2]) : new THREE.Vector3(point[0], 1.1, point[1]);
}
function endpointPosition(endpoint: Endpoint, positionOf: HandoffsProps['positionOf']) {
  const position = positionOf(endpoint);
  if (position) { const vector = point3(position); return [vector.x, vector.y, vector.z].every(Number.isFinite) ? vector : null; }
  return endpoint.kind === 'knowledge' ? new THREE.Vector3(anchors.bookshelf[0], 1.45, anchors.bookshelf[1] + 0.35) : null;
}
const tablePoint = new THREE.Vector3(meetingTable.position[0], 1.06, meetingTable.position[1]);
function arc(from: THREE.Vector3, to: THREE.Vector3, progress: number, result: THREE.Vector3) {
  const t = THREE.MathUtils.clamp(progress, 0, 1);
  if (t === 0) { result.copy(from); return; }
  if (t === 1) { result.copy(to); return; }
  result.copy(from).lerp(to, t); result.y += Math.sin(t * Math.PI) * 1.15;
}
/** Sampled by elapsed milliseconds; table dwell is exactly 400ms. */
export function sampleHandoffFlight(from: THREE.Vector3, to: THREE.Vector3, viaTable: boolean, elapsed: number, result: THREE.Vector3) {
  if (!viaTable) { arc(from, to, elapsed / 1100, result); return elapsed >= 1100; }
  if (elapsed < 700) arc(from, tablePoint, elapsed / 700, result);
  else if (elapsed < 1100) result.copy(tablePoint);
  else arc(tablePoint, to, (elapsed - 1100) / 700, result);
  return elapsed >= 1800;
}

type Resources = { group: THREE.Group; cards: THREE.InstancedMesh; marks: THREE.InstancedMesh; badge: (failed: boolean) => THREE.Sprite; dispose: () => void };
function createResources(invalidate: () => void): Resources {
  const group = new THREE.Group(); group.name = 'handoffs';
  // Four folded triangles share a central crease; one instanced draw for all planes.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0,0,0.4, -0.34,0,-0.2, 0,-0.09,-0.12,
    0,0,0.4, 0,-0.09,-0.12, 0.34,0,-0.2,
    0,0,0.4, 0,-0.09,-0.12, -0.07,-0.13,-0.24,
    0,0,0.4, 0.07,-0.13,-0.24, 0,-0.09,-0.12,
  ], 3)); geometry.computeVertexNormals();
  const toon = createWorkflowToon(); const cards = new THREE.InstancedMesh(geometry, toon.material, 3); cards.count = 0; cards.frustumCulled = false; group.add(cards);
  const atlas = createWorkflowAtlas([{ key: 'envelope', text: '✉' }, { key: 'done', text: '✓', color: '#B5D3A7' }, { key: 'failed', text: '!', color: '#D66B65' }], invalidate);
  const mark = atlas.mesh('envelope', 1, 1); const marks = new THREE.InstancedMesh(mark.geometry, mark.material, 3); marks.count = 0; marks.frustumCulled = false; group.add(marks);
  const spriteMaterials = new Map<boolean, THREE.SpriteMaterial>();
  return { group, cards, marks, badge(failed) {
    const face = atlas.mesh(failed ? 'failed' : 'done', 1, 1);
    // Sprite geometry uses the atlas UVs while its shader billboards toward the camera.
    let material = spriteMaterials.get(failed);
    if (!material) { material = new THREE.SpriteMaterial({ map: (face.material as THREE.MeshBasicMaterial).map, transparent: true, depthWrite: false, toneMapped: false }); atlas.attach(material); spriteMaterials.set(failed, material); } const sprite = new THREE.Sprite(material); sprite.geometry = face.geometry; group.add(sprite); return sprite;
  }, dispose() { spriteMaterials.forEach(material => material.dispose()); atlas.dispose(); geometry.dispose(); cards.dispose(); marks.dispose(); toon.dispose(); } };
}

export function Handoffs({ effects = 'full', events, positionOf, quality = 'high', still: frozen = false, courier, senderIdle, onTablePass, onTask }: HandoffsProps) {
  const still = frozen || effects === 'off';
  const invalidate = useThree(state => state.invalidate), motion = useWorldMotion();
  const [resources, setResources] = useState<Resources | null>(null); const current = useRef<Resources | null>(null);
  const seen = useRef(new Map(events.map(event => [event.id, Date.parse(event.at)])));
  const totalSeen = useRef(events.filter(event => event.type === 'handoff').length);
  const active = useRef<Flight[]>([]), queue = useRef<Flight[]>([]), badges = useRef<Badge[]>([]);
  const release = useRef<(() => void) | null>(null), debugKey = useRef({});
  const callbacks = useRef({ positionOf, courier, senderIdle, onTablePass }); callbacks.current = { positionOf, courier, senderIdle, onTablePass };
  const scratch = useRef({ point: new THREE.Vector3(), dummy: new THREE.Object3D() });
  const syncStats = () => workflowDebug.flights.set(debugKey.current, { active: active.current.length, seen: totalSeen.current });
  const clear = () => {
    active.current = []; queue.current = [];
    badges.current.forEach(badge => current.current?.group.remove(badge.sprite)); badges.current = [];
    if (current.current) { current.current.cards.count = 0; current.current.marks.count = 0; }
    release.current?.(); release.current = null;
  };
  const promote = (now: number) => {
    while (active.current.length < 3 && queue.current.length) {
      const next = queue.current.shift()!;
      if (Date.now() - Date.parse(next.handoff.at) > 90000) continue;
      next.start = now; active.current.push(next);
      if (next.viaTable && next.handoff.from.kind === 'seat' && callbacks.current.senderIdle?.(next.handoff.from.seatId)) callbacks.current.courier?.(next.handoff);
    }
  };
  const sample = (now: number) => {
    const resource = current.current; if (!resource) return;
    const { dummy, point } = scratch.current;
    active.current = active.current.filter(flight => {
      const elapsed = now - flight.start;
      if (flight.viaTable && elapsed >= 700 && !flight.passed) { flight.passed = true; callbacks.current.onTablePass?.({ handoff: flight.handoff, passedAt: Date.now() }); }
      return elapsed < (flight.viaTable ? 1800 : 1100);
    });
    promote(now);
    active.current.forEach((flight, index) => {
      sampleHandoffFlight(flight.from, flight.to, flight.viaTable, now - flight.start, point);
      dummy.position.copy(point); dummy.rotation.set(-0.15, Math.atan2(flight.to.x - flight.from.x, flight.to.z - flight.from.z), quality === 'low' ? 0 : Math.sin((now - flight.start) / 180) * 0.12); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); resource.cards.setMatrixAt(index, dummy.matrix);
      resource.cards.setColorAt(index, new THREE.Color(handoffColors[flight.handoff.kind] ?? '#AFCFE6'));
      dummy.translateZ(0.02); dummy.scale.set(0.29, 0.18, 1); dummy.updateMatrix(); resource.marks.setMatrixAt(index, dummy.matrix);
    });
    resource.cards.count = active.current.length; resource.marks.count = 0;
    resource.cards.instanceMatrix.needsUpdate = resource.marks.instanceMatrix.needsUpdate = true;
    if (resource.cards.instanceColor) resource.cards.instanceColor.needsUpdate = true;
    badges.current = badges.current.filter(badge => {
      const age = now - badge.start;
      if (age >= 2000) { resource.group.remove(badge.sprite); return false; }
      const scale = Math.min(1, age / 180) * Math.min(1, (2000 - age) / 200);
      badge.sprite.position.copy(badge.point); badge.sprite.position.y += 1.0 + Math.sin(Math.min(1, age / 250) * Math.PI) * 0.15;
      badge.sprite.scale.set(0.6 * scale, 0.3 * scale, 1); return true;
    });
    syncStats();
    if (!active.current.length && !badges.current.length) { release.current?.(); release.current = null; }
  };
  useEffect(() => {
    const created = createResources(invalidate); current.current = created; setResources(created); syncStats(); invalidate();
    return () => { clear(); current.current = null; created.dispose(); workflowDebug.flights.delete(debugKey.current); };
  }, [quality, invalidate]);
  useEffect(() => {
    const wallNow = Date.now(), now = performance.now();
    if (still) clear();
    for (const event of events) {
      if (seen.current.has(event.id)) continue;
      seen.current.set(event.id, Date.parse(event.at));
      if (event.type !== 'handoff') continue;
      const handoff = event.handoff, age = wallNow - Date.parse(handoff.at), eventAge = wallNow - Date.parse(event.at);
      if (!Number.isFinite(age) || !Number.isFinite(eventAge) || age < 0 || age > 90000 || eventAge < 0 || eventAge > 90000 || still) continue;
      totalSeen.current++;
      if (handoff.kind === 'finished' || handoff.kind === 'failed') {
        const seat = handoff.from.kind === 'seat' ? handoff.from : handoff.to.kind === 'seat' ? handoff.to : null;
        const point = seat ? endpointPosition(seat, callbacks.current.positionOf) : null;
        if (point && current.current) {
          // Cap transient badges, independently of the three flight slots.
          if (badges.current.length >= 12) { const old = badges.current.shift()!; current.current.group.remove(old.sprite); }
          const failed = handoff.kind === 'failed'; badges.current.push({ point, start: now, sprite: Object.assign(current.current.badge(failed), { userData: { handoff } }) });
        }
        continue;
      }
      const from = endpointPosition(handoff.from, callbacks.current.positionOf), to = endpointPosition(handoff.to, callbacks.current.positionOf);
      if (!from || !to) continue;
      const flight: Flight = { handoff, from, to, viaTable: handoff.from.kind === 'seat' && handoff.to.kind === 'seat', start: now, passed: false };
      if (active.current.length < 3) { queue.current.push(flight); promote(now); }
      else if (queue.current.length < 10) queue.current.push(flight);
    }
    // IDs older than the eligibility window can be forgotten without replaying flights.
    for (const [id, at] of seen.current) if (!Number.isFinite(at) || wallNow - at > 90000) seen.current.delete(id);
    if (!still && (active.current.length || badges.current.length) && !release.current) release.current = motion.request('live');
    sample(now); invalidate();
  }, [events, still, quality, motion, invalidate]);
  useFrame(() => { if (!still && release.current) sample(performance.now()); });
  return resources ? <primitive object={resources.group} dispose={null} onClick={(event: ThreeEvent<MouseEvent>) => {
    if (event.delta > 4) return;
    const handoff = event.object.userData.handoff as Handoff | undefined ?? (typeof event.instanceId === 'number' ? active.current[event.instanceId]?.handoff : undefined);
    if (handoff?.taskId) { event.stopPropagation(); onTask?.(handoff.projectId, handoff.taskId); }
  }} /> : null;
}
