import { useEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldModel } from '../../data/types';
import { colouredGeometry, type Piece } from '../props/geometry';
import { daylight } from '../props/state';
import { coverFor, type CoverResource } from '../gallery/coverTexture';
import { thumbnailUrl } from '../gallery/thumbnailUrl';
import { createScreenTexture, type ScreenTexture } from '../screenTexture';
import { walkSceneryParts } from './sceneryModel';

const ignore = () => {};
function Shell({ low }: { low: boolean }) {
  const invalidate = useThree(s => s.invalidate);
  const [resource, setResource] = useState<THREE.Group | null>(null);
  useEffect(() => {
    const group = new THREE.Group(); group.name = 'walk-eye-level-shell';
    const parts = walkSceneryParts(), geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [];
    const add = (selected: typeof parts, material: THREE.Material, baked = false) => {
      const geometry = colouredGeometry(selected.map(p => ({ color: p.color, at: p.position, size: p.scale, yaw: p.yaw } satisfies Piece)));
      if (baked) {
        const colors = geometry.getAttribute('color'), normals = geometry.getAttribute('normal');
        for (let i = 0; i < colors.count; i++) { const shade = 0.83 + normals.getY(i) * 0.13; colors.setXYZ(i, colors.getX(i) * shade, colors.getY(i) * shade, colors.getZ(i) * shade); }
      }
      geometries.push(geometry); materials.push(material); group.add(new THREE.Mesh(geometry, material));
    };
    const glow = (p: typeof parts[number]) => p.color === '#FFF5D4';
    add(parts.filter(p => p.shape !== 'glass' && !glow(p)), low ? new THREE.MeshBasicMaterial({ vertexColors: true }) : new THREE.MeshLambertMaterial({ vertexColors: true }), low);
    const panes = new THREE.MeshBasicMaterial({ color: '#AFCFE6', transparent: true, opacity: 0.38, depthWrite: false });
    add(parts.filter(p => p.shape === 'glass'), panes);
    const lights = new THREE.MeshBasicMaterial({ vertexColors: true }); add(parts.filter(glow), lights);
    const update = () => {
      const day = daylight(new Date());
      panes.color.set(day === 'night' ? '#47557B' : day === 'sunset' ? '#EFB58C' : '#AFCFE6');
      lights.color.set(day === 'day' ? '#EFE6D5' : '#FFF2C7'); invalidate();
    };
    update(); const timer = setInterval(update, 60000);
    group.traverse(o => { o.raycast = ignore; });
    setResource(group);
    return () => { clearInterval(timer); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); };
  }, [low, invalidate]);
  return resource ? <primitive object={resource} /> : null;
}
function WorkflowBoard({ model }: { model: WorldModel }) {
  const invalidate = useThree(s => s.invalidate), [screen, setScreen] = useState<ScreenTexture | null>(null);
  useEffect(() => { const value = createScreenTexture(1024, 512, invalidate); setScreen(value); return value.dispose; }, [invalidate]);
  useEffect(() => {
    screen?.draw(ctx => {
      ctx.fillStyle = '#FFFDF3'; ctx.fillRect(0, 0, 1024, 512);
      ctx.fillStyle = '#34404B'; ctx.font = '600 40px sans-serif'; ctx.fillText('FACTORY / WORKFLOW', 36, 62);
      const names: Record<string, string> = { design: 'Design', rules: 'Rules', art: 'Art', client: 'Client', qa: 'QA' };
      if (!model.stages.length) { ctx.font = '28px sans-serif'; ctx.fillText('—', 36, 160); }
      model.stages.forEach((stage, i) => {
        const column = Math.floor(i / 6), row = i % 6, columns = Math.ceil(model.stages.length / 6), width = 950 / columns;
        ctx.fillStyle = stage.state === 'active' ? '#C65742' : '#527C86'; ctx.font = '28px sans-serif';
        ctx.fillText(`${i + 1}. ${names[stage.key] ?? stage.key} · ${stage.state}`, 36 + column * width, 128 + row * 59, width - 18);
      });
    });
  }, [model.stages, screen]);
  return <group position={[5, 2, 13.78]} rotation={[0, Math.PI, 0]}>
    <mesh raycast={ignore}><boxGeometry args={[3.5, 1.85, 0.12]} /><meshToonMaterial color="#A87A50" /></mesh>
    {screen && <mesh position={[0, 0, 0.071]} raycast={ignore}><planeGeometry args={[3.35, 1.7]} /><meshBasicMaterial ref={m => { if (m) screen.attach(m); }} map={screen.texture} /></mesh>}
    <mesh position={[0, -0.94, 0.15]} raycast={ignore}><boxGeometry args={[3.4, 0.05, 0.2]} /><meshToonMaterial color="#81929C" /></mesh>
  </group>;
}
function ReleasePosters({ items }: { items: WorldModel['gallery'] }) {
  const invalidate = useThree(s => s.invalidate), [resource, setResource] = useState<THREE.Group | null>(null);
  useEffect(() => {
    const group = new THREE.Group(), cache = new Map<string, CoverResource>(), geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [];
    items.filter(item => item.state === 'done').slice(0, 3).forEach((item, i) => {
      const cover = coverFor(cache, item, thumbnailUrl(item.projectId, item.releaseId), invalidate, i);
      const frame = new THREE.BoxGeometry(2.5, 1.95, 0.12), paper = new THREE.PlaneGeometry(2.32, 1.74);
      const wood = new THREE.MeshLambertMaterial({ color: '#A87A50' }), ink = new THREE.MeshBasicMaterial({ map: cover.texture }); cover.screen.attach(ink);
      geometries.push(frame, paper); materials.push(wood, ink);
      const poster = new THREE.Group(); poster.position.set(-3.5 + i * 3, 2, 13.78); poster.rotation.y = Math.PI;
      poster.add(new THREE.Mesh(frame, wood)); const face = new THREE.Mesh(paper, ink); face.position.z = 0.071; poster.add(face); group.add(poster);
    });
    group.traverse(o => { o.raycast = ignore; }); setResource(group); invalidate();
    return () => { cache.forEach(c => c.dispose()); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); };
  }, [items, invalidate]);
  return resource ? <primitive object={resource} /> : null;
}
/** Unmounted in iso: no roof, front walls or extra furnishings in the dollhouse view. */
export function WalkScenery({ model, quality }: { model: WorldModel; quality: 'high' | 'low' }) {
  return <><Shell low={quality === 'low'} /><WorkflowBoard model={model} /><ReleasePosters items={model.gallery} /></>;
}
export function WalkLighting({ quality }: { quality: 'high' | 'low' }) {
  const [day, setDay] = useState(() => daylight(new Date()));
  const invalidate = useThree(s => s.invalidate);
  useEffect(() => { const timer = setInterval(() => { setDay(daylight(new Date())); invalidate(); }, 60000); return () => clearInterval(timer); }, [invalidate]);
  const night = day === 'night', low = quality === 'low';
  return <>
    <hemisphereLight color={night ? '#B5C4E2' : '#FFF6E0'} groundColor="#C9B38E" intensity={low ? 1.5 : night ? 0.85 : 1.1} />
    <ambientLight color="#FFE7BF" intensity={low ? 0.4 : 0.3} />
    <directionalLight color={night ? '#AFCFE6' : day === 'sunset' ? '#FFD0A0' : '#FFF6E0'} position={[-15, 9, -15]} intensity={night ? 0.2 : 0.65} />
    {!low && [[-12, -8], [0, 5], [12, 5], [0, -8]].map(([x, z], i) => <pointLight key={i} color="#FFE3B0" position={[x!, 2.95, z!]} intensity={night ? 11 : 6} distance={18} decay={2} />)}
  </>;
}
