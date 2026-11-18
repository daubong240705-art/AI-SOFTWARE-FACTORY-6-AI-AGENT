import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type Piece = { shape?: 'box' | 'sphere' | 'cone'; at: readonly [number, number, number]; size: readonly [number, number, number]; color: string; yaw?: number };
/** A single vertex-colour draw for each static or independently moving assembly. */
export function colouredGeometry(pieces: readonly Piece[]) {
  const shapes = { box: new THREE.BoxGeometry(1, 1, 1), sphere: new THREE.SphereGeometry(0.5, 10, 6), cone: new THREE.ConeGeometry(0.5, 1, 6) };
  const parts = pieces.map(p => {
    const g = shapes[p.shape ?? 'box'].clone().scale(...p.size).rotateY(p.yaw ?? 0).translate(...p.at);
    const color = new THREE.Color(p.color); const colors = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = color.r; colors[i + 1] = color.g; colors[i + 2] = color.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); return g;
  });
  const geometry = mergeGeometries(parts)!; parts.forEach(p => p.dispose()); Object.values(shapes).forEach(g => g.dispose()); return geometry;
}
