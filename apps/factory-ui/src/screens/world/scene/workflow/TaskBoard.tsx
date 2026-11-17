import type { WorldLocations } from '../CameraRig';
import { type WorkflowLocale } from '../../copy';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { anchors } from '../../layout/zones';
import type { TaskCard } from '../../data/types';
import { useWorldMotion } from '../Ticker';
import { taskColumns, workflowColors, workflowDebug } from './support';

export { workflowStats } from './support';
export type WorkflowPoint = readonly [number, number, number];
export type AtlasEntry = { key: string; code?: string; title?: string; text?: string; color?: string };

function ellipsis(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text;
  let end = text.length;
  while (end > 0 && ctx.measureText(`${text.slice(0, end)}…`).width > width) end--;
  return `${text.slice(0, end)}…`;
}
/** Shared canvas atlas utility; all drawing is local, including font completion. */
export function createWorkflowAtlas(entries: readonly AtlasEntry[], invalidate: () => void) {
  const canvas = document.createElement('canvas');
  const tileW = 384, tileH = 160, columns = 4;
  canvas.width = columns * tileW; canvas.height = Math.max(1, Math.ceil(entries.length / columns)) * tileH;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
  const geometries = new Map<string, THREE.PlaneGeometry>();
  const draw = () => {
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    entries.forEach((entry, index) => {
      const x = index % columns * tileW, y = Math.floor(index / columns) * tileH;
      ctx.save(); ctx.beginPath(); ctx.rect(x + 2, y + 2, tileW - 4, tileH - 4); ctx.clip();
      if (entry.color) { ctx.fillStyle = entry.color; ctx.beginPath(); ctx.roundRect(x + 5, y + 5, tileW - 10, tileH - 10, 22); ctx.fill(); }
      ctx.fillStyle = '#4A3B2F'; ctx.textBaseline = 'middle';
      if (entry.text !== undefined) {
        ctx.font = '600 42px "Inter Variable", sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(ellipsis(ctx, entry.text, tileW - 28), x + tileW / 2, y + tileH / 2);
      } else {
        ctx.textAlign = 'left'; ctx.font = '700 32px "Inter Variable", sans-serif';
        ctx.fillText(ellipsis(ctx, entry.code ?? '', tileW - 36), x + 18, y + 36);
        ctx.font = '500 30px "Inter Variable", sans-serif';
        const title = (entry.title ?? '').replace(/\s+/g, ' ').trim();
        let split = 0;
        while (split < title.length && ctx.measureText(title.slice(0, split + 1)).width <= tileW - 36) split++;
        if (split < title.length) { const space = title.lastIndexOf(' ', split); if (space > 0) split = space; }
        ctx.fillText(title.slice(0, split), x + 18, y + 85);
        ctx.fillText(ellipsis(ctx, title.slice(split).trim(), tileW - 36), x + 18, y + 123);
      }
      ctx.restore();
    });
    texture.needsUpdate = true;
  };
  entries.forEach((entry, index) => {
    const geometry = new THREE.PlaneGeometry(1, 1), uv = geometry.getAttribute('uv');
    const x = index % columns * tileW, y = Math.floor(index / columns) * tileH;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (x + 2 + uv.getX(i) * (tileW - 4)) / canvas.width,
      1 - (y + 2 + (1 - uv.getY(i)) * (tileH - 4)) / canvas.height);
    geometries.set(entry.key, geometry);
  });
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  let disposed = false; draw();
  if (document.fonts) void document.fonts.load('500 30px "Inter Variable"').then(() => {
    if (!disposed) { draw(); invalidate(); }
  }).catch(() => { /* The local sans-serif fallback remains readable. */ });
  return {
    mesh(key: string, width: number, height: number) {
      const mesh = new THREE.Mesh(geometries.get(key), material); mesh.scale.set(width, height, 1); return mesh;
    },
    dispose() { disposed = true; texture.dispose(); material.dispose(); geometries.forEach(geometry => geometry.dispose()); },
  };
}
let sharedToon: { material: THREE.MeshToonMaterial; gradient: THREE.DataTexture; users: number } | null = null;
/** All workflow solids share the environment's three-step toon style and one material. */
export function createWorkflowToon() {
  if (!sharedToon) {
    const gradient = new THREE.DataTexture(new Uint8Array([115, 195, 255]), 3, 1, THREE.RedFormat);
    gradient.unpackAlignment = 1; gradient.minFilter = gradient.magFilter = THREE.NearestFilter; gradient.needsUpdate = true;
    sharedToon = { material: new THREE.MeshToonMaterial({ color: 'white', gradientMap: gradient }), gradient, users: 0 };
  }
  const resource = sharedToon; resource.users++;
  let disposed = false;
  return { material: resource.material, dispose() {
    if (disposed) return;
    disposed = true;
    if (--resource.users === 0) { resource.material.dispose(); resource.gradient.dispose(); if (sharedToon === resource) sharedToon = null; }
  } };
}

