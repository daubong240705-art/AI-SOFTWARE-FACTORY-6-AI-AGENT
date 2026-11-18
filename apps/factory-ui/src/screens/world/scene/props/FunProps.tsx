import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { WorldInputs, WorldModel } from '../../data/types';
import type { SceneDebug } from '../../debugHook';
import { anchors, desks, funProps, plants, windows } from '../../layout/zones';
import { pathBetween } from '../../layout/waypoints';
import { deskForAgent } from '../../agentPresentation';
import { hopAlong, type HopMotion } from '../../characters/poses';
import { worldCopy, type WorldLocale } from '../../copy';
import { useWorldMotion } from '../Ticker';
import type { AgentPositions } from '../Agents';
import { colouredGeometry, type Piece } from './geometry';
import { achievements, daylight, propIds, setCatPettable } from './state';

const ignore = () => {};
type State = { model: WorldModel; reports: WorldInputs['reports']; debug: MutableRefObject<SceneDebug>; positions: AgentPositions; locale: WorldLocale };
export function makeFunProps(low: boolean, invalidate: () => void, workerCapacity = 24) {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [];
  const material = new THREE.MeshBasicMaterial({ vertexColors: true }); materials.push(material);
  const sphere = new THREE.SphereGeometry(0.5, low ? 6 : 10, 6); geometries.push(sphere);
  const unitBox = new THREE.BoxGeometry(1, 1, 1); geometries.push(unitBox);
  const object = new THREE.Object3D(); const staticPieces: Piece[] = [];
  const add = (color: string, at: Piece['at'], size: Piece['size'], shape: Piece['shape'] = 'box') => staticPieces.push({ color, at, size, shape });
  const mesh = (pieces: Piece[]) => { const geometry = colouredGeometry(pieces); geometries.push(geometry); const result = new THREE.Mesh(geometry, material); group.add(result); return result; };
  const instance = (geometry: THREE.BufferGeometry, color: string, count: number, opacity = 1) => {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity === 1 }); materials.push(mat);
    const result = new THREE.InstancedMesh(geometry, mat, count); result.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(result); return result;
  };
  const put = (target: THREE.InstancedMesh, index: number, at: Piece['at'], size: Piece['size'], yaw = 0, tilt = 0) => {
    object.position.set(...at); object.rotation.set(0, yaw, tilt); object.scale.set(...size); object.updateMatrix(); target.setMatrixAt(index, object.matrix);
  };
  const updateInstances = (...items: THREE.InstancedMesh[]) => items.forEach(item => { item.instanceMatrix.needsUpdate = true; item.computeBoundingSphere(); });
  const [rx, rz] = funProps.server;
  add('#34404B', [rx, 1.05, rz], [0.9, 2.1, 0.8]);
  for (let i = 0; i < 6; i++) { add('#1F2D39', [rx, 0.25 + i * 0.29, rz + 0.41], [0.76, 0.2, 0.04]); add('#81929C', [rx - 0.22, 0.25 + i * 0.29, rz + 0.44], [0.2, 0.025, 0.015]); }
  const [ax, az] = funProps.aquarium;
  add('#A87A50', [ax, 0.38, az], [2.4, 0.76, 1]); add('#4A3B2F', [ax, 0.79, az], [2.4, 0.1, 1]);
  add('#E4CC95', [ax, 0.86, az], [2.25, 0.08, 0.9]);
  for (const side of [-1, 1]) { add('#4A3B2F', [ax + side * 1.17, 1.3, az], [0.06, 0.95, 1]); add('#4A3B2F', [ax, side < 0 ? 0.86 : 1.76, az], [2.4, 0.07, 1]); }
  for (const dx of [-0.75, 0.75]) { add('#5B9988', [ax + dx, 1.07, az], [0.14, 0.38, 0.18], 'cone'); add('#A1A6AA', [ax + dx * 0.7, 0.96, az + 0.2], [0.32, 0.15, 0.24], 'sphere'); }
  const [px, pz] = funProps.pingPong;
  add('#258B86', [px, 0.93, pz], [3, 0.12, 1.6]);
  for (const dx of [-1.15, 1.15]) for (const dz of [-0.55, 0.55]) add('#4A3B2F', [px + dx, 0.45, pz + dz], [0.09, 0.9, 0.09]);
  for (const dz of [-0.77, 0, 0.77]) add('#FFF8E7', [px, 1, pz + dz], [2.98, 0.012, 0.025]);
  add('#C4DBCD', [px, 1.14, pz], [0.035, 0.28, 1.66]);
  for (const dx of [-1.47, 1.47]) add('#FFF8E7', [px + dx, 1, pz], [0.025, 0.012, 1.6]);
  const [bx, bz] = funProps.board; add('#A87A50', [bx, 2, bz], [3.4, 1.25, 0.08]);
  mesh(staticPieces);
  const glass = instance(unitBox, '#67C5D4', 1, low ? 0.16 : 0.23); put(glass, 0, [ax, 1.28, az], [2.29, 0.82, 0.91]); updateInstances(glass);
  const fishShape = colouredGeometry([
    { shape: 'sphere', color: '#F5B64C', at: [0, 0, 0], size: [0.25, 0.12, 0.1] },
    { shape: 'cone', color: '#F08A3C', at: [-0.14, 0, 0], size: [0.12, 0.14, 0.08], yaw: Math.PI / 2 },
    { shape: 'sphere', color: '#293342', at: [0.07, 0.025, 0.045], size: [0.027, 0.027, 0.02] },
  ]); geometries.push(fishShape);
  const fish = new THREE.InstancedMesh(fishShape, material, low ? 3 : 5); group.add(fish); fish.name = 'aquarium-fish';
  const leds = instance(sphere, '#FFFFFF', Math.max(24, workerCapacity)); leds.name = 'server-leds'; leds.count = 0;
  const steam = instance(sphere, '#D2E5E6', low ? 2 : 4, 0.45);
  const foliageShape = colouredGeometry([
    { color: '#6AA58B', shape: 'sphere', at: [-0.2, 0.3, 0], size: [0.5, 0.4, 0.4] },
    { color: '#8ABD99', shape: 'sphere', at: [0.2, 0.55, 0], size: [0.5, 0.5, 0.4] },
    { color: '#A5CF9A', shape: 'sphere', at: [0, 0.85, 0], size: [0.4, 0.5, 0.4] },
    { color: '#A87A50', at: [0, 0.4, 0], size: [0.06, 0.8, 0.06] },
  ]); geometries.push(foliageShape);
  const leaves = new THREE.InstancedMesh(foliageShape, material, plants.length); group.add(leaves);
  // A compact pedestal fan faces into the lounge; there is no visible ceiling.

  const fan = mesh([
    { color: '#4A3B2F', at: [0, -1.22, 0], size: [0.6, 0.16, 0.48] },
    { color: '#81929C', at: [0, -0.65, 0], size: [0.07, 1.15, 0.07] },
    { color: '#81929C', shape: 'sphere', at: [0, 0, 0], size: [0.68, 0.68, 0.18] },
    { color: '#D8BD97', at: [0, 0, 0.1], size: [0.48, 0.07, 0.04] },
    { color: '#D8BD97', at: [0, 0, 0.1], size: [0.07, 0.48, 0.04] },
    { color: '#4A3B2F', shape: 'sphere', at: [0, 0, 0.14], size: [0.14, 0.14, 0.08] },
  ]); fan.name = 'standing-fan'; fan.position.set(-16.2, 1.3, 10.7);
  const cat = mesh([
    { color: '#DEB181', shape: 'sphere', at: [0, 0.2, 0], size: [0.6, 0.32, 0.3] },
    { color: '#F1CB9A', shape: 'sphere', at: [0.25, 0.4, 0], size: [0.31, 0.3, 0.3] },
    ...[-1, 1].map(side => ({ color: '#DEB181', shape: 'cone' as const, at: [0.25, 0.58, side * 0.09] as const, size: [0.14, 0.2, 0.12] as const })),
    ...[-1, 1].map(side => ({ color: '#3D454C', shape: 'sphere' as const, at: [0.385, 0.43, side * 0.075] as const, size: [0.025, 0.045, 0.028] as const })),
    { color: '#9E7656', shape: 'sphere', at: [-0.34, 0.29, 0], size: [0.3, 0.12, 0.12] },
  ]); cat.name = 'office-cat'; cat.position.set(-15.8, 0.8, 12.2);
  const ball = instance(sphere, '#FFF8E7', 1); ball.name = 'ping-pong-ball'; ball.count = 0;
  const lamp = instance(sphere, '#FFD888', desks.length, 0.25);
  desks.forEach((desk, i) => put(lamp, i, [desk.position[0] + 0.65, 1.25, desk.position[1] + 0.18], [0.27, 0.15, 0.25])); updateInstances(lamp);
  // One canvas atlas: board, neon lettering and all five local-clock windows in one draw.
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 512;
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
  const textMaterial = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }); materials.push(textMaterial);
  const panels: THREE.BufferGeometry[] = [];
  function panel(at: Piece['at'], size: readonly [number, number], tile: number, yaw = 0) {
    const geometry = new THREE.PlaneGeometry(...size); const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setY(i, (uv.getY(i) + 3 - tile) / 4);
    geometry.rotateY(yaw).translate(...at); panels.push(geometry);
  }
  panel([bx, 2, bz + 0.05], [3.2, 1.08], 0);
  panel([0, 2.93, -13.60], [5, 0.44], 1);
  windows.forEach(([x, z]) => { const yaw = x < -17 ? Math.PI / 2 : 0; panel([x + (yaw ? 0.105 : 0), 1.9, z + (yaw ? 0 : 0.105)], [3.55, 1.02], 2, yaw); });
  const textGeometry = mergeGeometries(panels)!; geometries.push(textGeometry); panels.forEach(p => p.dispose()); group.add(new THREE.Mesh(textGeometry, textMaterial));
  let time = new Date(); let state: State | null = null; let night = false;
  let catBlockedAt: number | null = null, catPaused = 0;
  let catAnchor = 'rest-1', catTrip: HopMotion | null = null, catStarted = 0, catDue = 0, catTarget: string | null = null;
  const paint = (next: State, date: Date) => {
    state = next; time = date;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const counts = achievements(next.model, next.reports, date), copy = worldCopy[next.locale].props;
    ctx.fillStyle = '#FFF8E7'; ctx.fillRect(0, 0, 1024, 128); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#4A3B2F'; ctx.font = '600 28px sans-serif';
    ctx.fillText(copy.achievements, 512, 23); ctx.font = '26px sans-serif';
    ctx.fillText(`${copy.released}: ${counts.released ?? '—'}`, 512, 63); ctx.fillText(`${copy.qaWeek}: ${counts.passed ?? '—'}`, 512, 102);
    ctx.fillStyle = '#243D48'; ctx.fillRect(0, 128, 1024, 128); ctx.fillStyle = '#80F1D4'; ctx.font = '700 75px sans-serif'; ctx.shadowColor = '#60DFCA'; ctx.shadowBlur = 9; ctx.fillText(copy.neon, 512, 194, 980); ctx.shadowBlur = 0;
    const day = daylight(date); night = day === 'night';
    const gradient = ctx.createLinearGradient(0, 256, 0, 384); gradient.addColorStop(0, night ? '#182947' : day === 'sunset' ? '#E6908E' : '#85CFE6'); gradient.addColorStop(1, night ? '#405577' : day === 'sunset' ? '#F9CE8C' : '#D8F0E5'); ctx.fillStyle = gradient; ctx.fillRect(0, 256, 1024, 128);
    ctx.fillStyle = night ? '#FFF2C5' : '#FFF1B3'; ctx.beginPath(); ctx.arc(780, night ? 287 : day === 'sunset' ? 350 : 287, night ? 16 : 23, 0, Math.PI * 2); ctx.fill();
    if (night) for (let i = 0; i < 25; i++) { ctx.fillRect(20 + (i * 137 % 980), 265 + (i * 37 % 90), 3, 3); }
    texture.needsUpdate = true; (lamp.material as THREE.MeshBasicMaterial).opacity = night ? 0.6 : 0.18;
    const working = next.model.agents.filter(a => a.status === 'working').length;
    leds.count = working;
    for (let i = 0; i < working; i++) { put(leds, i, [rx + 0.06 + i % 4 * 0.09, 0.25 + Math.floor(i / 4) * 0.29, rz + 0.46], [0.05, 0.05, 0.025]); leds.setColorAt(i, new THREE.Color('#65E1A5')); }
    updateInstances(leds); if (leds.instanceColor) leds.instanceColor.needsUpdate = true;
    invalidate();
  };
  const sample = (t: number, moving: boolean) => {
    const clock = moving ? t : 0;
    for (let i = 0; i < fish.count; i++) { const a = clock * (0.32 + i * 0.025) + i * 1.7; put(fish, i, [ax + Math.sin(a) * 0.85, 1.08 + i % 3 * 0.17 + Math.sin(a * 1.3) * 0.04, az + Math.cos(a) * 0.28], [1, 1, 1], -a); }
    for (let i = 0; i < steam.count; i++) { const p = (clock * 0.18 + i / steam.count) % 1; put(steam, i, [anchors.coffee[0] + Math.sin(clock + i) * 0.08, 1.15 + p * 0.9, anchors.coffee[1] + 0.4], [0.1 + p * 0.18, 0.12 + p * 0.23, 0.1 + p * 0.18]); }
    plants.forEach(([x, z], i) => put(leaves, i, [x, 0.5, z], [1, 1, 1], i, low ? 0 : Math.sin(clock * 0.7 + i) * 0.07));
    fan.rotation.y = low ? 0 : Math.sin(clock * 0.55) * 0.25;
    if (leds.instanceColor) { for (let i = 0; i < leds.count; i++) leds.setColorAt(i, new THREE.Color().setRGB(0.18, moving ? 0.65 + 0.3 * Math.sin(clock * 2 + i) ** 2 : 0.9, 0.4)); leds.instanceColor.needsUpdate = true; }
    if (state) {
      const players = state.debug.current.agents.filter(a => a.activity === 'ping-pong' && !a.walking && a.status === 'idle');
      ball.count = moving && players.length === 2 ? 1 : 0;
      if (ball.count) { const p = (clock * 0.65) % 1, x = Math.cos(p * Math.PI * 2) * 1.35; put(ball, 0, [px + x, 1.15 + Math.abs(Math.sin(p * Math.PI * 4)) * 0.5, pz], [0.1, 0.1, 0.1]); }
      const petting = state.debug.current.agents.some(a => a.activity === 'pet-cat' && a.status === 'idle');
      const idle = state.model.agents.filter(a => a.status === 'idle' && !a.paused && !a.overflow && !state!.debug.current.agents.find(d => d.seatId === a.seatId)?.wandering);
      if (moving && clock >= catDue && !catTrip) {
        const worker = Math.floor(clock / 40) % 3 === 1 ? idle[Math.floor(clock / 40) % Math.max(1, idle.length)] : null;
        const destination = petting ? 'cat-perch' : worker ? deskForAgent(worker)?.id ?? 'rest-1' : Math.floor(clock / 40) % 2 ? 'rest-1' : 'cat-perch';
        const path = pathBetween(catAnchor, destination);
        if (path.length) { catTrip = hopAlong([[cat.position.x, cat.position.y, cat.position.z], ...path.map(([x, z]) => [x, 0.04, z] as const)], 0.65); catStarted = clock; catPaused = 0; catBlockedAt = null; catAnchor = destination; catTarget = worker?.seatId ?? null; }
        catDue = clock + 30;
      }
      if (moving && catTrip) {
        const position = catTrip.sample((catBlockedAt ?? clock) - catStarted - catPaused);
        const crowded = [...state.positions.current.values()].some(p => Math.hypot(p[0] - position.position[0], p[1] - position.position[2]) < 0.75);
        if (!crowded) {
          if (catBlockedAt !== null) { catPaused += clock - catBlockedAt; catBlockedAt = null; }
          cat.position.set(...position.position); cat.rotation.y = position.yaw + Math.PI / 2;
        } else if (catBlockedAt === null) catBlockedAt = clock;
        if (position.done && !crowded) { catTrip = null; catDue = clock + (petting ? 8 : 15); }
      }
      if (catTarget && !idle.some(a => a.seatId === catTarget)) { catTarget = null; catTrip = null; catDue = clock; }
      setCatPettable(!catTrip && catAnchor === 'cat-perch');
      if (petting && catAnchor === 'cat-perch' && !catTrip) catDue = clock + 10;
      if (!catTrip && catAnchor === 'rest-1' && !petting) { cat.position.set(-15.8, 0.8, 12.2); cat.scale.set(1, 0.65, 1); } else cat.scale.set(1, 1, 1);
    }
    updateInstances(fish, steam, leaves, ball);
  };
  sample(0, false);
  group.traverse(o => { o.raycast = ignore; });
  return { group, paint, sample, clock: () => time, dispose() { setCatPettable(false); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); texture.dispose(); group.traverse(o => { if (o instanceof THREE.InstancedMesh) o.dispose(); }); } };
}

