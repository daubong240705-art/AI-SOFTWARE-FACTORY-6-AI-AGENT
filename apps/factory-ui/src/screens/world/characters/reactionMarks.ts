import * as THREE from 'three';
import { colouredGeometry, type Piece } from '../scene/props/geometry';
import { faceSurface } from './features';
import type { CharacterSpec } from './spec';
import type { Reaction } from './reaction';
const geometries = new Map<string, Record<string, THREE.BufferGeometry>>();
const inks = {
  crumbs: new THREE.MeshBasicMaterial({ vertexColors: true }),
  blush: new THREE.MeshBasicMaterial({ vertexColors: true }),
  soot: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }),
};
/** Face paint is built once per spec; each rig owns only its fading soot material. */
export function makeReactionMarks(spec: CharacterSpec) {
  let assets = geometries.get(spec.code);
  if (!assets) {
    const patch = (x: number, y: number, color: string, size: Piece['size']): Piece => ({ shape: 'sphere', color, at: [x, y, faceSurface(spec, x, y) + 0.018], size });
    assets = {
      soot: colouredGeometry(Array.from({ length: 15 }, (_, i) => patch(Math.sin(i * 2.4) * 0.34, 0.25 + i % 5 * 0.09, i % 2 ? '#4F4A50' : '#72696E', [0.12, 0.07, 0.025]))),
      crumbs: colouredGeometry(Array.from({ length: 7 }, (_, i) => patch(Math.sin(i * 2.4) * 0.27, 0.28 + i % 3 * 0.055, i % 2 ? '#70432C' : '#DFA058', [0.05, 0.035, 0.025]))),
      blush: colouredGeometry([-0.28, 0.28].map(x => patch(x, 0.415, '#F36B9F', [0.2, 0.11, 0.026]))),
    };
    geometries.set(spec.code, assets);
  }
  const group = new THREE.Group(); group.name = 'reaction-marks'; group.visible = false;
  for (const kind of ['soot', 'crumbs', 'blush'] as const) {
    const mesh = new THREE.Mesh(assets[kind], kind === 'soot' ? inks.soot.clone() : inks[kind]);
    mesh.name = kind; mesh.visible = false; mesh.raycast = () => {}; group.add(mesh);
  }
  return group;
}
export function updateReactionMarks(group: THREE.Object3D, reaction: Reaction, now: number, still: boolean) {
  const age = reaction ? (now - reaction.started) / 1000 : -1;
  group.visible = !still && !!reaction && age > 0.8 && age < 6.2;
  for (const mesh of group.children as THREE.Mesh[]) {
    mesh.visible = !!reaction && (mesh.name === 'soot' ? reaction.tool === 'taser' && age > 1.2 : mesh.name === 'crumbs' ? reaction.tool === 'cookie' && age < 3 : reaction.tool === 'feather' && age < 3);
    if (mesh.name === 'soot') (mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - (age - 1.2) / 5);
  }
}
export function disposeReactionMarkAssets() {
  for (const asset of geometries.values()) Object.values(asset).forEach(geometry => geometry.dispose());
  geometries.clear();
}
export function disposeRigMarks(root: THREE.Object3D) {
  const soot = root.getObjectByName('reaction-marks')?.getObjectByName('soot') as THREE.Mesh | undefined;
  if (soot) (soot.material as THREE.Material).dispose();
}
