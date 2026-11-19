import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useT } from '@/i18n';
import { createScreenTexture, type ScreenTexture } from '../screenTexture';
import { useWorldMotion } from '../Ticker';
import { colouredGeometry } from '../props/geometry';
import { toys, type ToyEffect } from './store';
import { detailedToys, lightToys, toyInk, toyGlowInk, toyOutlineInk, clamp, smooth, actionAge, createWhipMaterials } from './models';
import { Burst, Lightning } from './particles';
const ignore = () => {};

/** Text remains in the scene, including the only feedback allowed in still mode. */
export function Bubble({ text, position = [0, 2.35, 0], width = 2 }: { text: string; position?: [number, number, number]; width?: number }) {
  const invalidate = useThree(s => s.invalidate);
  const [screen, setScreen] = useState<ScreenTexture | null>(null);
  useEffect(() => { const value = createScreenTexture(512, 128, invalidate); setScreen(value); return value.dispose; }, [invalidate]);
  useEffect(() => {
    if (!screen) return;
    screen.draw(ctx => {
      ctx.fillStyle = '#FFF8E7'; ctx.beginPath(); ctx.roundRect(4, 4, 504, 120, 32); ctx.fill();
      ctx.fillStyle = '#593F42'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '700 40px sans-serif'; ctx.fillText(text, 256, 66, 470);
    });
    return screen.cancel;
  }, [screen, text]);
  return screen && <sprite position={position} scale={[width, 0.46, 1]} raycast={ignore}><spriteMaterial ref={material => { if (material) screen.attach(material); }} map={screen.texture} transparent depthWrite={false} /></sprite>;
}
const cloud = colouredGeometry(Array.from({ length: 5 }, (_, i) => ({ shape: 'sphere' as const, color: i % 2 ? '#737283' : '#918B9F', at: [(i - 2) * 0.17, i % 2 * 0.08, 0] as const, size: [0.38, 0.28, 0.3] as const })));
const cloudInk = toyInk;

