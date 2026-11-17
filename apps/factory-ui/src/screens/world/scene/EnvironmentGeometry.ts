import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// One bevel segment is enough for small cartoon props; thin details use plain boxes.
// Shared with the headless budget check so triangle accounting matches the renderer.
export function environmentGeometries() {
  return {
    box: new RoundedBoxGeometry(1, 1, 1, 1, 0.07),
    detail: new THREE.BoxGeometry(1, 1, 1),
    cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
    sphere: new THREE.SphereGeometry(0.5, 8, 6),
    glass: new RoundedBoxGeometry(1, 1, 1, 1, 0.04),
    screen: new RoundedBoxGeometry(1, 1, 1, 1, 0.06),
  };
}
