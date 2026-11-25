import assert from 'node:assert/strict';
import { Ray, Vector3 } from 'three';
import { obstructionDistance, setObstructionFloor } from './obstructions';
import { deskFloorSouth } from '../../layout/campus';
import { resolveWalkMove } from './collision';
import { furnitureFootprints, navigationBounds, type Footprint } from '../../layout/zones';
const desk: Footprint = { id: 'desk', position: [0, 0], half: [1, 0.5], yaw: 0 };
const slide = resolveWalkMove({ x: -1.4, z: -0.4 }, { x: 0.6, z: 0.5 }, 0.35, [desk]);
assert(slide.x <= -1.35 && slide.z > 0, 'moving into desk slides along its side');
const tunnel = resolveWalkMove({ x: -3, z: 0 }, { x: 6, z: 0 }, 0.35, [desk]);
assert(tunnel.x <= -1.35, 'large moves cannot tunnel through a desk');
const rotated = resolveWalkMove({ x: -1.4, z: 0 }, { x: 1, z: 0 }, 0.35, [{ ...desk, yaw: Math.PI / 2 }]);
assert(rotated.x <= -0.85, 'rotated desks collide in local coordinates');
for (const delta of [{ x: 100, z: 0 }, { x: -100, z: 0 }, { x: 0, z: 100 }, { x: 0, z: -100 }]) {
  const edge = resolveWalkMove({ x: 0, z: 0 }, delta, 0.35, []);
  assert(edge.x <= navigationBounds.x[1] - 0.35 && edge.x >= navigationBounds.x[0] + 0.35);
  assert(edge.z <= navigationBounds.z[1] - 0.35 && edge.z >= navigationBounds.z[0] + 0.35);
}
const doorway = resolveWalkMove({ x: -8, z: -2 }, { x: 0, z: 2 }, 0.35, furnitureFootprints);
assert(Math.abs(doorway.z) < 0.01, 'main cross-zone opening remains passable');
console.log('Walk collision: desk slide, swept moves, rotated desk, bounds, doorway PASS');

const south = deskFloorSouth(65);
setObstructionFloor(south);
const wallRay = new Ray(new Vector3(-16, 1.3, -2), new Vector3(-1, 0, 0));
assert(obstructionDistance(wallRay, 4) < 2, 'camera boom is pulled in before the west wall');
assert(obstructionDistance(new Ray(new Vector3(0, 1.3, -1), new Vector3(1, 0, 0)), 2) === 2, 'camera boom stays extended in open aisle');
console.log('Walk camera: wall obstruction and clear aisle PASS');

const eastWall = new Ray(new Vector3(16, 1.9, 4), new Vector3(1, 0, 0));
const southWall = new Ray(new Vector3(0, 1.9, south - 1.5), new Vector3(0, 0, 1));
assert(obstructionDistance(eastWall, 4) < 2, 'camera cannot pass through east glazing');
assert(obstructionDistance(southWall, 4) < 2, 'camera cannot pass through south glazing');
assert.ok(obstructionDistance(new Ray(new Vector3(16, 1.9, -1), new Vector3(1, 0, 0)), 3) < 2, 'east exterior is closed');
assert.equal(obstructionDistance(new Ray(new Vector3(0, 1.9, 12), new Vector3(0, 0, 1)), 3), 3, 'no interior wall at the former south boundary');
assert(obstructionDistance(new Ray(new Vector3(0, 2, 0), new Vector3(0, 1, 0)), 3) < 1.7, 'ceiling retracts upward camera boom');
const cooler = resolveWalkMove({ x: 17, z: 11.8 }, { x: 0, z: 1.3 });
assert(cooler.z < 12.5, 'water cooler has a collision footprint');
console.log('Studio camera/furnishings: exterior walls, ceiling, open interior, cooler collision PASS');
