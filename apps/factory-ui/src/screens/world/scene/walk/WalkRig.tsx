import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { i18n } from '@/i18n';
import { OperatorAvatar } from './OperatorAvatar';
import { useWorldMotion } from '../Ticker';
import { useCameraBridge } from '../../cameraContext';
import type { WorldModel } from '../../data/types';
import type { Point } from '../../layout/zones';
import { chairmanChair } from '../../layout/chairman';
import { resolveWalkMove } from './collision';
import { obstructionDistance } from './obstructions';
import { useWalkPresence } from './awareness';
import { tone } from '../toys/sound';
import type { WalkState, WalkTarget } from './state';
import { toys } from '../toys/store';
import { useToys } from '../toys/useToys';
import { playToy } from '../toys/playToy';
import { detailedToys, lightToys, toyInk, toyOutlineInk, toyGlowInk, createWhipMaterials } from '../toys/models';

type Props = { onExit: () => void; state: RefObject<WalkState>; positions: RefObject<Map<string, Point>>; model: WorldModel; paused: boolean; still: boolean; quiet: boolean; quality: 'high' | 'low'; onInteract: (target: WalkTarget) => void };
function editable(target: EventTarget | null) { return target instanceof HTMLElement && !!target.closest('input,textarea,select,[contenteditable="true"]'); }
function targetFor(object: THREE.Object3D, instanceId: number | undefined): WalkTarget | null {
  let ancestor: THREE.Object3D | null = object;
  while (ancestor) { if (!ancestor.visible) return null; ancestor = ancestor.parent; }
  let node: THREE.Object3D | null = object;
  while (node) {
    if (!node.visible) return null;
    const target = node.userData.walkTarget ?? (instanceId === undefined ? null : node.userData.walkTargets?.[instanceId]);
    if (target) return target as WalkTarget;
    const release = node.userData.release as { releaseId: string; name: string } | undefined;
    if (release) return { kind: 'release', id: release.releaseId, name: release.name };
    node = node.parent;
  }
  return null;
}

