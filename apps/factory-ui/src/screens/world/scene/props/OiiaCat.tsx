import { useCallback, useEffect, useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useT } from '@/i18n';
import { oiiaSpot } from '../../layout/zones';
import { useWorldMotion } from '../Ticker';
import { toys } from '../toys/store';
import { tone } from '../toys/sound';
import { Bubble } from '../toys/visuals';
import { Burst } from '../toys/particles';
import { smooth, toyInk, toyOutlineInk } from '../toys/models';
import { colouredGeometry } from './geometry';
const ignore = () => {};
export const oiiaModel = colouredGeometry([
  { shape: 'sphere', color: '#CDD2D8', at: [0, 0.37, 0], size: [0.5, 0.66, 0.43] },
  { shape: 'sphere', color: '#FFF8F1', at: [0, 0.68, 0.04], size: [0.54, 0.45, 0.44] },
  ...[-1, 1].flatMap(side => [
    { shape: 'cone' as const, color: '#BCC3CE', at: [side * 0.2, 0.93, 0] as const, size: [0.26, 0.37, 0.2] as const },
    { shape: 'cone' as const, color: '#F4B4C6', at: [side * 0.2, 0.94, 0.075] as const, size: [0.14, 0.24, 0.045] as const },
    { shape: 'sphere' as const, color: '#34404B', at: [side * 0.11, 0.72, 0.25] as const, size: [0.055, 0.085, 0.025] as const },
    { shape: 'sphere' as const, color: '#FFF8F1', at: [side * 0.19, 0.12, 0.15] as const, size: [0.2, 0.16, 0.25] as const },
  ]),
  { shape: 'sphere', color: '#F4B4C6', at: [0, 0.62, 0.264], size: [0.07, 0.05, 0.03] },
  { color: '#34404B', at: [0, 0.58, 0.253], size: [0.09, 0.018, 0.018] },
  { shape: 'sphere', color: '#BCC3CE', at: [0.25, 0.2, -0.18], size: [0.5, 0.13, 0.16] },
  { color: '#A07ADD', at: [0, 0.475, 0.16], size: [0.42, 0.055, 0.16] },
  { shape: 'sphere', color: '#FFDA71', at: [0, 0.46, 0.27], size: [0.1, 0.12, 0.045] },
  ...[-1, 1].flatMap(side => Array.from({ length: 3 }, (_, i) => ({ color: '#6F7C8D', at: [side * (0.24 + i * 0.05), 0.63 - i * 0.055, 0.21] as const, size: [0.18, 0.014, 0.012] as const, roll: side * (i - 1) * 0.2 }))),
  ...[-1, 0, 1].map(i => ({ color: '#8792A4', at: [i * 0.095, 0.845 - Math.abs(i) * 0.025, 0.19] as const, size: [0.045, 0.11, 0.018] as const, roll: i * 0.18 })),
]);
const rug = new THREE.CylinderGeometry(0.5, 0.5, 0.065, 20);
const rugInk = new THREE.MeshBasicMaterial({ color: '#C8B2E5' });
const blur = new THREE.TorusGeometry(0.47, 0.015, 3, 24, Math.PI * 1.5);
const blurInk = new THREE.MeshBasicMaterial({ color: '#E8E8FC', transparent: true, opacity: 0.5, depthWrite: false });
const catHull = oiiaModel.clone();
const hp = catHull.getAttribute('position'), hn = catHull.getAttribute('normal');
for (let i = 0; i < hp.count; i++) hp.setXYZ(i, hp.getX(i) + hn.getX(i) * 0.009, hp.getY(i) + hn.getY(i) * 0.009, hp.getZ(i) + hn.getZ(i) * 0.009);
const trailInks = [0.08, 0.13, 0.2].map(opacity => new THREE.MeshBasicMaterial({ color: '#C4B3E8', transparent: true, opacity, depthWrite: false }));
/** Four-second spin: 0–3 acceleration, 3–3.6 brake, 3.6–4 bow. */
export function sampleOiia(t: number, result = { yaw: 0, tilt: 0, bow: 0 }) {
  const a = Math.max(0, Math.min(t, 3)), c = Math.max(0, Math.min(t - 3, 0.6));
  // Continuous angular velocity; total angle is exactly 16 turns, so the face returns home.
  const speed = Math.PI * 32 / 1.8;
  const yaw = speed * (a * a / 6 + c - c * c / 1.2);
  const bow = t > 3.6 && t < 4 ? Math.sin((t - 3.6) / 0.4 * Math.PI) * 0.3 : 0;
  result.yaw = yaw; result.tilt = t < 3.6 ? Math.sin(t * 12) * 0.09 * Math.sin(Math.min(1, t / 3.6) * Math.PI) : 0; result.bow = bow; return result;
}
export function OiiaCat({ still, off, low }: { still: boolean; off: boolean; low: boolean }) {
  const t = useT(), motion = useWorldMotion();
  const cat = useRef<THREE.Group>(null), trails = useRef<THREE.Group>(null), rings = useRef<THREE.Group>(null), letters = useRef<THREE.Group>(null);
  const [started, setStarted] = useState(0), [bubble, setBubble] = useState(0), [mega, setMega] = useState(false);
  const lastClick = useRef(0), sample = useRef({ yaw: 0, tilt: 0, bow: 0 });
  const down = useRef<[number, number] | null>(null);
  const spin = useCallback((gesture = false, megaSpin = false) => {
    if (off) return;
    if (still) { setBubble(n => n + 1); return; }
    const now = Date.now(); setStarted(now); setMega(megaSpin); toys.spin(megaSpin, Math.random() < 0.12, now);
    if (toys.snapshot().sound) tone(megaSpin ? 'mega' : 'oiia');
    if (gesture) setBubble(n => n + 1);
  }, [off, still]);
  useEffect(() => {
    if (off || still) { setStarted(0); return; }
    const timer = setTimeout(() => spin(), 45000 + Math.random() * 45000);
    return () => clearTimeout(timer);
  }, [off, still, started, spin]);
  useEffect(() => {
    if (!started || still || off) return;
    const stop = motion.request('live'), timer = setTimeout(() => { setStarted(0); setMega(false); }, Math.max(1, started + (mega ? 5500 : 4000) - Date.now()));
    return () => { stop(); clearTimeout(timer); };
  }, [started, mega, still, off, motion]);
  useEffect(() => { if (!still && !off && !started) return motion.request('ambient'); }, [still, off, started, motion]);
  useEffect(() => { if (!bubble) return; const timer = setTimeout(() => setBubble(0), 1800); return () => clearTimeout(timer); }, [bubble]);
  useFrame(() => {
    if (!cat.current) return;
    const moving = !still && !off, age = (Date.now() - started) / 1000, spinning = moving && started > 0 && age < (mega ? 5.5 : 4);
    const p = sampleOiia(spinning ? (mega ? Math.min(4, age * 4 / 5.5) : age) : 0, sample.current);
    cat.current.rotation.set(p.bow, p.yaw * (mega ? 2 : 1) + Math.PI / 4, p.tilt);
    cat.current.position.y = 0.035 + (moving ? Math.sin(performance.now() / 400) * 0.018 : 0);
    const normalized = mega ? age * 4 / 5.5 : age;
    const speed = spinning ? Math.max(0, normalized < 3 ? normalized / 3 : (3.6 - normalized) / 0.6) : 0;
    cat.current.scale.set(1 + speed * 0.14, 1 - speed * (mega ? 0.3 : 0.22), 1 + speed * 0.14);
    if (trails.current) {
      trails.current.visible = spinning && speed > 0.2;
      for (let i = 0; i < trails.current.children.length; i++) {
        const ghost = trails.current.children[i]!;
        ghost.rotation.y = cat.current.rotation.y - (i + 1) * (0.3 + speed * 0.35);
        ghost.scale.copy(cat.current.scale); ghost.position.set(Math.cos(p.yaw + i) * speed * 0.055, cat.current.position.y, Math.sin(p.yaw + i) * speed * 0.055);
      }
    }
    if (rings.current) { rings.current.visible = !!spinning && age > 0.35; rings.current.rotation.y = p.yaw * 0.6; rings.current.scale.setScalar(1 + Math.min(1, age / 3) * .4); }
    if (letters.current) {
      letters.current.visible = !!spinning && age > 0.2;
      for (let i = 0; i < letters.current.children.length; i++) {
        const letter = letters.current.children[i]!, a = p.yaw * .15 + i * Math.PI / 2;
        const pop = smooth((age - .2 - i * .12) / .2), beat = Math.abs(Math.sin(p.yaw * .5 - i * Math.PI / 2));
        letter.position.set(Math.cos(a) * .85, 1.25 + beat * .32, Math.sin(a) * .85); letter.scale.setScalar(pop * (1 + beat * .25));
      }
    }
  });
  const up = (event: ThreeEvent<PointerEvent>) => {
    const start = down.current; down.current = null; event.stopPropagation();
    if (start && event.delta <= 4 && Math.hypot(event.clientX - start[0], event.clientY - start[1]) <= 4) { const now = Date.now(); const double = now - lastClick.current < 360; lastClick.current = now; spin(true, double); }
  };
  return <group name="oiia-cat" position={[oiiaSpot[0], 0, oiiaSpot[1]]}>
    <mesh dispose={null} geometry={rug} material={rugInk} position={[0, 0.033, 0]} onPointerDown={e => { e.stopPropagation(); down.current = [e.clientX, e.clientY]; }} onPointerUp={up} />
    <group ref={cat} position={[0, 0.035, 0]} onPointerDown={e => { e.stopPropagation(); down.current = [e.clientX, e.clientY]; }} onPointerUp={up}>
      <mesh dispose={null} geometry={oiiaModel} material={toyInk} />
      {!low && <mesh dispose={null} geometry={catHull} material={toyOutlineInk} raycast={ignore} />}
    </group>
    {!low && <group ref={trails} visible={false}>{trailInks.map((material, i) => <mesh dispose={null} key={i} geometry={oiiaModel} material={material} raycast={ignore} />)}</group>}
    {!low && <group ref={rings} visible={false}>{[0.3, 0.6].map(y => <mesh dispose={null} key={y} geometry={blur} material={blurInk} position={[0, y, 0]} rotation={[Math.PI / 2, 0, y * 4]} raycast={ignore} />)}</group>}
    {!low && <group ref={letters} visible={false}>{['U', 'I', 'I', 'A'].map((letter, i) => <group key={i}><Bubble text={letter} position={[0, 0, 0]} width={0.4} /></group>)}</group>}
    {!still && !off && started > 0 && <>
      {!low && <Burst started={started} kind="disco" low={false} loop />}
      {mega && <Burst started={started} kind="confetti" low={low} />}
    </>}
    {(bubble > 0 || started > 0 && low) && <Bubble text={t(mega ? 'worldUi.toys.megaSpin' : 'worldUi.toys.oiia')} position={[0, 1.55, 0]} width={1.1} />}
  </group>;
}
