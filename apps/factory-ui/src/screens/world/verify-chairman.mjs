// Offline office navigation and mounted-surface checks; no Host or browser needed.
import './verify-loader.mjs';
import assert from 'node:assert/strict';
const { desks, ownerDesk, furnitureFootprints } = await import('./layout/zones.ts');
const { chairmanChair, chairmanExit, chairmanSurfaces, chairmanParts } = await import('./layout/chairman.ts');
const { layout, pathBetween } = await import('./layout/waypoints.ts');
const { resolveWalkMove } = await import('./scene/walk/collision.ts');
const { chairmanTabs } = await import('./panels/chairmanTabs.ts');

assert.equal(layout.blockedEdges, 0);
for (const desk of desks) if (desk.id !== 'owner') assert(pathBetween(desk.id, 'table-0').length > 1, `${desk.id}: worker keeps a reachable desk`);
assert(pathBetween('owner', 'table-0').length > 1, 'chair approach reaches the rest of the studio');
// Walk through the door and around the executive desk using the real collision solver.
function walk(points) {
  let p = { x: points[0][0], z: points[0][1] };
  for (const target of points.slice(1)) {
    const steps = Math.max(1, Math.ceil(Math.hypot(target[0] - p.x, target[1] - p.z) / .08));
    const delta = { x: (target[0] - p.x) / steps, z: (target[1] - p.z) / steps };
    for (let i = 0; i < steps; i++) p = resolveWalkMove(p, delta);
    assert(Math.hypot(p.x - target[0], p.z - target[1]) < .06, `walk reaches ${target} (actual ${p.x},${p.z})`);
  }
}
const route = [[-15.3, -7.2], [-15.3, -9.55], [-17.05, -9.55], [-17.05, -11.8], [-16, -11.8], [-16, -12.35], chairmanExit];
walk(route); walk([...route].reverse());
const chair = furnitureFootprints.find(f => f.id === 'owner-chair');
assert(chair);
assert(!furnitureFootprints.some(f => Math.abs(chairmanExit[0] - f.position[0]) < f.half[0] + .35 && Math.abs(chairmanExit[1] - f.position[1]) < f.half[1] + .35), 'standing exit is collision free');
assert.equal(ownerDesk.position[0], chairmanChair[0]);
assert(Math.hypot(chairmanExit[0] - chairmanChair[0], chairmanExit[1] - chairmanChair[1]) < 1.7, 'E reaches the chair after standing');
const parts = chairmanParts();
for (const part of parts) assert([...part.position, ...part.scale, part.yaw].every(Number.isFinite));
assert.equal(chairmanSurfaces.filter(s => s.id.startsWith('office-tv')).length, 3);
for (const face of chairmanSurfaces) {
  const back = parts.find(p => p.mount === face.id);
  assert(back, `${face.id}: real backing`);
  const depth = Math.sin(face.yaw) * (face.position[0] - back.position[0]) + Math.cos(face.yaw) * (face.position[2] - back.position[2]) - back.scale[2] / 2;
  assert(depth >= .029, `${face.id}: visible ink clears backing`);
}
assert.deepEqual(chairmanTabs, ['assign', 'attention', 'create', 'games', 'portal', 'team', 'knowledge', 'workflow', 'chat', 'activity']);
console.log('W-22: all worker desks reachable, blockedEdges=0, walk in/out, chair reach and standing clearance, 3 TVs, mounted face clearance PASS');
