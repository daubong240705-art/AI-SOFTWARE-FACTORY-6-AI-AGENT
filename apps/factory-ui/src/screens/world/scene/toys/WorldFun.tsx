import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useT } from '@/i18n';
import { ownerDesk } from '../../layout/zones';
import { useWorldMotion } from '../Ticker';
import { colouredGeometry } from '../props/geometry';
import { Bubble } from './visuals';
const ignore = () => {};
const material = new THREE.MeshBasicMaterial({ vertexColors: true });
const crown = colouredGeometry([
  { color: '#FFD56A', at: [0, 0, 0], size: [0.48, 0.12, 0.35] },
  ...[-1, 0, 1].map(x => ({ shape: 'cone' as const, color: '#FFD56A', at: [x * 0.17, 0.15, 0] as const, size: [0.16, 0.27, 0.22] as const })),
]);
const cone = new THREE.ConeGeometry(0.85, 4, 12, 1, true);
const glow = new THREE.MeshBasicMaterial({ color: '#FFD56A', opacity: 0.1, transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });
export function Employee({ low }: { low: boolean }) {
  return <group>
    <mesh dispose={null} geometry={crown} material={material} position={[0, 1.7, 0]} rotation={[0, Math.PI / 4, 0]} raycast={ignore} />
    {!low && <mesh dispose={null} geometry={cone} material={glow} position={[0, 2, 0]} raycast={ignore} />}
  </group>;
}
const bell = colouredGeometry([
  { shape: 'cone', color: '#E7AE24', at: [0, 0, 0], size: [0.32, 0.25, 0.32] },
  { shape: 'sphere', color: '#4A3B2F', at: [0, -0.13, 0], size: [0.1, 0.1, 0.1] },
]);
export function NeedsBell({ attention, still, off }: { attention: number; still: boolean; off: boolean }) {
  const previous = useRef(attention); const [started, setStarted] = useState(0); const node = useRef<THREE.Mesh>(null), bubble = useRef<THREE.Group>(null);
  const motion = useWorldMotion(), t = useT();
  useEffect(() => { if (attention > previous.current && !off && !still) setStarted(Date.now()); previous.current = attention; }, [attention, off, still]);
  useEffect(() => {
    if (!started || off || still) { setStarted(0); return; }
    const stop = motion.request('live'), timer = setTimeout(() => setStarted(0), 1800);
    return () => { stop(); clearTimeout(timer); };
  }, [started, off, still, motion]);
  useFrame(() => { const moving = !!started && !still && !off, age = (Date.now() - started) / 1000; if (node.current) node.current.rotation.z = moving ? Math.sin(age * 25) * 0.3 : 0; if (bubble.current) bubble.current.position.y = moving ? -1.2 + age * 0.3 : -1.2; });
  if (off) return null;
  return <group position={[ownerDesk.position[0] - 0.55, 1.1, ownerDesk.position[1] + 0.3]}>
    <mesh dispose={null} ref={node} geometry={bell} material={material} raycast={ignore} />
    {!!started && !still && <group ref={bubble} position={[0, -1.2, 0]}><Bubble text={t('worldUi.toys.needsYou')} /></group>}
  </group>;
}
const rocket = colouredGeometry([
  { color: '#FFF8E7', at: [0, 0, 0], size: [0.2, 0.6, 0.2] },
  { shape: 'cone', color: '#F58FB0', at: [0, 0.42, 0], size: [0.24, 0.28, 0.24] },
  { color: '#AFCFE6', at: [0, -0.2, 0], size: [0.5, 0.12, 0.12] },
  { shape: 'cone', color: '#FFD56A', at: [0, -0.48, 0], size: [0.17, 0.4, 0.17] },
]);
export function Rocket({ started, low }: { started: number; low: boolean }) {
  const node = useRef<THREE.Mesh>(null), motion = useWorldMotion();
  useEffect(() => { const stop = motion.request('live'); return stop; }, [motion]);
  useFrame(() => { if (!node.current) return; const t = Math.max(0, (performance.now() - started) / 1000); node.current.position.set(t * 0.4, 0.5 + t * t * (low ? 3 : 5), 0); node.current.rotation.z = -t * 0.1; });
  return <mesh dispose={null} ref={node} geometry={rocket} material={material} raycast={ignore} />;
}
const gong = colouredGeometry([
  { color: '#79593D', at: [-0.55, 0.85, 0], size: [0.07, 1.7, 0.07] },
  { color: '#79593D', at: [0.55, 0.85, 0], size: [0.07, 1.7, 0.07] },
  { color: '#79593D', at: [0, 1.65, 0], size: [1.2, 0.07, 0.07] },
  { shape: 'sphere', color: '#E7AE24', at: [0, 1, 0], size: [0.9, 0.9, 0.09] },
]);
const mallet = colouredGeometry([
  { color: '#79593D', at: [0, 0, 0], size: [0.035, 0.4, 0.035] },
  { shape: 'sphere', color: '#FFF8E7', at: [0, 0.2, 0], size: [0.16, 0.16, 0.16] },
]);
export function Gong({ struck }: { struck: number }) {
  const node = useRef<THREE.Mesh>(null), stick = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => { const t = clock.elapsedTime - struck, ringing = struck > 0 && t >= 0 && t < 0.8; if (node.current) node.current.rotation.y = ringing ? Math.sin(t * 45) * 0.04 * (1 - t / 0.8) : 0; if (stick.current) stick.current.rotation.x = ringing ? -Math.sin(t / 0.8 * Math.PI) * 1.2 : 0; });
  return <group position={[16, 0, -6.4]}>
    <mesh dispose={null} ref={node} geometry={gong} material={material} raycast={ignore} />
    <mesh dispose={null} ref={stick} geometry={mallet} material={material} position={[0.15, 0.75, 0.3]} raycast={ignore} />
  </group>;
}

const clapHand = colouredGeometry([
  { shape: 'sphere', color: '#FFF0CD', at: [0, 0, 0], size: [0.18, 0.22, 0.1] },
  { shape: 'sphere', color: '#FFD7AA', at: [0.075, -0.04, 0], size: [0.08, 0.1, 0.1] },
]);
/** Two shared mitten meshes make the rare cat audience visibly clap. */
export function CatClap() {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!group.current) return;
    const beat = (1 + Math.sin(Date.now() / 90)) / 2;
    for (let i = 0; i < 2; i++) {
      const hand = group.current.children[i]!;
      hand.position.set((i ? 1 : -1) * (0.07 + beat * 0.25), 0.55, 0.61);
      hand.rotation.z = (i ? -1 : 1) * (0.15 + beat * 0.55);
    }
  });
  return <group ref={group} rotation={[0, Math.PI / 4, 0]}>{[0, 1].map(i => <mesh dispose={null} key={i} geometry={clapHand} material={material} raycast={ignore} />)}</group>;
}
