import * as THREE from 'three';
import type { Tool } from './store';

export const toyImpactTime = 0.68;
/** Contact anchors on the rendered meshes (the whip's last braid segment is rigid). */
export const toolContact: Record<Tool, readonly [number, number, number]> = {
  whip: [2.03, -0.15, 0], taser: [0.495, 0, 0], coffee: [0.28, 0.285, 0],
  hammer: [0.705, 0.25, 0], feather: [0.05, 0.73, 0], megaphone: [0.47, 0.05, 0], cookie: [0.395, 0, 0],
};
const rollAxis = new THREE.Vector3(0, 0, 1);
const up = new THREE.Vector3(0, 1, 0);
export function placementScratch() {
  return { matrix: new THREE.Matrix4(), center: new THREE.Vector3(), contact: new THREE.Vector3(), position: new THREE.Vector3(), normal: new THREE.Vector3(), right: new THREE.Vector3(), forward: new THREE.Vector3(), localContact: new THREE.Vector3(), rotation: new THREE.Quaternion(), basis: new THREE.Matrix4(), scale: new THREE.Vector3(), roll: new THREE.Quaternion() };
}
const smooth = (n: number) => { const x = Math.max(0, Math.min(1, n)); return x * x * (3 - 2 * x); };
/** A world-space tool transform, anchored to the live animated rig, independent
 * of its parents' yaw/squash. CameraToBody points from camera toward the worker.
 * Optional clearance lets the caller choose the camera-facing side clear of furniture. */
export function placeToy(tool: Tool, rigWorld: THREE.Matrix4, cameraToBody: THREE.Vector3, time: number, out = placementScratch(), clearance?: (direction: THREE.Vector3) => number) {
  out.center.set(0, 0.55, 0).applyMatrix4(rigWorld);
  out.forward.copy(cameraToBody).setY(0).negate();
  if (out.forward.lengthSq() < 1e-8) out.forward.set(0, 0, 1);
  out.forward.normalize();
  out.right.crossVectors(up, out.forward).normalize();
  // Approach diagonally from the camera side. Compare both shoulders rather
  // than forcing a tool through the desk when the camera crosses the worker.
  let side = -1;
  if (clearance) {
    out.normal.copy(out.forward).multiplyScalar(0.8).addScaledVector(out.right, -0.6);
    const left = clearance(out.normal);
    out.normal.copy(out.forward).multiplyScalar(0.8).addScaledVector(out.right, 0.6);
    if (clearance(out.normal) > left) side = 1;
  }
  out.normal.copy(out.forward).multiplyScalar(0.8).addScaledVector(out.right, side * 0.6).normalize();
  // Work above the keyboard: upper shoulder rather than the desk-facing belly.
  out.normal.multiplyScalar(0.8); out.normal.y = 0.6;
  out.contact.copy(out.center).addScaledVector(out.normal, 0.55);
  const enter = smooth(time / toyImpactTime), leave = smooth((time - 2.1) / 0.8);
  const reach = (1 - enter) * 1.4 + leave * 1.1;
  out.contact.addScaledVector(out.normal, reach);
  // +X is the contacting end of most models. Feather points +Y; turn its
  // shaft sideways. The hammer handle stays away from the desk as it swings.
  out.right.copy(out.normal).negate().normalize();
  out.forward.crossVectors(out.right, up).normalize();
  out.normal.crossVectors(out.forward, out.right).normalize();
  out.basis.makeBasis(out.right, out.normal, out.forward);
  out.rotation.setFromRotationMatrix(out.basis);
  const roll = tool === 'feather' ? -Math.PI / 2 : tool === 'hammer' ? -0.7 * (1 - enter) : tool === 'coffee' ? -0.35 : 0;
  out.roll.setFromAxisAngle(rollAxis, roll);
  out.rotation.multiply(out.roll);
  out.scale.setScalar(tool === 'whip' ? 0.7 : 0.72);
  out.localContact.set(...toolContact[tool]).multiply(out.scale).applyQuaternion(out.rotation);
  out.position.copy(out.contact).sub(out.localContact);
  out.matrix.compose(out.position, out.rotation, out.scale);
  return out;
}