export function FunProps({ model, reports, quality, still, hidden, debug, positions, locale }: State & { quality: 'high' | 'low'; still: boolean; hidden: boolean }) {
  const [resource, setResource] = useState<ReturnType<typeof makeFunProps> | null>(null);
  const current = useRef(resource); current.current = resource;
  const motion = useWorldMotion(), invalidate = useThree(s => s.invalidate);
  useEffect(() => { const value = makeFunProps(quality === 'low', invalidate, model.agents.length); setResource(value); return value.dispose; }, [quality, invalidate, model.agents.length]);
  useEffect(() => { debug.current.props = hidden ? [] : [...propIds]; return () => { debug.current.props = []; }; }, [debug, hidden]);
  useEffect(() => {
    if (!resource) return;
    const update = () => resource.paint({ model, reports, debug, positions, locale }, still ? resource.clock() : new Date());
    update(); if (still || hidden) return;
    const timer = setInterval(update, 60_000); return () => clearInterval(timer);
  }, [resource, model, reports, debug, positions, locale, still, hidden]);
  useEffect(() => { if (!hidden && !still) return motion.request('ambient'); }, [hidden, still, motion]);
  useEffect(() => { if (still) resource?.sample(0, false); }, [still, resource]);
  useFrame(() => { if (!hidden && !still) current.current?.sample(performance.now() / 1000, true); });
  return resource && !hidden ? <primitive object={resource.group} /> : null;
}
