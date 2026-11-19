import '../../verify-loader.mjs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
const { placeToy, toyImpactTime, toolContact } = await import('./placement.ts');
const { tools } = await import('./store.ts');
let cases = 0;
const live = new THREE.Group(), awareness = new THREE.Group(), rig = new THREE.Group();
live.add(awareness); awareness.add(rig);
// Desk, a mid-hop position, leisure seat, floor, sulk, and squash all use the
// actual rig matrix, exactly as ToyAnimation does after the animator runs.
for (const position of [[0,.57,0],[4,.85,-2],[-14.5,.8,12.1],[-12.8,.04,10.1]]) for (const yaw of [0, Math.PI/4, Math.PI]) for (const squash of [.4,1,1.15]) {
  live.position.set(...position); live.rotation.y = yaw; awareness.rotation.y = -.6;
  rig.position.set(.18,.08,0); rig.scale.set(1.08,squash,1); rig.rotation.y = Math.PI;
  rig.updateWorldMatrix(true,false);
  const center = new THREE.Vector3(0,.55,0).applyMatrix4(rig.matrixWorld);
  for (const camera of [[1,-1,1],[-1,0,0],[0,-.1,-1],[.8,.3,.2],[0,-1,0]]) for (const tool of tools) {
    const direction = new THREE.Vector3(...camera).normalize();
    const placement = placeToy(tool,rig.matrixWorld,direction,toyImpactTime);
    const contact = new THREE.Vector3(...toolContact[tool]).applyMatrix4(placement.matrix);
    assert(contact.distanceTo(placement.contact)<1e-8, `${tool}: rendered mesh contact matches target`);
    assert(Math.abs(contact.distanceTo(center)-.55)<.15, `${tool}: contact reaches body surface during movement/sulk`);
    const normal = contact.clone().sub(center).setY(0).normalize();
    if (Math.hypot(direction.x,direction.z)>1e-6) assert(normal.dot(direction.clone().setY(0).normalize().negate())>.5, `${tool}: approaches camera-facing shoulder`);
    const start = placeToy(tool,rig.matrixWorld,direction,0);
    assert(start.contact.distanceTo(center)>1.5, `${tool}: anticipation approaches from outside body`);
    cases++;
  }
}
console.log(`Toy placement PASS (${cases} actual mesh-anchor cases, cameras, live hops, leisure, squash and sulks)`);

// Check actual model vertices against desk slabs and the two monitor housings.
const { detailedToys } = await import('./models.ts');
const { desks, monitorYaw, desktopHeight } = await import('../../layout/zones.ts');
let clearCases=0;
for (const d of desks) for (const camera of [[1,-1,1],[-1,-.2,-1],[0,0,1],[1,0,0]]) for (const tool of tools) {
  const world=new THREE.Matrix4().makeTranslation(d.seat[0],.57,d.seat[1]);
  const placement=placeToy(tool,world,new THREE.Vector3(...camera).normalize(),toyImpactTime);
  const pos=detailedToys[tool].solid.getAttribute('position'), point=new THREE.Vector3();
  const monitorInverse=[d.monitor,d.sideMonitor].map(([x,z])=>new THREE.Matrix4().compose(new THREE.Vector3(x,1.08,z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),monitorYaw),new THREE.Vector3(1,1,1)).invert());
  for(let i=0;i<pos.count;i++) {
    point.fromBufferAttribute(pos,i).applyMatrix4(placement.matrix);
    assert(!(Math.abs(point.x-d.position[0])<.85 && Math.abs(point.z-d.position[1])<.44 && point.y>desktopHeight-.16 && point.y<desktopHeight),`${tool}: no tool vertex inside ${d.id} desktop`);
    for(const inverse of monitorInverse) {
      const local=point.clone().applyMatrix4(inverse);
      assert(!(Math.abs(local.x)<.54 && Math.abs(local.y)<.2 && Math.abs(local.z)<.043),`${tool}: no tool vertex inside ${d.id} monitor`);
    }
  }
  clearCases++;
}
console.log(`Toy furniture clearance PASS (${clearCases} rendered-model/desk/camera combinations)`);
