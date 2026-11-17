import { useEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { environmentModel, type Label, type Part } from '../layout/zones';
import { layout } from '../layout/waypoints';
import { environmentGeometries, geometryForPart } from './EnvironmentGeometry';
import { makeArtwork } from './EnvironmentArt';

function matrix(p: Part) {
  return new THREE.Matrix4().compose(new THREE.Vector3(...p.position), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw), new THREE.Vector3(...p.scale));
}
function makeEnvironment() {
  const model = environmentModel();
  const gradient = new THREE.DataTexture(new Uint8Array([115, 195, 255]), 3, 1, THREE.RedFormat);
  gradient.unpackAlignment = 1;
  gradient.minFilter = THREE.NearestFilter; gradient.magFilter = THREE.NearestFilter; gradient.needsUpdate = true;
  const toon = new THREE.MeshToonMaterial({ color: 'white', gradientMap: gradient });
  const staticMaterial = new THREE.MeshToonMaterial({ color: 'white', vertexColors: true, gradientMap: gradient });
  const glass = new THREE.MeshToonMaterial({ color: 'white', transparent: true, opacity: 0.48, depthWrite: false, gradientMap: gradient });
  const screens = new THREE.MeshToonMaterial({ color: 'white', emissive: '#AFCFE6', emissiveIntensity: 0.3, gradientMap: gradient });
  const geometries = environmentGeometries();
  const group = new THREE.Group();
  const staticParts = model.parts.filter(p => p.zone);
  const mergedPieces = staticParts.map(p => {
    const shape = geometryForPart(p, geometries); const g = (shape.index ? shape.toNonIndexed() : shape.clone()).applyMatrix4(matrix(p)); if (p.shape === 'rug') shape.dispose(); const c = new THREE.Color(p.color); const colors = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); return g;
  });
  const merged = mergeGeometries(mergedPieces)!; mergedPieces.forEach(g => g.dispose()); group.add(new THREE.Mesh(merged, staticMaterial));
  for (const shape of ['box', 'detail', 'cylinder', 'sphere', 'screen', 'glass', 'rug'] as const) {
    const parts = model.parts.filter(p => !p.zone && p.shape === shape); if (!parts.length) continue; const mesh = new THREE.InstancedMesh(geometries[shape], shape === 'screen' ? screens : shape === 'glass' ? glass : toon, parts.length);
    parts.forEach((part, i) => { mesh.setMatrixAt(i, matrix(part)); mesh.setColorAt(i, new THREE.Color(part.color)); });
    mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere(); group.add(mesh);
  }
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!; const radial = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  radial.addColorStop(0, 'rgba(74,59,47,0.22)'); radial.addColorStop(0.5, 'rgba(74,59,47,0.10)'); radial.addColorStop(1, 'rgba(74,59,47,0)'); ctx.fillStyle = radial; ctx.fillRect(0, 0, 64, 64);
  const shadowTexture = new THREE.CanvasTexture(canvas); const shadowMaterial = new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  const shadowGeometry = new THREE.PlaneGeometry(1, 1); const shadowMesh = new THREE.InstancedMesh(shadowGeometry, shadowMaterial, model.shadows.length);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  model.shadows.forEach((s, i) => shadowMesh.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(s.position[0], 0.037, s.position[1]), q, new THREE.Vector3(s.size[0], s.size[1], 1))));
  shadowMesh.computeBoundingSphere(); group.add(shadowMesh);
  group.traverse(object => { object.raycast = () => {}; });
  return { group, labels: model.labels, artwork: model.artwork, gradient, dispose() { for (const g of Object.values(geometries)) g.dispose(); merged.dispose(); toon.dispose(); screens.dispose(); glass.dispose(); staticMaterial.dispose(); gradient.dispose(); shadowGeometry.dispose(); shadowMaterial.dispose(); shadowTexture.dispose(); group.traverse(o => { if (o instanceof THREE.InstancedMesh) o.dispose(); }); } };
}
async function makeLabels(labels: Label[]) {
  await document.fonts.load('600 32px "Inter Variable"');
  const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 1024;
  const ctx = canvas.getContext('2d')!; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const pieces = labels.map((label, index) => {
    const x = index % 4 * 512; const y = Math.floor(index / 4) * 128;
    ctx.font = '600 88px "Inter Variable"'; ctx.fillStyle = label.color;
    ctx.fillText(label.text, x + 256, y + 64, 490);
    const plane = new THREE.PlaneGeometry(label.width, label.height);
    const uv = plane.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (x + uv.getX(i) * 512) / 2048, 1 - (y + (1 - uv.getY(i)) * 128) / 1024);
    const rotation = new THREE.Euler(label.floor ? -Math.PI / 2 : 0, label.floor ? 0 : label.yaw, 0);
    plane.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...label.position), new THREE.Quaternion().setFromEuler(rotation), new THREE.Vector3(1, 1, 1)));
    return plane;
  });
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  const geometry = mergeGeometries(pieces)!; pieces.forEach(p => p.dispose());
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, polygonOffset: true, polygonOffsetFactor: -2 });
  const mesh = new THREE.Mesh(geometry, material); mesh.renderOrder = 2; mesh.raycast = () => {};
  return { mesh, dispose() { texture.dispose(); geometry.dispose(); material.dispose(); } };
}
function Labels({ labels }: { labels: Label[] }) {
  const [mesh, setMesh] = useState<THREE.Mesh | null>(null); const invalidate = useThree(s => s.invalidate);
  useEffect(() => {
    let cancelled = false; let dispose: (() => void) | undefined;
    void makeLabels(labels).then(result => { if (cancelled) result.dispose(); else { dispose = result.dispose; setMesh(result.mesh); invalidate(); } });
    return () => { cancelled = true; dispose?.(); };
  }, [labels, invalidate]);
  return mesh ? <primitive object={mesh} /> : null;
}
function Artwork({ panels, gradient }: { panels: ReturnType<typeof environmentModel>['artwork']; gradient: THREE.Texture }) {
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const invalidate = useThree(s => s.invalidate);
  useEffect(() => {
    let cancelled = false; let dispose: (() => void) | undefined;
    void makeArtwork(panels, gradient).then(result => {
      if (cancelled) result.dispose();
      else { dispose = result.dispose; result.group.traverse(object => { object.raycast = () => {}; }); setGroup(result.group); invalidate(); }
    });
    return () => { cancelled = true; dispose?.(); };
  }, [panels, gradient, invalidate]);
  return group ? <primitive object={group} /> : null;
}
function GraphOverlay() {
  const [object, setObject] = useState<THREE.LineSegments | null>(null);
  const invalidate = useThree(s => s.invalidate);
  useEffect(() => {
    const byId = new Map(layout.nodes.map(n => [n.id, n]));
    const vertices = layout.edges.flatMap(([a, b]) => { const from = byId.get(a)!, to = byId.get(b)!; return [from.position[0], 0.065, from.position[1], to.position[0], 0.065, to.position[1]]; });
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const material = new THREE.LineBasicMaterial({ color: '#AF496B', transparent: true, opacity: 0.8 });
    const lines = new THREE.LineSegments(geometry, material); lines.raycast = () => {}; setObject(lines); invalidate();
    return () => { geometry.dispose(); material.dispose(); };
  }, [invalidate]);
  return object ? <primitive object={object} /> : null;
}
export function Environment() {
  const [resource, setResource] = useState<ReturnType<typeof makeEnvironment> | null>(null);
  const invalidate = useThree(s => s.invalidate);
  useEffect(() => {
    // Allocate GPU resources after commit so discarded StrictMode renders allocate nothing.
    const created = makeEnvironment(); setResource(created); invalidate();
    return created.dispose;
  }, [invalidate]);
  const debug = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('worldDebug') === '1';
  return resource ? <><primitive object={resource.group} /><Labels labels={resource.labels} /><Artwork panels={resource.artwork} gradient={resource.gradient} />{debug && <GraphOverlay />}</> : null;
}
