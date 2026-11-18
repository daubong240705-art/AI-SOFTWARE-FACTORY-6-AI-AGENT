import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { i18n, useT } from '@/i18n';
import { createScreenTexture, type ScreenTexture } from '../screenTexture';
import { useWorldMotion } from '../Ticker';
import { colouredGeometry } from '../props/geometry';
import { toys, type ToyEffect } from './store';
const ignore = () => {};
const gold = new THREE.MeshBasicMaterial({ color: '#FFD56A', side: THREE.DoubleSide });
const white = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
const ring = new THREE.TorusGeometry(0.55, 0.018, 3, 16, Math.PI * 1.4);
const bolt = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.1, 0.7), new THREE.Vector2(-0.35, 0), new THREE.Vector2(0, 0), new THREE.Vector2(-0.12, -0.65), new THREE.Vector2(0.45, 0.2), new THREE.Vector2(0.12, 0.2), new THREE.Vector2(0.3, 0.7)]));
const cup = colouredGeometry([
  { shape: 'sphere', color: '#FFF8E7', at: [0, 0, 0], size: [0.3, 0.3, 0.3] },
  { color: '#755137', at: [0, 0.12, 0], size: [0.22, 0.025, 0.22] },
  { shape: 'sphere', color: '#FFF8E7', at: [0.17, 0, 0], size: [0.16, 0.2, 0.1] },
]);
const hammer = colouredGeometry([
  { color: '#A87A50', at: [0, -0.2, 0], size: [0.07, 0.6, 0.07] },
  { color: '#F58FB0', at: [0, 0.15, 0], size: [0.55, 0.23, 0.25] },
]);
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
function Stamp({ mark, color = '#F58FB0' }: { mark: string; color?: string }) {
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
export function ToyWorker({ effect, still, low, children }: { effect: ToyEffect | undefined; still: boolean; low: boolean; children: ReactNode }) {
  useT(); const root = useRef<THREE.Group>(null), prop = useRef<THREE.Group>(null), marks = useRef<THREE.Group>(null);
  const motion = useWorldMotion();
  const quiet = still || effect?.quiet;
  useEffect(() => {
    if (!effect) return;
    const timer = setTimeout(() => toys.refresh(), Math.max(1, effect.until - Date.now()));
    if (quiet) return () => clearTimeout(timer);
    const stop = motion.request('live');
    return () => { clearTimeout(timer); stop(); };
  }, [effect, quiet, motion]);
  useFrame(() => {
    const node = root.current; if (!node) return;
    node.visible = true; node.position.set(0, 0, 0); node.rotation.set(0, 0, 0); node.scale.set(1, 1, 1);
    if (!effect || quiet) return;
    const t = (Date.now() - effect.started) / 1000, p = Math.min(1, t / 1.6), pulse = Math.sin(p * Math.PI);
    if (effect.tool === 'whip' || effect.tool === 'cookie') node.position.y = Math.max(0, Math.sin(Math.min(1, t / 0.75) * Math.PI)) * 0.48;
    if (effect.tool === 'hammer') { const squash = t < 0.3 ? Math.sin(t / 0.3 * Math.PI) * 0.82 : t < 0.85 ? -Math.sin((t - 0.3) / 0.55 * Math.PI) * 0.25 : 0; node.scale.set(1 + squash * 0.6, 1 - squash, 1 + squash * 0.6); node.position.y = t > 0.3 && t < 0.85 ? Math.sin((t - 0.3) / 0.55 * Math.PI) * 0.16 : 0; }
    if (effect.tool === 'feather') node.rotation.z = Math.sin(t * 16) * pulse * 0.16;
    if (effect.tool === 'taser') { node.visible = !(t < 0.65 && Math.floor(t * 20) % 2 === 0); node.position.x = Math.sin(t * 70) * pulse * (low ? 0.015 : 0.05); node.rotation.z = Math.sin(t * 60) * pulse * 0.05; }
    if (prop.current) {
      prop.current.visible = t < 1.6;
      prop.current.position.set(effect.tool === 'coffee' ? 0.3 + Math.max(0, 1 - t / 0.6) * 1.8 : 0.1, effect.tool === 'coffee' ? 0.8 + Math.sin(p * Math.PI) * 0.35 : effect.tool === 'taser' ? 1.8 + Math.max(0, 1 - t / 0.35) * 2 : 1.8, 0.35);
      prop.current.rotation.set(0, Math.PI / 4, effect.tool === 'coffee' ? -Math.sin(p * Math.PI) * 0.8 : -p * 1.5);
    }
    if (marks.current) {
      marks.current.visible = effect.tool === 'taser' ? t < 0.65 : effect.tool === 'coffee' || t < 1.8;
      marks.current.position.set(0.15, effect.tool === 'cookie' ? 1.3 + p * 1.3 : effect.tool === 'taser' ? 0.6 : effect.tool === 'feather' ? 0.75 : 1.2, 0.55);
      marks.current.scale.setScalar(effect.tool === 'taser' ? (t < 0.65 && Math.floor(t * 20) % 2 === 0 ? 1.5 : 0.7) : 0.8 + pulse * 0.4);
    }
  });
  const tool = effect?.tool;
  const mark = tool === 'taser' ? 'skeleton' : tool === 'coffee' ? '✦ ✦' : tool === 'feather' ? '〃 〃' : tool === 'cookie' ? '♥ ♥' : tool === 'megaphone' ? ')))' : '';
  const text = tool ? i18n.t(`worldUi.toys.bubbles.${tool}`) : '';
  return <group>
    <group ref={root}>{children}</group>
    {effect && <Bubble key={`${effect.started}:${text}`} text={text} />}
    {effect && !quiet && <>
      <group ref={prop}>
        {(tool === 'whip' || tool === 'taser') && <mesh dispose={null} geometry={tool === 'whip' ? ring : bolt} material={gold} scale={tool === 'taser' ? [0.8, 1.4, 1] : 1} raycast={ignore} />}
        {(tool === 'coffee' || tool === 'hammer') && <mesh dispose={null} geometry={tool === 'coffee' ? cup : hammer} material={white} raycast={ignore} />}
        {tool === 'feather' && <Stamp mark="🪶" />}
      </group>
      {mark && <group ref={marks}><Stamp key={mark} mark={mark} color={tool === 'taser' ? '#FFF8E7' : tool === 'coffee' ? '#FFD56A' : '#F58FB0'} /></group>}
      {tool === 'taser' && !low && <Smoke started={effect.started} />}
    </>}
  </group>;
}
const puff = new THREE.IcosahedronGeometry(0.18, 0);
const smoke = new THREE.MeshBasicMaterial({ color: '#B9C5CB', transparent: true, opacity: 0.5, depthWrite: false });
function Smoke({ started }: { started: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => { if (!ref.current) return; const t = (Date.now() - started) / 1000; ref.current.position.set(0, 0.8 + t * 0.4, 0); ref.current.scale.setScalar(1 + t); ref.current.visible = t > 0.45 && t < 1.5; });
  return <mesh dispose={null} ref={ref} geometry={puff} material={smoke} raycast={ignore} />;
}
