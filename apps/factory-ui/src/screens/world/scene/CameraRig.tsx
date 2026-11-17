import { useEffect, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrthographicCamera, Vector3, MathUtils } from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { cameraBounds, cameraPresets, fitZoom, isoDistance, type ZoneKey } from '../layout/camera';
import { ownerDesk, zones, type Point } from '../layout/zones';
import { useCameraBridge, type CameraApi, type CameraState } from '../cameraContext';
import { useWorldMotion } from './Ticker';
export type WorldLocations = RefObject<Map<string, readonly [number, number, number]>>;
export type Locate = (kind: 'agent' | 'owner' | 'zone' | 'card' | 'bug' | 'frame', id?: string) => { x: number; y: number } | null;
export function CameraRig({ mapRef, still, onState, onLocate, agentPositions, locations }: {
  agentPositions: RefObject<Map<string, Point>>; locations: WorldLocations;
  mapRef: RefObject<HTMLDivElement | null>; still: boolean;
  onState: (state: CameraState) => void; onLocate: (locate: Locate | null) => void;
}) {
  const { camera, gl, size, invalidate } = useThree();
  const { register, publish } = useCameraBridge();
  const motion = useWorldMotion();
  const viewport = useRef(size); viewport.current = size;
  const stillRef = useRef(still); stillRef.current = still;
  const engine = useRef<{ controls: MapControls; api: CameraApi } | null>(null);
  const animate = useRef<(now: number, delta: number) => void>(() => {});
  useEffect(() => {
    if (!(camera instanceof OrthographicCamera)) return;
    const controls = new MapControls(camera, gl.domElement);
    controls.enableRotate = false; controls.screenSpacePanning = false; controls.zoomToCursor = true;
    controls.maxZoom = 120; controls.enableDamping = false;
    let tween: { from: Vector3; to: Vector3; zoom: number; toZoom: number; at: number } | null = null;
    let getter: (() => Point) | null = null;
    let release: (() => void) | null = null;
    const offset = new Vector3().setScalar(isoDistance / Math.sqrt(3));
    const cancel = () => { tween = null; getter = null; release?.(); release = null; };
    const clamp = () => {
      controls.target.set(MathUtils.clamp(controls.target.x, cameraBounds.x[0], cameraBounds.x[1]), 0, MathUtils.clamp(controls.target.z, cameraBounds.z[0], cameraBounds.z[1]));
      camera.position.copy(controls.target).add(offset); camera.lookAt(controls.target);
      camera.zoom = MathUtils.clamp(camera.zoom, controls.minZoom, controls.maxZoom);
      camera.updateProjectionMatrix();
    };
    const report = () => {
      const preset = Object.entries(cameraPresets).find(([, p]) => Math.hypot(p[0] - controls.target.x, p[1] - controls.target.z) <= 0.5);
      const state: CameraState = { target: [controls.target.x, controls.target.z], zoom: camera.zoom, moving: Boolean(tween || getter), following: Boolean(getter), zone: preset?.[0] ?? null };
      onState(state); publish(state);
    };
    const move = (point: Point, zoom: number) => {
      cancel();
      const toZoom = MathUtils.clamp(zoom, controls.minZoom, 120);
      if (stillRef.current) { controls.target.set(point[0], 0, point[1]); camera.zoom = toZoom; clamp(); report(); invalidate(); return; }
      tween = { from: controls.target.clone(), to: new Vector3(point[0], 0, point[1]), zoom: camera.zoom, toZoom, at: performance.now() };
      release = motion.request('live');
      report(); invalidate();
    };
    const scale = () => Math.min(viewport.current.width / 1366, viewport.current.height / 768);
    const api: CameraApi = {
      focusZone(key) { const [x, z, zoom] = cameraPresets[key]; move([x, z], zoom * scale()); },
      focusPoint(point, zoom) { move(point, zoom === undefined ? camera.zoom : zoom * scale()); },
      home() { move([0, 0], fitZoom(viewport.current.width, viewport.current.height)); },
      follow(next) { cancel(); getter = next; if (next && !stillRef.current) release = motion.request('live'); report(); invalidate(); },
    };
    const changed = () => { clamp(); report(); invalidate(); };
    const start = () => { cancel(); report(); };
    controls.addEventListener('start', start); controls.addEventListener('change', changed);
    engine.current = { controls, api }; register(api);
    animate.current = (now, delta) => {
      if (getter) { const [x, z] = getter(); controls.target.lerp(new Vector3(x, 0, z), stillRef.current ? 1 : 1 - Math.exp(-8 * delta)); }
      if (tween) {
        const t = stillRef.current ? 1 : Math.min(1, (now - tween.at) / 600); const eased = t * t * (3 - 2 * t);
        controls.target.lerpVectors(tween.from, tween.to, eased); camera.zoom = MathUtils.lerp(tween.zoom, tween.toZoom, eased);
        if (t === 1) { tween = null; release?.(); release = null; }
      }
      clamp(); report();
    };
    const map = mapRef.current;
    const keydown = (event: KeyboardEvent) => {
      if (event.target !== map) return;
      const key = event.key; const arrows: Record<string, Point> = { ArrowLeft: [-1, 1], ArrowRight: [1, -1], ArrowUp: [-1, -1], ArrowDown: [1, 1] };
      const direction = arrows[key];
      if (direction) { cancel(); const step = 50 / camera.zoom; controls.target.add(new Vector3(direction[0] * step, 0, direction[1] * step)); changed(); }
      else if (key === '+' || key === '=' || key === '-') { cancel(); camera.zoom *= key === '-' ? 1 / 1.15 : 1.15; changed(); }
      else if (key === '0') api.home();
      else if (/^[1-6]$/.test(key)) api.focusZone(String.fromCharCode(64 + Number(key)) as ZoneKey);
      else if (key === 'Escape') { cancel(); report(); }
      else return;
      event.preventDefault();
    };
    const focusMap = () => map?.focus({ preventScroll: true });
    map?.addEventListener('keydown', keydown); gl.domElement.addEventListener('pointerdown', focusMap);
    onLocate((kind, id) => {
      const object = locations.current.get(`${kind}:${id}`);
      const point = kind === 'owner' ? ownerDesk.position : kind === 'agent' ? agentPositions.current.get(id ?? '') : kind === 'zone' ? zones.find(z => z.id === id)?.anchor : object ? [object[0], object[2]] : null; if (!point) return null;
      const p = new Vector3(point[0], object?.[1] ?? (kind === 'agent' ? 1 : kind === 'owner' ? 0.9 : 0.05), point[1]).project(camera);
      if (p.z < -1 || p.z > 1) return null;
      const rect = gl.domElement.getBoundingClientRect(); return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
    });
    return () => {
      cancel(); controls.removeEventListener('start', start); controls.removeEventListener('change', changed); controls.dispose();
      map?.removeEventListener('keydown', keydown); gl.domElement.removeEventListener('pointerdown', focusMap);
      register({ focusZone() {}, focusPoint() {}, home() {}, follow() {} }); engine.current = null; animate.current = () => {}; onLocate(null);
    };
  }, [camera, gl, invalidate, mapRef, motion, onLocate, onState, publish, register, agentPositions, locations]);
  useEffect(() => {
    const e = engine.current; if (!e || !(camera instanceof OrthographicCamera)) return;
    // Fit the isometric projection of the complete bounds [-18,44] × [-26,14].
    e.controls.minZoom = Math.min(size.width / 74, size.height / 44) * 0.9;
    e.api.home();
  }, [camera, size.width, size.height]);
  useEffect(() => { invalidate(); }, [still, invalidate]);
  useFrame((_, delta) => animate.current(performance.now(), Math.min(delta, 0.1)));
  return null;
}
