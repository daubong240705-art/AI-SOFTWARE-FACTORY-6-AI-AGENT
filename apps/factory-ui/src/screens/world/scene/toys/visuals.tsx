import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { i18n, useT } from '@/i18n';
import { createScreenTexture, type ScreenTexture } from '../screenTexture';
import { useWorldMotion } from '../Ticker';
import { toys, type ToyEffect } from './store';
import { colouredGeometry } from '../props/geometry';
import { toyModels, toyInk, clamp, smooth, back } from './models';
const ignore = () => {};
const ring = new THREE.TorusGeometry(0.35, 0.018, 3, 20);
const puff = new THREE.IcosahedronGeometry(0.075, 0);
const inks = new Map<string, THREE.MeshBasicMaterial>();
function ink(color: string) { let m = inks.get(color); if (!m) { m = new THREE.MeshBasicMaterial({ color }); inks.set(color, m); } return m; }
/** Shared canvas text helper; first paint is static even in still mode. */
export function Bubble({ text, position = [0, 2.35, 0], width = 2 }: { text: string; position?: [number, number, number]; width?: number }) {
  const invalidate = useThree(s => s.invalidate); const [screen, setScreen] = useState<ScreenTexture | null>(null);
  useEffect(() => { const value = createScreenTexture(512, 128, invalidate); setScreen(value); return value.dispose; }, [invalidate]);
  useEffect(() => {
    if (!screen) return;
    screen.draw(ctx => { ctx.fillStyle = '#FFF8E7'; ctx.beginPath(); ctx.roundRect(4, 4, 504, 120, 32); ctx.fill(); ctx.fillStyle = '#593F42'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '600 40px sans-serif'; ctx.fillText(text, 256, 66, 470); });
    return screen.cancel;
  }, [screen, text]);
  return screen && <sprite position={position} scale={[width, 0.46, 1]} raycast={ignore}><spriteMaterial ref={material => { if (material) screen.attach(material); }} map={screen.texture} transparent depthWrite={false} /></sprite>;
}
export function Stamp({ mark, color = '#F58FB0' }: { mark: string; color?: string }) {
  const invalidate = useThree(s => s.invalidate); const [screen, setScreen] = useState<ScreenTexture | null>(null);
  useEffect(() => { const value = createScreenTexture(256, 256, invalidate); setScreen(value); return value.dispose; }, [invalidate]);
  useEffect(() => {
    screen?.draw(ctx => {
      if (mark === 'skeleton') {
        ctx.strokeStyle = '#FFFFFF'; ctx.fillStyle = '#FFFFFF'; ctx.lineWidth = 9; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(128, 47, 27, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#593F42'; for (const x of [118, 138]) { ctx.beginPath(); ctx.arc(x, 44, 6, 0, Math.PI * 2); ctx.fill(); }
        ctx.beginPath(); ctx.moveTo(128, 77); ctx.lineTo(128, 165);
        for (const side of [-1, 1]) { ctx.moveTo(128, 86); ctx.lineTo(128 + side * 47, 138); ctx.moveTo(128, 160); ctx.lineTo(128 + side * 35, 231); for (const y of [100, 117, 134]) { ctx.moveTo(128 - 22, y); ctx.lineTo(128 + 22, y); } }
        ctx.stroke(); return;
      }
      ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold 160px sans-serif'; ctx.fillText(mark, 128, 132, 245); });
    return () => screen?.cancel();
  }, [screen, mark, color]);
  return screen && <sprite scale={[0.85, 0.85, 1]} raycast={ignore}><spriteMaterial ref={material => { if (material) screen.attach(material); }} map={screen.texture} transparent depthWrite={false} /></sprite>;
}
/** Model animation ends at 1.8s; longer state lifetimes only retain the cosmetic buff. */
export function ToyWorker({ effect, still, low, children }: { effect: ToyEffect | undefined; still: boolean; low: boolean; children: ReactNode }) {
  useT();
  const motion = useWorldMotion(), [show, setShow] = useState(false);
  const quiet = still || !!effect?.quiet;
  useEffect(() => {
    setShow(!!effect && Date.now() < effect.started + 1800);
    if (!effect) return;
    const expiry = setTimeout(() => toys.refresh(), Math.max(1, effect.until - Date.now()));
    const end = setTimeout(() => setShow(false), Math.max(1, effect.started + 1800 - Date.now()));
    // Megaphone bob and aura boosts continue after the model leaves.
    const stop = quiet ? undefined : motion.request('live');
    return () => { clearTimeout(expiry); clearTimeout(end); stop?.(); };
  }, [effect, quiet, motion]);
  return <group>
    {children}
    {effect && show && <Bubble text={i18n.t(`worldUi.toys.bubbles.${effect.tool}`)} />}
    {effect && show && !quiet && <ToyAnimation key={`${effect.started}:${effect.tool}`} effect={effect} low={low} />}
  </group>;
}
function ToyAnimation({ effect, low }: { effect: ToyEffect; low: boolean }) {
  const model = useRef<THREE.Mesh>(null), glyph = useRef<THREE.Group>(null);
  const rings = useRef<THREE.InstancedMesh>(null), particles = useRef<THREE.InstancedMesh>(null), arcs = useRef<THREE.InstancedMesh>(null);
  const tool = effect.tool;
  const [lash] = useState(() => tool === 'whip' ? toyModels.whip.clone() : null);
  useEffect(() => () => lash?.dispose(), [lash]);
  const [matrix] = useState(() => new THREE.Object3D());
  const [from] = useState(() => new THREE.Vector3()); const [to] = useState(() => new THREE.Vector3());
  const [axis] = useState(() => new THREE.Vector3(0, 1, 0));
  useFrame(() => {
    const node = model.current; if (!node) return;
    const t = (Date.now() - effect.started) / 1000, enter = back(t / 0.4), leave = smooth((t - 1.4) / 0.4);
    const hit = Math.sin(clamp((t - 0.5) / 0.7) * Math.PI), flutter = Math.sin(t * 26);
    node.visible = t < 1.8;
    node.position.set(-0.65 - (1 - enter) * 2.2 - leave * 2, 0.65 + Math.sin(clamp(t / 0.45) * Math.PI) * 0.55 + leave * 0.7, 0.45);
    node.rotation.set(0, 0, 0); node.scale.setScalar(1 - leave * 0.65);
    switch (tool) {
      case 'whip': {
        node.position.y = 0.7; node.rotation.z = -Math.sin(smooth(t / 0.5) * Math.PI) * 1.2 + hit * 0.25;
        if (lash) {
          const src = toyModels.whip.getAttribute('position'), dst = lash.getAttribute('position');
          for (let i = 0; i < src.count; i++) {
            const x = src.getX(i); if (x < 0.045) continue;
            const wave = Math.sin(x * 5.8 - t * 23) * Math.sin(clamp(t / 1.1) * Math.PI);
            dst.setY(i, src.getY(i) + wave * x * 0.48); dst.setZ(i, src.getZ(i) + wave * 0.08);
          }
          dst.needsUpdate = true; lash.computeBoundingSphere();
        } break;
      }
      case 'taser': node.position.x = -0.5 - (1 - enter) * 2 - leave * 2; node.position.y = 0.5; node.rotation.z = flutter * hit * 0.035; break;
      case 'coffee': node.position.x = 0.3 - (1 - enter) * 2 - leave * 2; node.position.y = 0.5 + Math.sin(clamp(t / 0.4) * Math.PI) * 0.65 + leave * 0.7; node.rotation.z = -hit * 0.85; break;
      case 'hammer': node.position.set(-0.3 - leave * 2, 0.72 + (1 - enter) * 2 + leave, 0.35); node.rotation.z = -1.4 * (1 - smooth((t - 0.3) / 0.35)) + hit * 0.12; break;
      case 'feather': node.position.x += flutter * hit * 0.24; node.rotation.z = flutter * 0.35; node.position.y += Math.sin(t * 18) * 0.07; break;
      case 'megaphone': node.rotation.z = -hit * 0.08; node.position.x = -1 - (1 - enter) * 2 - leave * 2; node.position.y += flutter * hit * 0.025; break;
      case 'cookie': node.position.x = -2 + enter * 2.28 + leave * 2; node.position.y += Math.sin(clamp(t / 0.6) * Math.PI) * 0.6; node.rotation.z = t < 0.6 ? t * 10 : flutter * 0.12; node.scale.setScalar((1 - leave) * (1 - smooth((t - 0.75) / 0.65) * 0.95)); break;
    }
    if (glyph.current) {
      const skeleton = tool === 'taser';
      glyph.current.visible = skeleton ? t > 0.4 && t < 1.2 && Math.floor(t * 22) % 2 === 0 : tool === 'whip' ? t > 0.6 && t < 0.9 : t > 0.55 && t < 1.65;
      glyph.current.position.set(tool === 'whip' ? 0.65 : tool === 'feather' ? 0.65 + Math.sin(t * 8) * 0.2 : 0, skeleton ? 0.5 : tool === 'coffee' ? 0.55 : tool === 'cookie' || tool === 'feather' ? 1 + smooth((t - 0.55) / 1.1) * 0.8 : 1.15 + hit * 0.3, 0.65);
      glyph.current.scale.setScalar(skeleton ? 1.1 : tool === 'coffee' ? 0.7 : 0.65 + hit * 0.3);
    }
    function put(mesh: THREE.InstancedMesh | null, i: number, x: number, y: number, z: number, size: number, rx = 0, ry = 0) {
      if (!mesh) return;
      matrix.position.set(x, y, z); matrix.rotation.set(rx, ry, 0); matrix.scale.setScalar(Math.max(0.001, size)); matrix.updateMatrix(); mesh.setMatrixAt(i, matrix.matrix);
    }
    for (let i = 0; rings.current && i < (tool === 'whip' ? 1 : 4); i++) {
      const p = (t * 1.8 + i / 4) % 1, live = t > (tool === 'taser' ? 1.15 : 0.45) && t < 1.75;
      const sound = tool === 'megaphone', crack = tool === 'whip', steam = tool === 'coffee';
      put(rings.current, i, sound ? -0.9 + p * 1.2 : crack ? 0.7 : Math.sin(t * 5 + i) * 0.15, sound ? 0.65 : crack ? 0.85 : (steam ? 0.9 : 0.5) + p * 1.15, 0.45, live ? (crack ? (t > 0.6 && t < 0.95 ? (t - 0.6) * 5 : 0) : 0.12 + p * 0.8) : 0, sound ? 0 : Math.PI / 2, sound ? Math.PI / 2 : 0);
    }
    for (let i = 0; particles.current && i < 8; i++) {
      const start = tool === 'taser' ? 1.15 : 0.65, p = clamp((t - start - (i % 3) * 0.04) / (1.8 - start)), a = i * 2.4 + t * 3;
      const orbit = tool === 'hammer', crumb = tool === 'cookie', soot = tool === 'taser';
      put(particles.current, i, orbit ? Math.cos(a) * 0.55 : Math.sin(i * 9) * p * 0.7, orbit ? 1.1 : crumb ? 0.5 - p * 0.8 : soot ? 0.45 + p : 0.7 + p * 0.8, orbit ? Math.sin(a) * 0.45 : 0.5, t > start && t < 1.75 ? (1 - p) * (soot ? 2.8 : crumb ? 0.5 : 0.9) : 0);
    }
    // Regenerate two six-segment zigzags at 15 Hz, using deterministic hashes.
    for (let i = 0; arcs.current && i < 12; i++) {
      const j = i % 6, side = i < 6 ? -1 : 1, step = Math.floor(t * 15);
      const point = (k: number, v: THREE.Vector3) => v.set(-0.35 + k * 0.13, 0.5 + side * 0.09 + (k === 0 || k === 6 ? 0 : Math.sin(k * 43 + step * 17 + side) * 0.16), 0.5);
      point(j, from); point(j + 1, to); to.sub(from);
      const length = to.length();
      matrix.position.copy(from).addScaledVector(to, 0.5); matrix.quaternion.setFromUnitVectors(axis, to.normalize());
      const live = t > 0.4 && t < 1.2 && Math.floor(t * 22) % 3 !== 0;
      matrix.scale.set(live ? 0.018 : 0.001, live ? length : 0.001, 0.018); matrix.updateMatrix(); arcs.current?.setMatrixAt(i, matrix.matrix);
    }
    for (const mesh of [rings.current, particles.current, arcs.current]) if (mesh) { mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); }
  });
  const marks = tool === 'taser' ? 'skeleton' : tool === 'whip' ? '✦ ━' : tool === 'coffee' ? '✦ ✦' : tool === 'hammer' ? '★ ★' : tool === 'feather' ? i18n.t('worldUi.toys.bubbles.feather') : tool === 'cookie' ? '♥ ♥' : '';
  return <group>
    <mesh dispose={null} ref={model} geometry={lash ?? toyModels[tool]} material={toyInk} raycast={ignore} />
    {!low && <>
      {marks && <group ref={glyph}><Stamp mark={marks} color={tool === 'taser' || tool === 'whip' ? '#FFFFFF' : tool === 'coffee' || tool === 'hammer' ? '#FFD56A' : '#F58FB0'} /></group>}
      {(tool === 'taser' || tool === 'coffee' || tool === 'whip' || tool === 'megaphone') && <instancedMesh dispose={null} ref={rings} args={[ring, ink(tool === 'megaphone' ? '#FFD56A' : '#D5EBF2'), tool === 'whip' ? 1 : 4]} raycast={ignore} />}
      {tool !== 'coffee' && tool !== 'whip' && <instancedMesh dispose={null} ref={particles} args={[tool === 'hammer' ? star : tool === 'megaphone' ? drop : puff, ink(tool === 'taser' ? '#697384' : tool === 'cookie' ? '#C58D55' : tool === 'megaphone' ? '#78CCEE' : '#FFD56A'), 8]} raycast={ignore} />}
      {tool === 'taser' && <instancedMesh dispose={null} ref={arcs} args={[arcSegment, ink('#B9F4FF'), 12]} raycast={ignore} />}
      {tool === 'feather' && <mesh dispose={null} geometry={cheeks} material={toyInk} position={[0, 0.4, 0.5]} raycast={ignore} />}
    </>}
  </group>;
}
const star = new THREE.OctahedronGeometry(0.09, 0);
const drop = new THREE.SphereGeometry(0.06, 6, 4).scale(0.65, 1.6, 0.65);
const arcSegment = new THREE.BoxGeometry(1, 1, 1);
const cheeks = colouredGeometry([-1, 1].map(side => ({ shape: 'sphere' as const, color: '#F58FB0', at: [side * 0.3, 0, 0] as const, size: [0.16, 0.09, 0.035] as const })));