export function WalkRig(props: Props) {
  const { gl, size, set, get, scene, invalidate } = useThree();
  const { register } = useCameraBridge(), motion = useWorldMotion();
  const state = props.state, presence = useWalkPresence();
  const stepDistance = useRef(0), lastStep = useRef(0);
  const latest = useRef(props); latest.current = props;
  const camera = useMemo(() => new THREE.PerspectiveCamera(60, 1, 0.06, 180), []);
  const keys = useRef(new Set<string>()), drag = useRef(false), velocity = useRef(0), jump = useRef(0), travel = useRef(0), started = useRef(0), sampled = useRef(0);
  const root = useRef<THREE.Group>(null), avatar = useRef<THREE.Group>(null), hand = useRef<THREE.Group>(null), toolNode = useRef<THREE.Group>(null);
  const toy = useToys(), assets = toy.tool ? (props.quality === 'low' ? lightToys : detailedToys)[toy.tool] : null;
  const leather = useMemo(() => toy.tool === 'whip' ? createWhipMaterials() : null, [toy.tool]);
  useEffect(() => () => { leather?.solid.dispose(); leather?.outline.dispose(); }, [leather]);
  const scratch = useMemo(() => ({ raycaster: new THREE.Raycaster(), ray: new THREE.Ray(), focus: new THREE.Vector3(), desired: new THREE.Vector3(), springVelocity: new THREE.Vector3(), direction: new THREE.Vector3(), zero: new THREE.Vector2(), up: new THREE.Vector3(0, 0.1, 0), aim: new THREE.Euler(0, 0, 0, 'YXZ') }), []);
  useLayoutEffect(() => {
    const previous = get().camera;
    state.current.visited = true;
    camera.position.set(state.current.position[0], 2.6, state.current.position[2] + 3.4);
    set({ camera });
    // Roster selection still opens panels while the walk camera remains in place.
    register({ focusZone() {}, focusPoint() {}, home() {}, follow() {} });
    invalidate();
    return () => { state.current.target = null; set({ camera: previous }); if (document.pointerLockElement === gl.domElement) document.exitPointerLock(); };
  }, [camera, get, set, gl, register, invalidate, state]);
  useEffect(() => { camera.aspect = size.width / size.height; camera.updateProjectionMatrix(); }, [camera, size.width, size.height]);
  useEffect(() => motion.request('live'), [motion]);
  useEffect(() => {
    keys.current.clear(); drag.current = false;
    if (props.paused && document.pointerLockElement === gl.domElement) document.exitPointerLock();
  }, [props.paused, gl]);
  useEffect(() => {
    const canvas = gl.domElement;
    const clear = () => { keys.current.clear(); drag.current = false; };
    let locked = false;
    const lockChanged = () => {
      const wasLocked = locked; locked = document.pointerLockElement === canvas; clear();
      if (wasLocked && !locked && !state.current.seated && !latest.current.paused && !document.hidden && document.hasFocus()) latest.current.onExit();
    };
    const look = (event: MouseEvent) => {
      if (latest.current.paused || document.hidden || !(document.pointerLockElement === canvas || drag.current)) return;
      if (event.movementX || event.movementY) state.current.looked = true;
      state.current.yaw -= event.movementX * 0.0024;
      state.current.pitch = THREE.MathUtils.clamp(state.current.pitch - event.movementY * 0.0024, -1.25, 1.15);
    };
    const down = (event: PointerEvent) => {
      // Stop R3F's iso pointer handlers while walking; DOM controls remain usable.
      if (state.current.seated) return;
      event.stopImmediatePropagation();
      if (latest.current.paused || event.button !== 0) return;
      drag.current = true;
      canvas.closest<HTMLElement>('.world-map')?.focus({ preventScroll: true });
      if (document.pointerLockElement !== canvas) {
        try { const result = canvas.requestPointerLock?.(); if (result) void result.catch(() => {}); } catch { /* Drag-to-look remains available. */ }
      }
      const target = state.current.target, tool = toys.snapshot().tool;
      if (tool && target?.kind === 'agent' && (target.distance ?? Infinity) <= 2.5) {
        playToy(target.id, tool, latest.current.quiet); started.current = Date.now();
      }
    };
    const stopIso = (event: Event) => { if (!state.current.seated) event.stopImmediatePropagation(); };
    const up = () => { drag.current = false; };
    const wheel = (event: WheelEvent) => {
      if (event.altKey) return; // Alt+wheel selects hotbar slots; plain wheel zooms.
      event.preventDefault(); event.stopImmediatePropagation();
      if (!latest.current.paused) state.current.cameraDistance = THREE.MathUtils.clamp(state.current.cameraDistance + event.deltaY * 0.004, 2.5, 6);
    };
    const keydown = (event: KeyboardEvent) => {
      if (state.current.seated && event.key === 'Escape') return;
      if (editable(event.target) || event.ctrlKey || event.metaKey || event.altKey || latest.current.paused || document.hidden) return;
      const key = event.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', ' '].includes(key)) { keys.current.add(key); event.preventDefault(); event.stopImmediatePropagation(); }
      if (event.repeat) return;
      if (key === 'c') { state.current.firstPerson = !state.current.firstPerson; event.preventDefault(); }
      else if (key === 'e' && state.current.target) { clear(); latest.current.onInteract(state.current.target); event.preventDefault(); }
    };
    const keyup = (event: KeyboardEvent) => keys.current.delete(event.key.toLowerCase());
    canvas.addEventListener('pointerdown', down, true);
    canvas.addEventListener('wheel', wheel, { capture: true, passive: false });
    for (const kind of ['pointerup', 'click', 'pointermove'] as const) canvas.addEventListener(kind, stopIso, true);
    document.addEventListener('mousemove', look); document.addEventListener('pointerup', up);
    document.addEventListener('keydown', keydown, true); document.addEventListener('keyup', keyup);
    document.addEventListener('pointerlockchange', lockChanged); document.addEventListener('visibilitychange', clear); window.addEventListener('blur', clear);
    return () => {
      clear(); canvas.removeEventListener('pointerdown', down, true); canvas.removeEventListener('wheel', wheel, true);
      for (const kind of ['pointerup', 'click', 'pointermove'] as const) canvas.removeEventListener(kind, stopIso, true);
      document.removeEventListener('mousemove', look); document.removeEventListener('pointerup', up);
      document.removeEventListener('keydown', keydown, true); document.removeEventListener('keyup', keyup);
      document.removeEventListener('pointerlockchange', lockChanged); document.removeEventListener('visibilitychange', clear); window.removeEventListener('blur', clear);
    };
  }, [gl, state]);
  useFrame((_, rawDelta) => {
    const walk = state.current, dt = Math.min(rawDelta, 0.05), held = keys.current;
    const active = !props.paused && !walk.seated && !document.hidden;
    let forward = active ? Number(held.has('w') || held.has('arrowup')) - Number(held.has('s') || held.has('arrowdown')) : 0;
    let strafe = active ? Number(held.has('d') || held.has('arrowright')) - Number(held.has('a') || held.has('arrowleft')) : 0;
    const length = Math.hypot(forward, strafe); if (length) { forward /= length; strafe /= length; }
    const speed = held.has('shift') ? 4.7 : 2.5;
    let dx = (-Math.sin(walk.yaw) * forward + Math.cos(walk.yaw) * strafe) * speed * dt;
    let dz = (-Math.cos(walk.yaw) * forward - Math.sin(walk.yaw) * strafe) * speed * dt;
    // Workers yield softly: nudge the operator away without moving the live worker data.
    if (active) for (const [id, point] of props.positions.current) {
      const x = walk.position[0] - point[0], z = walk.position[2] - point[1], distance = Math.hypot(x, z);
      const toward = x * dx + z * dz < 0;
      if (length && toward && distance < 1 && presence && Date.now() - (presence.bumps.get(id) ?? 0) > 1800) {
        const at = Date.now(); presence.bumps.set(id, at);
        walk.speech = i18n.t(at % 2 ? 'worldUi.walk.bump' : 'worldUi.walk.boss'); walk.speechAt = at;
      }
      if (distance < 0.85) { const push = (0.85 - distance) * 3 * dt; dx += (distance > 0.001 ? x / distance : 1) * push; dz += (distance > 0.001 ? z / distance : 0) * push; }
    }
    const next = walk.seated ? { x: chairmanChair[0], z: chairmanChair[1] } : resolveWalkMove({ x: walk.position[0], z: walk.position[2] }, { x: dx, z: dz });
    const moved = Math.hypot(next.x - walk.position[0], next.z - walk.position[2]);
    travel.current += moved * 8;
    if (active && length && jump.current === 0 && moved > 0.002) {
      stepDistance.current += moved;
      if (stepDistance.current >= 0.58 && performance.now() - lastStep.current > 150) {
        stepDistance.current %= 0.58; lastStep.current = performance.now();
        if (toys.snapshot().sound && !props.quiet) tone('step');
      }
    } else stepDistance.current = 0;
    walk.position[0] = next.x; walk.position[2] = next.z;
    if (active) {
      if (held.has(' ') && jump.current === 0) { velocity.current = 4; held.delete(' '); }
      velocity.current -= 11 * dt; jump.current = Math.max(0, jump.current + velocity.current * dt);
      if (jump.current === 0) velocity.current = 0;
    }
    walk.position[1] = walk.seated ? 0.54 : jump.current;
    if (root.current) { root.current.position.set(...walk.position); root.current.rotation.y = walk.yaw + Math.PI; root.current.visible = !walk.firstPerson || walk.seated; }
    if (avatar.current) {
      const hop = !props.still && active && length ? Math.abs(Math.sin(travel.current)) : 0;
      avatar.current.position.y = hop * 0.16;
      avatar.current.rotation.x = walk.seated ? -0.1 : 0;
      avatar.current.scale.set(1 + (1 - hop) * (length ? 0.05 : 0), 1 - (1 - hop) * (length ? 0.08 : 0), 1);
    }
    const bob = !props.still && active && length ? Math.sin(travel.current) * 0.025 : 0;
    scratch.focus.set(next.x, 1.3 + jump.current + bob, next.z);
    scratch.aim.set(walk.pitch, walk.yaw, 0);
    scratch.direction.set(0, 0, -1).applyEuler(scratch.aim);
    if (walk.firstPerson) { camera.position.copy(scratch.focus); camera.quaternion.setFromEuler(scratch.aim); }
    else {
      scratch.desired.copy(scratch.focus).addScaledVector(scratch.direction, -walk.cameraDistance); scratch.desired.y += 0.7;
      scratch.ray.set(scratch.focus, scratch.direction.copy(scratch.desired).sub(scratch.focus).normalize());
      const reach = scratch.desired.distanceTo(scratch.focus), clear = obstructionDistance(scratch.ray, reach);
      scratch.desired.copy(scratch.focus).addScaledVector(scratch.ray.direction, Math.max(0.08, clear - 0.16));
      // Exact critically damped spring: stable at both 30 and 60 fps.
      if (props.still) { camera.position.copy(scratch.desired); scratch.springVelocity.set(0, 0, 0); }
      else for (const axis of ['x', 'y', 'z'] as const) {
        const offset = camera.position[axis] - scratch.desired[axis], v = scratch.springVelocity[axis];
        const decay = Math.exp(-12 * dt), c = v + 12 * offset;
        camera.position[axis] = scratch.desired[axis] + (offset + c * dt) * decay;
        scratch.springVelocity[axis] = (v - 12 * c * dt) * decay;
      }
      // Recheck the spring's actual path so sideways movement cannot drag the camera through a wall.
      scratch.ray.set(scratch.focus, scratch.direction.copy(camera.position).sub(scratch.focus).normalize());
      const currentDistance = camera.position.distanceTo(scratch.focus), safe = obstructionDistance(scratch.ray, currentDistance);
      if (safe < currentDistance) { camera.position.copy(scratch.focus).addScaledVector(scratch.ray.direction, Math.max(0.08, safe - 0.16)); scratch.springVelocity.set(0, 0, 0); }
      scratch.direction.set(0, 0, -1).applyEuler(scratch.aim);
      camera.lookAt(scratch.desired.copy(scratch.focus).addScaledVector(scratch.direction, 1.5).add(scratch.up));
    }
    if (walk.seated) { camera.position.set(chairmanChair[0] - .85, 2.35, chairmanChair[1] - 1.55); camera.lookAt(-14, 1.3, -7.7); }
    camera.updateMatrixWorld();
    if (hand.current) { hand.current.visible = walk.firstPerson; hand.current.position.copy(camera.position); hand.current.quaternion.copy(camera.quaternion); }
    if (toolNode.current) {
      if (toy.tool && !props.still && started.current && Date.now() - started.current < 3000) {
        const t = (Date.now() - started.current) / 1000;
        toolNode.current.rotation.z = Math.sin(Math.min(1, t / 0.8) * Math.PI) * 0.12;
        toolNode.current.position.y = Math.sin(Math.min(1, t / 0.8) * Math.PI) * 0.08;
        if (leather) leather.clock.value = t;
      } else { toolNode.current.position.set(0, 0, 0); toolNode.current.rotation.set(0, 0, 0); toolNode.current.scale.setScalar(1); }

    }
    if (performance.now() - sampled.current > 80) {
      sampled.current = performance.now(); walk.target = null;
      if (active) {
        const chairDistance = Math.hypot(walk.position[0] - chairmanChair[0], walk.position[2] - chairmanChair[1]);
        if (chairDistance < 1.7) walk.target = { kind: 'office', id: 'chair', name: i18n.t('worldUi.walk.owner'), distance: chairDistance };
        // A nearby OIIA is usable even when the third-person crosshair passes above it.
        const cat = scene.getObjectByName('oiia-cat');
        if (cat && Math.hypot(cat.position.x - next.x, cat.position.z - next.z) < 1.9) {
          scratch.ray.set(scratch.focus, scratch.direction.copy(cat.position).setY(0.6).sub(scratch.focus).normalize());
          if (obstructionDistance(scratch.ray, scratch.focus.distanceTo(cat.position)) > Math.hypot(cat.position.x - next.x, cat.position.z - next.z) - 0.6) walk.target = { kind: 'cat', id: 'oiia', name: 'OIIA', distance: 1.9 };
        }
        if (walk.target?.kind === 'office' && walk.target.id === 'chair') return;
        scratch.raycaster.setFromCamera(scratch.zero, camera); scratch.raycaster.far = walk.firstPerson ? 3.5 : walk.cameraDistance + 4;
        const wall = obstructionDistance(scratch.raycaster.ray, scratch.raycaster.far);
        for (const hit of scratch.raycaster.intersectObjects(scene.children, true)) {
          const target = targetFor(hit.object, hit.instanceId); if (!target) continue;
          // Reach is measured from the operator's eye, also in third-person.
          const distance = hit.point.distanceTo(scratch.focus);
          if (distance > 3 || hit.distance > wall + 0.22) continue;
          let name = target.name;
          if (target.kind === 'agent') name = props.model.agents.find(a => a.seatId === target.id)?.name;
          if (target.kind === 'owner') name = i18n.t('worldUi.walk.owner');
          walk.target = { ...target, name: name ?? target.id, distance }; break;
        }
      }
    }
  });
  return <>
    <group ref={root}><group ref={avatar}><OperatorAvatar quality={props.quality} /></group></group>
    <group ref={hand}>
      <mesh position={[0.25, -0.22, -0.44]} raycast={() => {}}><sphereGeometry args={[0.085, 12, 8]} /><meshToonMaterial color="#FFF0CD" /></mesh>
      {assets && <group position={[0.48, -0.55, -1]} scale={0.32}><group ref={toolNode}>
        <mesh dispose={null} geometry={assets.solid} material={leather?.solid ?? toyInk} raycast={() => {}} />
        {props.quality !== 'low' && <mesh dispose={null} geometry={assets.hull} material={leather?.outline ?? toyOutlineInk} raycast={() => {}} />}
        {assets.glow && <mesh dispose={null} geometry={assets.glow} material={toyGlowInk} raycast={() => {}} />}
      </group></group>}
    </group>
  </>;
}
