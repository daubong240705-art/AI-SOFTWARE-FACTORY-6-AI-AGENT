import { Box3, Matrix4, Ray, Vector3 } from 'three';
import { walkSceneryParts } from './sceneryModel';
import { environmentModel, type Part } from '../../layout/zones';
import { deskFloorNorth } from '../../layout/campus';

// Analytic boxes keep the iso environment's deliberately disabled mesh raycasting intact.
const environment = environmentModel(true).parts;
let currentSouth = 0;
let boxes: ReturnType<typeof buildBoxes> = [];
function buildBoxes(floorSouth: number) {
  const west: Part = { shape: 'box', position: [-18, 1.8, (floorSouth + deskFloorNorth) / 2], scale: [.2, 3.6, floorSouth - deskFloorNorth], yaw: 0, color: '' };
  return [...environment, ...walkSceneryParts(floorSouth), west].filter(p => p.shape !== 'rug' && p.position[1] > 0.12 && p.scale[1] > 0.07).map(p => ({
    box: new Box3(new Vector3(-p.scale[0] / 2 - 0.12, -p.scale[1] / 2 - 0.12, -p.scale[2] / 2 - 0.12), new Vector3(p.scale[0] / 2 + 0.12, p.scale[1] / 2 + 0.12, p.scale[2] / 2 + 0.12)),
    inverse: new Matrix4().makeRotationY(p.yaw).setPosition(...p.position).invert(),
  }));
}
export function setObstructionFloor(floorSouth: number) {
  if (floorSouth !== currentSouth) { currentSouth = floorSouth; boxes = buildBoxes(floorSouth); }
}
const local = new Ray(), hit = new Vector3();
export function obstructionDistance(ray: Ray, max: number) {
  let distance = max;
  for (const item of boxes) {
    local.copy(ray).applyMatrix4(item.inverse);
    if (item.box.containsPoint(local.origin)) continue;
    if (local.intersectBox(item.box, hit)) distance = Math.min(distance, hit.distanceTo(local.origin));
  }
  return distance;
}