export function ToyWorker({ effect, still, low, children }: { effect: ToyEffect | undefined; still: boolean; low: boolean; children: ReactNode }) {
  const t = useT(), motion = useWorldMotion();
  const [phase, setPhase] = useState(0);
  const quiet = still || !!effect?.quiet;
  useEffect(() => {
    setPhase(effect ? 1 : 0);
    if (!effect) return;
    const expiry = setTimeout(() => toys.refresh(), Math.max(1, effect.until - Date.now()));
    const end = setTimeout(() => setPhase(2), Math.max(1, effect.started + 3050 - Date.now()));
    const stop = quiet ? undefined : motion.request('live');
    const liveUntil = effect.sulkUntil || effect.started + (effect.tool === 'taser' ? 6200 : 3050);
    const rest = setTimeout(() => stop?.(), Math.max(1, liveUntil - Date.now()));
    return () => { clearTimeout(expiry); clearTimeout(end); clearTimeout(rest); stop?.(); };
  }, [effect, quiet, motion]);
  return <group>
    {children}
    {effect && phase === 1 && <Bubble text={t(effect.sulkUntil ? 'worldUi.toys.sulking' : `worldUi.toys.bubbles.${effect.tool}`)} />}
    {effect && phase === 1 && effect.combo > 1 && <Bubble text={t('worldUi.toys.combo').replace('{count}', String(effect.combo))} position={[0, 2.85, 0.05]} width={1.65} />}
    {effect && !quiet && <>
      {phase === 1 && <ToyAnimation key={`${effect.started}:${effect.tool}`} effect={effect} low={low} />}
      {effect.sulkUntil > Date.now() && <group position={[0, 0.15, 0]}><mesh dispose={null} geometry={cloud} material={cloudInk} position={[0, 1.85, 0]} raycast={ignore} /><Burst started={effect.started} kind="storm" low={low} loop /></group>}
    </>}
  </group>;
}
/** W-18 anticipation, impact and follow-through, shared by world toys and the walk hand. */
export function animateToyTool(root: THREE.Group, tool: ToyEffect['tool'], started: number, combo = 1) {
  const raw = (Date.now() - started) / 1000;
  const t = tool === 'whip' || tool === 'hammer' ? actionAge(started) : raw;
  // Anticipation 0–0.55, impact 0.68, readable follow-through to 2.35, exit to 3.0.
  const enter = smooth(t / 0.4), leave = smooth((t - 2.35) / 0.58);
  const hit = smooth((t - 0.5) / 0.16) * (1 - smooth((t - 0.85) / 0.55));
  root.position.set(-0.65 - (1 - enter) * 1.4 - leave * 0.5, 0.85 + Math.sin(clamp(t / 0.52) * Math.PI) * 0.45, 1.25);
  root.scale.setScalar((1 - leave * 0.25) * (1 + hit * Math.min(0.3, (combo - 1) * 0.06)));
  root.rotation.set(0, 0, 0);
  switch (tool) {
    case 'whip': root.position.x = -0.95; root.position.y = 0.9; root.rotation.z = -Math.sin(smooth(t / 0.68) * Math.PI) * 1.25 + Math.sin(t * 12) * hit * 0.17; break;
    case 'taser': root.position.x = -0.8 - (1 - enter) * 1.4; root.rotation.z = Math.sin(t * 32) * hit * 0.045; break;
    case 'coffee': root.position.x = 0.15 - (1 - enter) * 1.5; root.rotation.z = -hit * 0.6; root.rotation.x = 0.18; break;
    case 'hammer': root.position.set(-0.35, 1 + (1 - enter) * 1.3 + leave * 0.35, 1.1); root.rotation.z = -1.5 * (1 - smooth((t - 0.2) / 0.48)) + Math.sin(t * 9) * hit * 0.1; break;
    case 'feather': root.position.x += Math.sin(t * 22) * hit * 0.28; root.rotation.z = Math.sin(t * 17) * 0.28; break;
    case 'megaphone': root.position.x = -0.85 - (1 - enter) * 1.3; root.rotation.z = -hit * 0.09; break;
    case 'cookie': root.position.x = -1.8 + enter * 1.95; root.position.y += Math.sin(clamp(t / 0.7) * Math.PI) * 0.4; root.rotation.z = t < 0.7 ? t * 9 : Math.sin(t * 18) * 0.1; break;
  }
  return t;
}

function ToyAnimation({ effect, low }: { effect: ToyEffect; low: boolean }) {
  const model = useRef<THREE.Group>(null), facing = useRef<THREE.Group>(null);
  const scratch = useMemo(() => ({ rotation: new THREE.Quaternion(), iso: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4) }), []);
  const assets = (low ? lightToys : detailedToys)[effect.tool];
  const leather = useMemo(() => effect.tool === 'whip' ? createWhipMaterials() : null, [effect.tool]);
  useEffect(() => () => { leather?.solid.dispose(); leather?.outline.dispose(); }, [leather]);
  useFrame(() => {
    const root = model.current; if (!root) return;
    if (facing.current?.parent) {
      facing.current.parent.getWorldQuaternion(scratch.rotation);
      facing.current.quaternion.copy(scratch.rotation.invert()).multiply(scratch.iso);
    }
    const t = animateToyTool(root, effect.tool, effect.started, effect.combo);
    if (leather) leather.clock.value = t;
  });
  return <group ref={facing} rotation={[0, Math.PI / 4, 0]} position={[0.35, 0, 0.35]}>
    <group ref={model}>
      <mesh dispose={null} geometry={assets.solid} material={leather?.solid ?? toyInk} frustumCulled={false} raycast={ignore} />
      {!low && <mesh dispose={null} geometry={assets.hull} material={leather?.outline ?? toyOutlineInk} frustumCulled={false} raycast={ignore} />}
      {assets.glow && <mesh dispose={null} geometry={assets.glow} material={toyGlowInk} raycast={ignore} />}
    </group>
    <group position={[0, 0, 0.55]}>
      <Burst started={effect.started} kind={effect.cheered ? 'hearts' : effect.tool} low={low} power={1 + Math.min(5, effect.combo - 1) * 0.15} />
      {effect.tool === 'taser' && <Lightning started={effect.started} />}
    </group>
  </group>;
}
