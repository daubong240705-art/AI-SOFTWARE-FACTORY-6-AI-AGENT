import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { i18n, useT } from '@/i18n';
import type { WorldModel } from '../data/types';
import { chairmanSurfaces } from '../layout/chairman';
import { createScreenTexture, type ScreenTexture } from './screenTexture';
import { useWorldMotion } from './Ticker';
import type { ChairmanTab } from '../panels/chairmanTabs';

function Surface({ id, text, team }: { id: string; text: string[]; team?: boolean }) {
  const layout = chairmanSurfaces.find(s => s.id === id)!;
  const invalidate = useThree(s => s.invalidate);
  const [screen, setScreen] = useState<ScreenTexture | null>(null);
  useEffect(() => { const resource = createScreenTexture(512, 256, invalidate); setScreen(resource); return () => resource.dispose(); }, [invalidate]);
  const content = text.join('\n');
  useEffect(() => {
    screen?.draw(ctx => {
      ctx.fillStyle = team ? '#E9D4AE' : '#273E48'; ctx.fillRect(0, 0, 512, 256);
      ctx.fillStyle = team ? '#4A3B2F' : '#FFF8E7'; ctx.textAlign = 'center';
      if (team) {
        ctx.font = '600 27px sans-serif'; ctx.fillText(text[0] ?? '', 256, 32, 480);
        const names = text.slice(1), cols = Math.min(8, Math.max(1, names.length)), rows = Math.max(1, Math.ceil(names.length / cols));
        names.forEach((name, i) => {
          const cell = 480 / cols, x = 16 + cell * (i % cols + .5), y = 60 + 175 / rows * (Math.floor(i / cols) + .35);
          ctx.fillStyle = ['#527C86', '#C65742', '#527C69'][i % 3]!;
          ctx.fillRect(x - 12, y + 9, 24, 14); ctx.fillStyle = '#FFF0CD'; ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#4A3B2F'; ctx.font = '14px sans-serif'; ctx.fillText(name, x, y + 38, cell - 4);
        });
      } else {
        ctx.font = `600 ${Math.min(27, Math.floor(190 / Math.max(1, text.length)))}px sans-serif`;
        text.forEach((line, i) => ctx.fillText(line, 256, 42 + i * Math.min(43, 190 / Math.max(1, text.length)), 480));
      }
    });
    return () => screen?.cancel();
  }, [screen, content, team]);
  return <group position={layout.position} rotation={[0, layout.yaw, 0]}>
    {screen && <mesh><planeGeometry args={[layout.width, layout.height]} /><meshBasicMaterial map={screen.texture} side={THREE.DoubleSide} /></mesh>}
  </group>;
}
function ObjectTarget({ tab, position, size, onOpen, children }: { tab: ChairmanTab | 'chair'; position: [number, number, number]; size: [number, number, number]; onOpen: (tab: ChairmanTab | 'chair') => void; children?: ReactNode }) {
  const down = useRef<[number, number] | null>(null);
  const select = (event: ThreeEvent<PointerEvent>) => {
    const start = down.current; down.current = null;
    if (start && Math.hypot(event.clientX - start[0], event.clientY - start[1]) < 5 && event.delta < 5) { event.stopPropagation(); onOpen(tab); }
  };
  return <group userData={{ walkTarget: { kind: 'office', id: tab, name: i18n.t(tab === 'chair' ? 'worldUi.walk.owner' : `worldUi.chairman.tabs.${tab}`) } }}>
    {children}
    <mesh position={position} onPointerDown={event => { down.current = [event.clientX, event.clientY]; }} onPointerUp={select} onPointerOut={() => { down.current = null; }}>
      <boxGeometry args={size} /><meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
    </mesh>
  </group>;
}
export function ChairmanOffice({ model, attention, approvalPulse, phonePulse, still, hidden, onOpen }: {
  model: WorldModel; attention: number; approvalPulse: number; phonePulse: number; still: boolean; hidden: boolean; onOpen: (tab: ChairmanTab | 'chair') => void;
}) {
  const t = useT(), motion = useWorldMotion();
  const papers = useRef<THREE.Group>(null), phone = useRef<THREE.Group>(null);
  const [minute, setMinute] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setMinute(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (still || hidden || !Math.max(approvalPulse, phonePulse)) return;
    const release = motion.request('live'); const timer = setTimeout(release, 4000);
    return () => { clearTimeout(timer); release(); };
  }, [approvalPulse, phonePulse, still, hidden, motion]);
  useFrame(() => {
    const now = performance.now(), flutter = !still && !hidden && now - approvalPulse < 2500 && approvalPulse > 0, ring = !still && !hidden && now - phonePulse < 4000 && phonePulse > 0;
    if (papers.current) papers.current.children.forEach((p, i) => { p.rotation.z = flutter ? Math.sin((now - approvalPulse) / 70 + i) * 0.1 : 0; });
    if (phone.current) { const material = (phone.current.children[0] as THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>).material; material.emissiveIntensity = ring ? .9 : 0; phone.current.rotation.z = ring ? Math.sin(now / 45) * 0.18 : 0; phone.current.position.y = ring ? 1.1 + Math.abs(Math.sin(now / 70)) * 0.06 : 1.1; }
  });
  const stack = Math.min(0.62, attention * 0.025);
  const seats = [...new Map(model.agents.map(a => [a.ownerSeatId, a])).values()];
  const clock = new Date(minute);
  return <group name="chairman-office" visible={!hidden}>
    <ObjectTarget tab="chair" position={[-14.8, 0.95, -11.44]} size={[0.85, 1.5, 0.85]} onOpen={onOpen} />
    <ObjectTarget tab="projects" position={[-14.9, 1.2, -10.2]} size={[1.2, 0.7, 0.6]} onOpen={onOpen} />
    <ObjectTarget tab="attention" position={[-16, 1.1 + stack / 2, -10.45]} size={[0.6, 0.4 + stack, 0.65]} onOpen={onOpen}>
      <group ref={papers} position={[-16, 0.99, -10.45]}>{attention > 0 && Array.from({ length: Math.min(attention, 12) }, (_, i) => <mesh key={i} position={[0, i * stack / Math.min(attention, 12), 0]} rotation={[0, i % 2 * 0.12, 0]}><boxGeometry args={[0.43, stack / Math.min(attention, 12), 0.5]} /><meshStandardMaterial color={i % 2 ? '#E9D4AE' : '#FFF8E7'} /></mesh>)}</group>
      <OfficeBadge count={attention} />
    </ObjectTarget>
    {chairmanSurfaces.filter(s => s.id.startsWith('office-tv')).map((s, i) => <ObjectTarget key={s.id} tab="projects" position={s.position} size={[0.22, s.height, s.width]} onOpen={onOpen}><Surface id={s.id} text={[t('global.projects'), ...(model.loaded.projects ? model.projects.filter((_, index) => index % 3 === i).map(project => project.name) : ['—'])]} /></ObjectTarget>)}
    <ObjectTarget tab="agents" position={[-16.7, 3, -13.55]} size={[1.45, 0.75, 0.2]} onOpen={onOpen}><Surface id="office-photo" team text={[`${t('projectUi.agents')} · ${seats.length}`, ...seats.map(a => a.name)]} /></ObjectTarget>
    <ObjectTarget tab="flows" position={[-14.9, 3.14, -13.55]} size={[1.65, 0.75, 0.2]} onOpen={onOpen}><Surface id="office-whiteboard" text={[t('projectUi.flows')]} /></ObjectTarget>
    <ObjectTarget tab="activity" position={[-13.64, 1.08, -10.46]} size={[0.6, 0.4, 0.4]} onOpen={onOpen}>
      <group ref={phone} position={[-13.64, 1.1, -10.46]}><mesh><boxGeometry args={[0.55, 0.12, 0.14]} /><meshStandardMaterial color="#DB4247" emissive="#DB4247" emissiveIntensity={phonePulse && performance.now() - phonePulse < 4000 ? 0.9 : 0} /></mesh></group>
    </ObjectTarget>
    <ObjectTarget tab="activity" position={[-12.9, 3, -13.55]} size={[0.6, 0.6, 0.2]} onOpen={onOpen}>
      <Surface id="office-clock" text={[clock.toLocaleTimeString(i18n.locale, { hour: '2-digit', minute: '2-digit' })]} />
    </ObjectTarget>
    <Surface id="office-door-plate" text={['Chủ tịch / Chairman']} />
  </group>;
}
function OfficeBadge({ count }: { count: number }) {
  const invalidate = useThree(s => s.invalidate), [screen, setScreen] = useState<ScreenTexture | null>(null);
  useEffect(() => { const created = createScreenTexture(128, 64, invalidate); setScreen(created); return () => created.dispose(); }, [invalidate]);
  useEffect(() => { screen?.draw(ctx => { ctx.fillStyle = '#C65742'; ctx.fillRect(0, 0, 128, 64); ctx.fillStyle = '#FFF8E7'; ctx.font = 'bold 42px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(count), 64, 47, 120); }); }, [screen, count]);
  return screen ? <sprite position={[-16, 1.9, -10.45]} scale={[0.6, 0.3, 1]}><spriteMaterial map={screen.texture} depthWrite={false} /></sprite> : null;
}
