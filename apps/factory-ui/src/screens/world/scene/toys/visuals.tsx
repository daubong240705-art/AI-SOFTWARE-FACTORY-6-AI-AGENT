import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useT } from '@/i18n';
import { createScreenTexture, type ScreenTexture } from '../screenTexture';
import { useWorldMotion } from '../Ticker';
import { colouredGeometry } from '../props/geometry';
import { toys, type ToyEffect } from './store';
import { detailedToys, lightToys, toyInk, toyGlowInk, toyOutlineInk, actionAge, createWhipMaterials } from './models';
import { placeToy, placementScratch } from './placement';
import { furnitureFootprints } from '../../layout/zones';
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
  const anchor = useRef<THREE.Group>(null), rig = useRef<THREE.Object3D | null>(null);
  useLayoutEffect(() => { anchor.current?.traverse(node => { if (node.name.startsWith('mochi-')) rig.current = node; }); });
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
  return <group ref={anchor}>
    {children}
    {effect && phase === 1 && <Bubble text={t(effect.sulkUntil ? 'worldUi.toys.sulking' : `worldUi.toys.bubbles.${effect.tool}`)} />}
    {effect && phase === 1 && effect.combo > 1 && <Bubble text={t('worldUi.toys.combo').replace('{count}', String(effect.combo))} position={[0, 2.85, 0.05]} width={1.65} />}
    {effect && !quiet && <>
      {phase === 1 && <ToyAnimation key={`${effect.started}:${effect.tool}`} effect={effect} low={low} rig={rig} />}
      {effect.sulkUntil > Date.now() && <group position={[0, 0.15, 0]}><mesh dispose={null} geometry={cloud} material={cloudInk} position={[0, 1.85, 0]} raycast={ignore} /><Burst started={effect.started} kind="storm" low={low} loop /></group>}
    </>}
  </group>;
}
function ToyAnimation({ effect, low, rig }: { effect: ToyEffect; low: boolean; rig: { current: THREE.Object3D | null } }) {
  const model = useRef<THREE.Group>(null), facing = useRef<THREE.Group>(null), impact = useRef<THREE.Group>(null);
  const scratch = useMemo(() => ({ placement: placementScratch(), inverse: new THREE.Matrix4(), direction: new THREE.Vector3(), center: new THREE.Vector3() }), []);
  const assets = (low ? lightToys : detailedToys)[effect.tool];
  const leather = useMemo(() => effect.tool === 'whip' ? createWhipMaterials() : null, [effect.tool]);
  useEffect(() => () => { leather?.solid.dispose(); leather?.outline.dispose(); }, [leather]);
  useFrame(({ camera }) => {
    const root = model.current, parent = facing.current?.parent, character = rig.current;
    if (!root || !facing.current || !parent || !character) return;
    character.updateWorldMatrix(true, false);
    scratch.center.set(0, 0.55, 0).applyMatrix4(character.matrixWorld);
    if (camera instanceof THREE.OrthographicCamera) camera.getWorldDirection(scratch.direction);
    else scratch.direction.copy(scratch.center).sub(camera.position).normalize();
    const t = effect.tool === 'whip' || effect.tool === 'hammer' ? actionAge(effect.started) : (Date.now() - effect.started) / 1000;
    const placement = placeToy(effect.tool, character.matrixWorld, scratch.direction, t, scratch.placement, direction => {
      let clearance = 4;
      for (const item of furnitureFootprints) {
        if (item.id.endsWith('-chair')) continue;
        const dx = item.position[0] - scratch.center.x, dz = item.position[1] - scratch.center.z;
        const along = dx * direction.x + dz * direction.z;
        if (along < 0) continue;
        const across = Math.abs(dx * direction.z - dz * direction.x);
        if (across < Math.max(...item.half) + 0.3) clearance = Math.min(clearance, along);
      }
      return clearance;
    });
    parent.updateWorldMatrix(true, false);
    facing.current.matrix.copy(scratch.inverse.copy(parent.matrixWorld).invert());
    // The effect root cancels all parent transforms, then uses the world matrix
    // computed from the animated rig (hops, awareness, sulks and leisure poses).
    root.matrix.copy(placement.matrix);
    // Particle geometry predates the placement helper and has a baked
    // (0, .8, .6) origin. Cancel it so sparks start at the contact point.
    impact.current?.position.copy(placement.contact).add(scratch.center.set(0, -0.8, -0.6));
    if (leather) leather.clock.value = t;
  });
  return <group ref={facing} matrixAutoUpdate={false}>
    <group ref={model} matrixAutoUpdate={false}>
      <mesh dispose={null} geometry={assets.solid} material={leather?.solid ?? toyInk} frustumCulled={false} raycast={ignore} />
      {!low && <mesh dispose={null} geometry={assets.hull} material={leather?.outline ?? toyOutlineInk} frustumCulled={false} raycast={ignore} />}
      {assets.glow && <mesh dispose={null} geometry={assets.glow} material={toyGlowInk} raycast={ignore} />}
    </group>
    <group ref={impact}>
      <Burst started={effect.started} kind={effect.cheered ? 'hearts' : effect.tool} low={low} power={1 + Math.min(5, effect.combo - 1) * 0.15} />
      {effect.tool === 'taser' && <Lightning started={effect.started} />}
    </group>
  </group>;
}