export type TaskBoardProps = {
  locations?: WorldLocations;
  projectId: string | null;
  columns: Record<TaskCard['column'], readonly TaskCard[]>;
  /** Data-layer overflow, in addition to supplied cards hidden by this board's three-row limit. */
  overflow?: Partial<Record<TaskCard['column'], number>>;
  quality?: 'high' | 'low';
  still?: boolean;
  locale?: WorkflowLocale;
  onOpenTask: (projectId: string, taskId: string) => void;
  onHover?: (info: { kind: 'task'; projectId: string; taskId: string; code: string; title: string } | null) => void;
};
const rows = 3;
const columnX = (index: number) => anchors.taskBoard[0] - 4.3 + index * 2.15;
const targetOf = (column: number, row: number) => new THREE.Vector3(columnX(column), 1.68 - row * 0.245, anchors.taskBoard[1] + 0.3);

type BoardResource = {
  group: THREE.Group;
  sample: (now: number) => boolean;
  dispose: () => void;
};
export function TaskBoard({ locations, projectId, columns: inputColumns, overflow: inputOverflow, quality = 'high', still = false, locale = 'vi', onOpenTask, onHover }: TaskBoardProps) {
  const contentKey = JSON.stringify({ columns: inputColumns, overflow: inputOverflow });
  const { columns, overflow } = useMemo<{ columns: TaskBoardProps['columns']; overflow: TaskBoardProps['overflow'] }>(() => JSON.parse(contentKey), [contentKey]);
  const invalidate = useThree(state => state.invalidate); const motion = useWorldMotion();
  const [resource, setResource] = useState<BoardResource | null>(null);
  const current = useRef<BoardResource | null>(null);
  const previous = useRef<{ project: string | null; points: Map<string, { point: THREE.Vector3; column: TaskCard['column'] }> } | null>(null);
  const release = useRef<(() => void) | null>(null); const debugKey = useRef({});
  const shown = useRef<TaskCard[]>([]);
  useEffect(() => {
    const group = new THREE.Group(); group.name = 'task-board';
    const cards = taskColumns.flatMap(column => columns[column].slice(0, rows)); shown.current = cards;
    const counts = Object.fromEntries(taskColumns.map(column => [column, columns[column].length + (overflow?.[column] ?? 0)])) as Record<TaskCard['column'], number>;
    workflowDebug.boards.set(debugKey.current, counts);
    const entries: AtlasEntry[] = taskColumns.map(column => ({ key: `column:${column}`, text: ({ todo: 'To do', doing: 'In progress', review: 'In review', failed: 'Failed', done: 'Done' })[column] }));
    cards.forEach(card => entries.push({ key: card.id, code: card.code, title: card.title }));
    taskColumns.forEach(column => { const count = Math.max(0, columns[column].length - rows) + (overflow?.[column] ?? 0); if (count) entries.push({ key: `overflow:${column}`, text: `+${count}`, color: '#E9D4AE' }); });
    const atlas = createWorkflowAtlas(entries, invalidate), toon = createWorkflowToon();
    const geometry = new RoundedBoxGeometry(1, 1, 1, quality === 'low' ? 1 : 2, 0.08);
    const body = new THREE.InstancedMesh(geometry, toon.material, Math.max(1, cards.length)); body.count = cards.length; body.frustumCulled = false; group.add(body);
    const backdropGeometry = new THREE.BoxGeometry(10.65, 1.2, 0.025);
    const backdropMaterial = new THREE.MeshToonMaterial({ color: '#FFF8E7', gradientMap: toon.material.gradientMap });
    const backdrop = new THREE.Mesh(backdropGeometry, backdropMaterial); backdrop.position.set(anchors.taskBoard[0], 1.53, anchors.taskBoard[1] + 0.25); group.add(backdrop);
    taskColumns.forEach((column, index) => {
      const header = atlas.mesh(`column:${column}`, 1.92, 0.21); header.position.set(columnX(index), 1.96, anchors.taskBoard[1] + 0.29); group.add(header);
      const count = Math.max(0, columns[column].length - rows) + (overflow?.[column] ?? 0);
      if (count) { const chip = atlas.mesh(`overflow:${column}`, 0.55, 0.2); chip.position.set(columnX(index), 1.0, anchors.taskBoard[1] + 0.3); group.add(chip); }
    });
    const baseline = previous.current?.project === projectId ? previous.current : null;
    const next = new Map<string, { point: THREE.Vector3; column: TaskCard['column'] }>();
    const started = performance.now();
    const moving = cards.map((card, index) => {
      const columnIndex = taskColumns.indexOf(card.column), rowIndex = columns[card.column].indexOf(card);
      const target = targetOf(columnIndex, rowIndex), old = baseline?.points.get(card.id);
      const from = old && old.column !== card.column && !still ? old.point.clone() : target.clone();
      const point = from.clone(); next.set(card.id, { point, column: card.column });
      const face = atlas.mesh(card.id, 1.8, 0.22); face.userData.taskIndex = index; group.add(face);
      body.setColorAt(index, new THREE.Color(workflowColors[card.column]));
      return { target, from, point, face, animated: !from.equals(target) };
    });
    previous.current = { project: projectId, points: next };
    const transform = new THREE.Object3D();
    const sample = (now: number) => {
      const progress = still ? 1 : THREE.MathUtils.clamp((now - started) / (quality === 'low' ? 360 : 420), 0, 1), eased = progress * progress * (3 - 2 * progress);
      moving.forEach((item, index) => {
        item.point.copy(item.from).lerp(item.target, eased);
        if (item.animated) { item.point.z += Math.sin(progress * Math.PI) * 0.32; item.point.y += Math.sin(progress * Math.PI) * 0.09; }
        transform.position.copy(item.point); transform.scale.set(1.88, 0.225, 0.035); transform.updateMatrix(); body.setMatrixAt(index, transform.matrix);
        item.face.position.copy(item.point); item.face.position.z += 0.045;
        const card = cards[index]!; locations?.current.set(`card:${card.id}`, [item.point.x, item.point.y, item.point.z]); locations?.current.set(`card:${card.taskId}`, [item.point.x, item.point.y, item.point.z]);
      });
      body.instanceMatrix.needsUpdate = true;
      return progress < 1 && moving.some(item => item.animated);
    };
    const created: BoardResource = { group, sample, dispose() { atlas.dispose(); geometry.dispose(); body.dispose(); backdropGeometry.dispose(); backdropMaterial.dispose(); toon.dispose(); } };
    current.current = created; setResource(created);
    if (sample(started)) release.current = motion.request('live');
    invalidate();
    return () => { release.current?.(); release.current = null; current.current = null; created.dispose(); cards.forEach(card => { locations?.current.delete(`card:${card.id}`); locations?.current.delete(`card:${card.taskId}`); }); workflowDebug.boards.delete(debugKey.current); };
  }, [projectId, columns, overflow, quality, still, locale, motion, invalidate, locations]);
  useFrame(() => {
    if (current.current && release.current && !current.current.sample(performance.now())) { release.current(); release.current = null; }
  });
  const cardAt = (event: ThreeEvent<PointerEvent | MouseEvent>) => {
    const index = event.instanceId ?? event.object.userData.taskIndex;
    return typeof index === 'number' ? shown.current[index] : undefined;
  };
  return resource ? <primitive object={resource.group} dispose={null}
    onClick={(event: ThreeEvent<MouseEvent>) => { if (event.delta > 4) return; const card = cardAt(event); if (card) { event.stopPropagation(); onOpenTask(card.projectId, card.taskId); } }}
    onPointerMove={(event: ThreeEvent<PointerEvent>) => { const card = cardAt(event); if (card) { event.stopPropagation(); onHover?.({ kind: 'task', projectId: card.projectId, taskId: card.taskId, code: card.code, title: card.title }); } else onHover?.(null); }}
    onPointerOut={() => onHover?.(null)} /> : null;
}
