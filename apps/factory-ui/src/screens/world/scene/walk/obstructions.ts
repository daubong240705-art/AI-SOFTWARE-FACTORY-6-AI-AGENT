import { Box3, Matrix4, Ray, Vector3 } from 'three';
import { environmentModel } from '../../layout/zones';

// Analytic boxes keep the iso environment's deliberately disabled mesh raycasting intact.
const boxes = environmentModel().parts.filter(p => p.shape !== 'rug' && p.position[1] > 0.12 && p.scale[1] > 0.07).map(p => ({
  box: new Box3(new Vector3(-p.scale[0] / 2 - 0.12, -p.scale[1] / 2 - 0.12, -p.scale[2] / 2 - 0.12), new Vector3(p.scale[0] / 2 + 0.12, p.scale[1] / 2 + 0.12, p.scale[2] / 2 + 0.12)),
  inverse: new Matrix4().makeRotationY(p.yaw).setPosition(...p.position).invert(),
}));
const local = new Ray(), hit = new Vector3();
export function obstructionDistance(ray: Ray, max: number) {
  let distance = max;
  for (const item of boxes) {
    local.copy(ray).applyMatrix4(item.inverse);
    if (local.intersectBox(item.box, hit)) distance = Math.min(distance, hit.distanceTo(local.origin));
  }
  return distance;
}
