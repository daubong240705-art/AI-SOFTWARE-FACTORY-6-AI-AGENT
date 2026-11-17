import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { anchors, displayFrames, palette } from '../../layout/zones';
import type { GalleryItem } from '../../data/types';
import type { WorldEvent } from '../../data/events';
import type { WorldQuality } from '../quality';
import { canvasTexture, coverFor, type CoverResource } from './coverTexture';
import { thumbnailUrl } from './thumbnailUrl';
import { Celebration, celebrationStats, type CelebrationFrame } from './Celebration';
import { worldCopy, type GalleryLocale } from '../../copy';

const mountedFrames = new Map<object, number>();
export function galleryStats() {
  return { frames: [...mountedFrames.values()].reduce((sum, count) => sum + count, 0), ...celebrationStats() };
}
export type GalleryProps = {
  /** Adapter order is newest first: GalleryItem intentionally has no timestamp. */
  items: readonly GalleryItem[];
  events?: readonly WorldEvent[];
  baselineReady?: boolean;
  quality: WorldQuality;
  still: boolean;
  locale?: GalleryLocale;
  baseUrl?: string;
  onSelectRelease?: (item: GalleryItem) => void;
  onCelebrate?: (item: GalleryItem) => void;
};
const emptyEvents: readonly WorldEvent[] = [];
const tileSize = 512;
const atlasSize = 2048;
function makeGallery(items: readonly GalleryItem[], baseUrl: string | undefined, invalidate: () => void, covers: Map<string, CoverResource>) {
  const visible = items.slice(0, displayFrames.length); const group = new THREE.Group();
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = atlasSize;
  const ctx = canvas.getContext('2d')!; const atlas = canvasTexture(canvas);
  let disposed = false;
  const coverMaterials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const material = new THREE.MeshBasicMaterial({ map: atlas, transparent: true, side: THREE.FrontSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const gradient = new THREE.DataTexture(new Uint8Array([115, 195, 255]), 3, 1, THREE.RedFormat);
  gradient.unpackAlignment = 1; gradient.minFilter = gradient.magFilter = THREE.NearestFilter; gradient.needsUpdate = true;
  // All scaffolding and curtain folds share the environment's three-step toon style.
  const wood = new THREE.MeshToonMaterial({ color: palette.wood, gradientMap: gradient });
  const curtain = new THREE.MeshToonMaterial({ color: palette.lavender, gradientMap: gradient });
  const gold = new THREE.MeshToonMaterial({ color: '#E5B84F', gradientMap: gradient });
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1); geometries.push(boxGeometry);
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i += 1) {
    const a = Math.PI / 2 + i * Math.PI / 5; const r = i % 2 ? 0.065 : 0.145;
    if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r); else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  star.closePath(); const starGeometry = new THREE.ShapeGeometry(star); geometries.push(starGeometry);
  function plane(parent: THREE.Group, slot: number, y: number, tileY: number, height: number, worldWidth: number, worldHeight: number, z: number, item: GalleryItem) {
    const geometry = new THREE.PlaneGeometry(worldWidth, worldHeight); geometries.push(geometry);
    const uv = geometry.getAttribute('uv'); const x = slot % 3 * tileSize; const top = Math.floor(slot / 3) * tileSize + tileY;
    for (let v = 0; v < uv.count; v += 1) uv.setXY(v, (x + uv.getX(v) * tileSize) / atlasSize, 1 - (top + (1 - uv.getY(v)) * height) / atlasSize);
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(0, y, z); mesh.userData.release = item; parent.add(mesh);
  }
  function box(parent: THREE.Group, position: [number, number, number], scale: [number, number, number], mat: THREE.Material, item: GalleryItem) {
    const mesh = new THREE.Mesh(boxGeometry, mat); mesh.position.set(...position); mesh.scale.set(...scale); mesh.userData.release = item; parent.add(mesh); return mesh;
  }
  function newerState(item: GalleryItem, index: number, state: GalleryItem['state']) {
    return item.state === state || items.slice(0, index).some(other => other.projectId === item.projectId && other.state === state && (item.version === null || other.version === null || other.version > item.version));
  }
  function paint() {
    ctx.clearRect(0, 0, atlasSize, atlasSize);
    visible.forEach((item, index) => {
      ctx.save(); ctx.translate(index % 3 * tileSize, Math.floor(index / 3) * tileSize);
      ctx.fillStyle = palette.butter; ctx.fillRect(0, 320, 512, 64);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = palette.ink;
      ctx.font = '600 27px "Inter Variable", sans-serif'; ctx.fillText(`${item.name} · v${item.version ?? '—'}`, 256, 352, 490);
      if (item.playing !== null && item.playing > 0) {
        ctx.fillStyle = palette.cream; ctx.fillRect(0, 384, 512, 64); ctx.fillStyle = palette.ink;
        ctx.fillText(`${worldCopy.en.gallery.playing} ${item.playing}`, 256, 416, 490);
      }
      if (newerState(item, index, 'failed')) {
        ctx.fillStyle = '#AF496B'; ctx.beginPath(); ctx.moveTo(0, 448); ctx.lineTo(512, 448); ctx.lineTo(488, 480); ctx.lineTo(512, 512); ctx.lineTo(0, 512); ctx.lineTo(24, 480); ctx.closePath(); ctx.fill();
        ctx.fillStyle = palette.cream; ctx.fillText(worldCopy.en.gallery.failed, 256, 480, 460);
      }
      ctx.restore();
    });
    atlas.needsUpdate = true; invalidate();
  }
  visible.forEach((item, index) => {
    const anchor = displayFrames[index]!; const frame = new THREE.Group();
    frame.position.set(anchor.position[0], 0, anchor.position[1]); frame.rotation.y = anchor.yaw; group.add(frame);
    // Overlay the existing Environment frames and opaque empty nameplates.
    const cover = coverFor(covers, item, thumbnailUrl(item.projectId, item.releaseId, baseUrl), invalidate);
    const coverMaterial = new THREE.MeshBasicMaterial({ map: cover.texture, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    coverMaterials.push(coverMaterial);
    const geometry = new THREE.PlaneGeometry(1.36, 0.94); geometries.push(geometry);
    const face = new THREE.Mesh(geometry, coverMaterial); face.position.set(0, 1.43, 0.28); face.userData.release = item; frame.add(face);
    plane(frame, index, 0.67, 320, 64, 1.17, 0.23, 0.32, item);
    if (item.playing !== null && item.playing > 0) plane(frame, index, 0.38, 384, 64, 1.24, 0.20, 0.29, item);
    if (newerState(item, index, 'failed')) plane(frame, index, 1.98, 448, 64, 1.48, 0.22, 0.34, item);
    if (item.current) { const mesh = new THREE.Mesh(starGeometry, gold); mesh.position.set(0.58, 1.78, 0.32); mesh.userData.release = item; frame.add(mesh); }
    if (item.enabled === false) {
      // Two half-drawn folded curtains leave the middle of the cover visible.
      for (const side of [-1, 1]) for (let fold = 0; fold < 4; fold += 1) {
        box(frame, [side * (0.635 - fold * 0.085), 1.43, 0.29 + (fold % 2) * 0.025], [0.09, 0.93 - fold * 0.04, 0.055], curtain, item);
      }
      box(frame, [0, 1.91, 0.31], [1.38, 0.06, 0.06], curtain, item);
    }
    if (newerState(item, index, 'pending')) {
      for (const side of [-1, 1]) box(frame, [side * 0.83, 1.01, 0.36], [0.055, 1.98, 0.055], wood, item);
      for (const y of [0.23, 1.13, 2.08]) box(frame, [0, y, 0.36], [1.8, 0.055, 0.10], wood, item);
      const brace = box(frame, [0, 0.68, 0.36], [1.84, 0.045, 0.045], wood, item); brace.rotation.z = Math.PI / 7;
    }
  });
  const newest = visible[0];
  if (newest) {
    const arcade = new THREE.Group(); arcade.position.set(anchors.arcade[0], 1.42, anchors.arcade[1] + 0.65); group.add(arcade);
    const geometry = new THREE.PlaneGeometry(0.78, 0.52); geometries.push(geometry);
    const face = new THREE.Mesh(geometry, coverMaterials[0]); face.userData.release = newest; arcade.add(face);
  }
  paint();
  void document.fonts?.load('600 30px "Inter Variable"').then(() => { if (!disposed) paint(); }).catch(() => {});
  return { group, dispose() {
    disposed = true; coverMaterials.forEach(material => material.dispose());
    geometries.forEach(geometry => geometry.dispose()); atlas.dispose(); material.dispose(); gradient.dispose(); wood.dispose(); curtain.dispose(); gold.dispose();
  } };
}
export function Gallery({ items, events = emptyEvents, baselineReady = true, quality, still, locale = 'vi', baseUrl, onSelectRelease, onCelebrate }: GalleryProps) {
  const invalidate = useThree(state => state.invalidate);
  const covers = useRef(new Map<string, CoverResource>());
  const itemsKey = JSON.stringify(items);
  const stableItems = useMemo<readonly GalleryItem[]>(() => JSON.parse(itemsKey), [itemsKey]);
  useEffect(() => {
    const cache = covers.current;
    return () => { cache.forEach(cover => cover.dispose()); cache.clear(); };
  }, [baseUrl]);
  const [resource, setResource] = useState<ReturnType<typeof makeGallery> | null>(null); const token = useRef({});
  useEffect(() => {
    const created = makeGallery(stableItems, baseUrl, invalidate, covers.current); setResource(created);
    const live = new Set(stableItems.slice(0, displayFrames.length).map(item => `${item.gameId}:${item.version ?? item.releaseId}`));
    for (const [key, cover] of covers.current) if (!live.has(key)) { cover.dispose(); covers.current.delete(key); }
    mountedFrames.set(token.current, Math.min(items.length, displayFrames.length)); const key = token.current;
    return () => { mountedFrames.delete(key); created.dispose(); };
  }, [stableItems, baseUrl, invalidate]);
  const frames: CelebrationFrame[] = items.slice(0, displayFrames.length).map((item, index) => {
    const anchor = displayFrames[index]!;
    return { item, position: [anchor.position[0], 0, anchor.position[1]], yaw: anchor.yaw };
  });
  function select(event: ThreeEvent<MouseEvent>) {
    if (event.delta > 4) return;
    const item = event.object.userData.release as GalleryItem | undefined;
    if (item) { event.stopPropagation(); onSelectRelease?.(item); }
  }
  return <group>
    {resource && <primitive object={resource.group} dispose={null} onClick={select} />}
    <Celebration frames={frames} events={events} baselineReady={baselineReady} quality={quality} still={still} locale={locale}
      {...(onCelebrate ? { onCelebrate } : {})} />
  </group>;
}
