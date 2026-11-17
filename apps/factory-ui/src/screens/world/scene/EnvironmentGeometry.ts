import type { Part } from '../layout/zones';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// One bevel segment is enough for small cartoon props; thin details use plain boxes.
// Shared with the headless budget check so triangle accounting matches the renderer.
export function environmentGeometries() {
  return {
    box: new RoundedBoxGeometry(1, 1, 1, 1, 0.07),
    detail: new THREE.BoxGeometry(1, 1, 1),
    rug: new THREE.BoxGeometry(1, 1, 1),
    cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
    sphere: new THREE.SphereGeometry(0.5, 8, 6),
    glass: new RoundedBoxGeometry(1, 1, 1, 1, 0.04),
    screen: new RoundedBoxGeometry(1, 1, 1, 1, 0.06),
  };
}

/** Radius is in world units, independent of each rug's width/depth. */
export function geometryForPart(part: Part, shared: ReturnType<typeof environmentGeometries>): THREE.BufferGeometry {
  if (part.shape !== 'rug') return shared[part.shape];
  const [width, height, depth] = part.scale, r = 0.18, x = -width / 2, z = -depth / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + r, z); shape.lineTo(x + width - r, z);
  shape.quadraticCurveTo(x + width, z, x + width, z + r);
  shape.lineTo(x + width, z + depth - r); shape.quadraticCurveTo(x + width, z + depth, x + width - r, z + depth);
  shape.lineTo(x + r, z + depth); shape.quadraticCurveTo(x, z + depth, x, z + depth - r);
  shape.lineTo(x, z + r); shape.quadraticCurveTo(x, z, x + r, z);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 5 });
  geometry.rotateX(-Math.PI / 2); geometry.translate(0, -height / 2, 0);
  geometry.scale(1 / width, 1 / height, 1 / depth);
  return geometry;
}
