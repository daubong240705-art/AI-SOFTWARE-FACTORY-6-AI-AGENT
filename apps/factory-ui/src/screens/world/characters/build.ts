import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { characterResources, disposeCharacterResources, glyphMesh, glyphSprite, sharedMaterialCount, subscribeAtlas } from './resources';
import { makeReactionMarks, disposeReactionMarkAssets } from './reactionMarks';
import type { CharacterSpec } from './spec';
import { characterFeatures, faceSurface, hasFacePatch } from './features';
import type { WorldQuality } from '../scene/quality';

type Vec3 = [number, number, number];
type Parts = { solid: THREE.BufferGeometry[]; silhouette: THREE.BufferGeometry[]; open: THREE.BufferGeometry[]; closed: THREE.BufferGeometry[] };
type Cached = { solid: THREE.BufferGeometry; hull: THREE.BufferGeometry; open: THREE.BufferGeometry; closed: THREE.BufferGeometry };
const cache = new Map<string, Cached>();
const unit = new THREE.Vector3(0, 1, 0);
function part(target: THREE.BufferGeometry[], geometry: THREE.BufferGeometry, hex: string, at: Vec3, scale: Vec3 = [1, 1, 1], rotation: Vec3 = [0, 0, 0]) {
  // RoundedBoxGeometry is non-indexed; all inputs must agree before they can be merged.
  if (geometry.index) { const indexed = geometry; geometry = indexed.toNonIndexed(); indexed.dispose(); }
  geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(...scale)));
  const c = new THREE.Color(hex); const count = geometry.getAttribute('position').count; const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) c.toArray(colors, i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); target.push(geometry); return geometry;
}
function sphere(target: THREE.BufferGeometry[], hex: string, at: Vec3, scale: Vec3, rotation?: Vec3) { return part(target, new THREE.SphereGeometry(1, 20, 14), hex, at, scale, rotation); }
function box(target: THREE.BufferGeometry[], hex: string, at: Vec3, scale: Vec3, rotation?: Vec3) { return part(target, new RoundedBoxGeometry(1, 1, 1, 2, 0.12), hex, at, scale, rotation); }
function ring(target: THREE.BufferGeometry[], hex: string, at: Vec3, radius: number, tube: number, rotation: Vec3 = [0, 0, 0], arc = Math.PI * 2) { return part(target, new THREE.TorusGeometry(radius, tube, 6, 28, arc), hex, at, [1, 1, 1], rotation); }
function rod(target: THREE.BufferGeometry[], hex: string, from: Vec3, to: Vec3, radius: number) {
  const start = new THREE.Vector3(...from); const end = new THREE.Vector3(...to); const delta = end.sub(start);
  const geometry = new THREE.CylinderGeometry(radius, radius, delta.length(), 8);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(unit, delta.clone().normalize()));
  return part(target, geometry, hex, start.addScaledVector(delta, 0.5).toArray() as Vec3);
}
function silhouette(parts: Parts, geometry: THREE.BufferGeometry) { parts.silhouette.push(geometry.clone()); }
function combine(parts: THREE.BufferGeometry[]) {
  const merged = mergeGeometries(parts, false); parts.forEach(geometry => geometry.dispose());
  if (!merged) throw new Error('Character primitive geometry could not be merged');
  merged.computeBoundingSphere(); return merged;
}
/** Subdivide and project paint/frame vertices onto the same curved face as the eyes. */
function paintFace(out: THREE.BufferGeometry[], spec: CharacterSpec, shape: THREE.Shape, color: string, lift = 0.009) {
  const geometry = new THREE.ShapeGeometry(shape, 24);
  const projected: number[] = [];
  const p = geometry.getAttribute('position'); const indices = geometry.index!;
  const vertex = (a: THREE.Vector2) => projected.push(a.x, a.y, faceSurface(spec, a.x, a.y) + lift);
  // Bound the longest edge before projecting. A large, flat triangle would cut
  // through the curved head, producing missing patches despite valid vertices.
  const triangle = (a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2) => {
    const ab = a.distanceToSquared(b), bc = b.distanceToSquared(c), ca = c.distanceToSquared(a);
    if (Math.max(ab, bc, ca) <= 0.04 ** 2) { vertex(a); vertex(b); vertex(c); return; }
    if (ab >= bc && ab >= ca) {
      const mid = a.clone().add(b).multiplyScalar(0.5); triangle(a, mid, c); triangle(mid, b, c);
    } else if (bc >= ca) {
      const mid = b.clone().add(c).multiplyScalar(0.5); triangle(a, b, mid); triangle(a, mid, c);
    } else {
      const mid = c.clone().add(a).multiplyScalar(0.5); triangle(a, b, mid); triangle(mid, b, c);
    }
  };
  for (let i = 0; i < indices.count; i += 3) {
    const v = (index: number) => new THREE.Vector2(p.getX(indices.getX(index)), p.getY(indices.getX(index)));
    triangle(v(i), v(i + 1), v(i + 2));
  }
  geometry.dispose();
  const painted = new THREE.BufferGeometry(); painted.setAttribute('position', new THREE.Float32BufferAttribute(projected, 3));
  painted.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(projected.length / 3 * 2), 2)); painted.computeVertexNormals();
  part(out, painted, color, [0, 0, 0]);
}
function roundedRect(path: THREE.Path, x: number, y: number, width: number, height: number, r: number) {
  const l = x - width / 2, b = y - height / 2, h = y + height / 2, right = x + width / 2;
  path.moveTo(l + r, b); path.lineTo(right - r, b); path.quadraticCurveTo(right, b, right, b + r);
  path.lineTo(right, h - r); path.quadraticCurveTo(right, h, right - r, h);
  path.lineTo(l + r, h); path.quadraticCurveTo(l, h, l, h - r);
  path.lineTo(l, b + r); path.quadraticCurveTo(l, b, l + r, b); path.closePath();
}
function ears(spec: CharacterSpec, parts: Parts) {
  const { colors: c } = spec; const out = parts.solid;
  const features = characterFeatures(spec);
  if (spec.ears === 'none') return;
  if (spec.ears === 'crest') {
    for (const [x, y, z] of features.ears) silhouette(parts, sphere(out, c.body, [x, y, z - 0.02], [0.067, 0.1, 0.07], [0, 0, -Math.sign(x) * 0.15]));
    silhouette(parts, sphere(out, c.body, [0, 0.935, -0.02], [0.075, 0.13, 0.07]));
    return;
  }
  for (const side of [-1, 1]) {
    const [x, y] = features.ears[side < 0 ? 0 : 1]!;
    if (spec.ears === 'round') {
      silhouette(parts, sphere(out, c.body, [x, y, 0], [0.155, 0.16, 0.12]));
      sphere(out, c.accent, [x, y + 0.01, 0.1], [0.091, 0.09, 0.035]);
    } else if (spec.ears === 'long') {
      silhouette(parts, part(out, new THREE.CapsuleGeometry(0.08, 0.26, 6, 12), c.body, [x, y, 0], [1, 1, 0.8], [0, 0, side * -0.12]));
      part(out, new THREE.CapsuleGeometry(0.039, 0.23, 6, 10), c.inner, [x, y + 0.01, 0.062], [1, 1, 0.35], [0, 0, side * -0.12]);
    } else {
      const earBody = spec.code === 'DEVOPS' ? c.inner : c.body;
      silhouette(parts, part(out, new THREE.ConeGeometry(0.17, 0.35, 16), earBody, [x, y, 0], [1, 1, 0.65], [0, 0, -side * 0.18]));
      part(out, new THREE.ConeGeometry(0.105, 0.23, 16), spec.face.mask ?? c.inner, [x, y, 0.074], [1, 1, 0.25], [0, 0, -side * 0.18]);
    }
  }
}
function face(spec: CharacterSpec, parts: Parts) {
  const { colors: c, face: f } = spec; const out = parts.solid;
  const features = characterFeatures(spec);
  // The patch follows the blob surface: its upper edge sits behind the eyes, its lower edge is a broad belly.
  if (hasFacePatch(spec)) {
    sphere(out, c.belly, [0, 0.4, 0.17], [0.46, 0.345, 0.284]);
    for (const x of [-0.21, 0.21]) sphere(out, c.belly, [x, 0.52, 0.23], [0.22, 0.22, 0.245]);
  }
  if (f.mask) {
    // Grey forehead, pale lower muzzle, and a pale brow stripe above the mask.
    const muzzle = new THREE.Shape();
    muzzle.moveTo(-0.51, 0.45); muzzle.quadraticCurveTo(0, 0.75, 0.51, 0.45);
    muzzle.quadraticCurveTo(0.5, 0.1, 0.28, 0.06); muzzle.lineTo(-0.28, 0.06);
    muzzle.quadraticCurveTo(-0.5, 0.1, -0.51, 0.45);
    paintFace(out, spec, muzzle, c.body, 0.003);
    const brow = new THREE.Shape();
    brow.moveTo(-0.43, 0.61); brow.quadraticCurveTo(0, 0.88, 0.43, 0.61);
    brow.quadraticCurveTo(0, 0.76, -0.43, 0.61);
    paintFace(out, spec, brow, c.body, 0.003);
    // A connected, wide double-lobed band painted onto the curved face. The
    // previous pair of bulging spheres left eyes detached in a three-quarter view.
    const band = new THREE.Shape();
    band.moveTo(-0.47, 0.51);
    band.bezierCurveTo(-0.47, 0.62, -0.25, 0.72, -0.08, 0.61);
    band.quadraticCurveTo(0, 0.55, 0.08, 0.61);
    band.bezierCurveTo(0.25, 0.72, 0.47, 0.62, 0.47, 0.51);
    band.bezierCurveTo(0.47, 0.38, 0.25, 0.35, 0.08, 0.43);
    band.quadraticCurveTo(0, 0.49, -0.08, 0.43);
    band.bezierCurveTo(-0.25, 0.35, -0.47, 0.38, -0.47, 0.51);
    paintFace(out, spec, band, f.mask);
  }
  for (const [x, y, z] of features.eyes) {
    const side = Math.sign(x);
    sphere(parts.open, c.outline, [x, y, z], [0.044, 0.078, 0.018], [0, side * 0.2, 0]);
    part(parts.closed, new THREE.TorusGeometry(0.043, 0.009, 5, 12, Math.PI), c.outline, [x, y, z + 0.003], [1, 0.6, 0.5], [0, side * 0.2, Math.PI]);
    if (f.brows) rod(out, c.outline, [x - 0.05, y + (side < 0 ? 0.155 : 0.12), faceSurface(spec, x - 0.05, y + 0.14) + 0.014], [x + 0.05, y + (side < 0 ? 0.12 : 0.155), faceSurface(spec, x + 0.05, y + 0.14) + 0.014], 0.018);
    if (f.whiskers) for (const dy of [-0.045, 0.045]) rod(out, f.whiskers, [side * 0.39, 0.414 + dy, faceSurface(spec, 0.39, 0.414 + dy) + 0.01], [side * 0.58, 0.414 + dy * 1.6, 0.33], 0.012);
  }
  for (const [x, y, z] of features.cheeks) sphere(out, c.cheek, [x, y, z], [0.078, 0.045, 0.018], [0, Math.sign(x) * 0.5, 0]);
  if (f.mask) sphere(out, c.outline, features.nose, [0.035, 0.022, 0.018]);
  else if (f.beak) part(out, new THREE.ConeGeometry(0.038, 0.074, 4), f.beak, [0, 0.438, 0.49], [1, 1, 1], [Math.PI / 2, 0, 0]);
}
function accessories(spec: CharacterSpec, parts: Parts) {
  const { colors: c } = spec; const out = parts.solid;
  const features = characterFeatures(spec);
  for (const accessory of spec.accessories) {
    switch (accessory) {
      case 'crown': {
        const crown = new THREE.Shape();
        crown.moveTo(-0.15, 0.82); crown.lineTo(-0.19, 1.0); crown.lineTo(-0.085, 0.95);
        crown.lineTo(0, 1.055); crown.lineTo(0.085, 0.95); crown.lineTo(0.19, 1.0); crown.lineTo(0.15, 0.82); crown.closePath();
        silhouette(parts, part(out, new THREE.ExtrudeGeometry(crown, { depth: 0.1, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2, steps: 1 }), c.accent, [0, 0, -0.05]));
        break;
      }
      case 'headset': {
        silhouette(parts, part(out, new THREE.TorusGeometry(0.535, 0.028, 6, 28, Math.PI), c.dark, [0, 0.4, 0], [1, 0.82, 1]));
        const side = spec.code === 'LEAD' ? 1 : -1;
        silhouette(parts, sphere(out, c.dark, [side * 0.53, 0.47, 0.04], [0.078, 0.12, 0.095]));
        rod(out, c.dark, [side * 0.54, 0.4, 0.1], [side * 0.43, 0.26, 0.39], 0.018);
        rod(out, c.dark, [side * 0.43, 0.26, 0.39], [side * 0.16, 0.26, 0.48], 0.018);
        sphere(out, c.dark, [side * 0.16, 0.26, 0.48], [0.053, 0.027, 0.025]); break;
      }
      case 'glasses':
        for (const [x, y] of features.eyes) {
          const frame = new THREE.Shape(); roundedRect(frame, x, y, 0.25, 0.23, 0.065);
          const lens = new THREE.Path(); roundedRect(lens, x, y, 0.20, 0.18, 0.04); frame.holes.push(lens);
          paintFace(out, spec, frame, c.outline, 0.02);
        }
        rod(out, c.outline, [-0.02, 0.48, 0.449], [0.02, 0.48, 0.449], 0.015);
        for (const side of [-1, 1]) rod(out, c.outline, [side * 0.25, 0.51, faceSurface(spec, 0.25, 0.51) + 0.02], [side * 0.46, 0.54, faceSurface(spec, 0.46, 0.54) + 0.01], 0.012);
        break;
      case 'laptop':
        silhouette(parts, box(out, '#3A3F59', [0.06, 0.084, 0.5], [0.73, 0.048, 0.23]));
        silhouette(parts, box(out, '#3A3F59', [0.06, 0.24, 0.548], [0.68, 0.31, 0.046], [-0.12, 0, 0]));
        break;
      case 'brush':
        silhouette(parts, rod(out, '#D48C62', [0.29, 0.1, 0.44], [0.53, 0.4, 0.46], 0.042));
        rod(out, '#EDEEF3', [0.45, 0.3, 0.455], [0.53, 0.4, 0.46], 0.05);
        silhouette(parts, sphere(out, '#FA7298', [0.55, 0.46, 0.46], [0.09, 0.11, 0.055], [0, 0, -0.45]));
        break;
      case 'gear': {
        const center: Vec3 = [0.45, 0.245, 0.44];
        silhouette(parts, ring(out, c.accent, center, 0.113, 0.04));
        for (let i = 0; i < 8; i += 1) { const a = i * Math.PI / 4; silhouette(parts, box(out, c.accent, [center[0] + Math.cos(a) * 0.14, center[1] + Math.sin(a) * 0.14, center[2]], [0.07, 0.06, 0.06], [0, 0, a])); }
        break;
      }
      case 'magnifier':
        silhouette(parts, ring(out, c.accent, [0.45, 0.44, 0.48], 0.18, 0.035));
        sphere(out, c.inner, [0.45, 0.44, 0.478], [0.15, 0.15, 0.012]);
        rod(out, '#FBFBFB', [0.37, 0.46, 0.493], [0.43, 0.53, 0.493], 0.012);
        silhouette(parts, rod(out, '#424965', [0.45, 0.25, 0.48], [0.43, 0.12, 0.48], 0.045));
        break;
    }
  }
}
function geometryFor(spec: CharacterSpec): Cached {
  const cached = cache.get(spec.code); if (cached) return cached;
  const parts: Parts = { solid: [], silhouette: [], open: [], closed: [] };
  // One squashed mochi: clamp its lower vertices into a broad, flat resting surface. No torso or limbs.
  const body = new THREE.SphereGeometry(0.5, 28, 20); const pos = body.getAttribute('position');
  for (let i = 0; i < pos.count; i += 1) pos.setY(i, Math.max(-0.41, pos.getY(i)));
  body.computeVertexNormals();
  silhouette(parts, part(parts.solid, body, spec.face.mask ? spec.colors.inner : spec.colors.body, [0, 0.4, 0], [1.1, 0.88, 0.86]));
  ears(spec, parts); face(spec, parts); accessories(spec, parts);
  const geometries = { solid: combine(parts.solid), hull: combine(parts.silhouette), open: combine(parts.open), closed: combine(parts.closed) };
  // Shared morph lifts only the ear/hair tips; each rig owns its influence.
  for (const geometry of [geometries.solid, geometries.hull]) {
    const source = geometry.getAttribute('position'), raised = source.clone();
    for (let i = 0; i < source.count; i++) raised.setY(i, source.getY(i) + Math.max(0, source.getY(i) - 0.8) * 0.9);
    geometry.morphAttributes.position = [raised];
  }
  cache.set(spec.code, geometries); return geometries;
}
/** New group per seat; rigid geometry and all four materials are shared across codes/poses. +Z is the face direction. */
export function buildCharacter(spec: CharacterSpec, quality: WorldQuality = 'high'): THREE.Group {
  const geometries = geometryFor(spec); expandHulls(); const assets = characterResources(); const group = new THREE.Group(); group.name = `mochi-${spec.code}`;
  const solid = new THREE.Mesh(geometries.solid, assets.toon); solid.name = 'solid'; group.add(solid);
  const open = new THREE.Mesh(geometries.open, assets.toon); open.name = 'eyes-open'; group.add(open);
  const closed = new THREE.Mesh(geometries.closed, assets.toon); closed.name = 'eyes-closed'; closed.visible = false; group.add(closed);
  if (quality === 'high') {
    // Expand each vertex along its normal, preserving outlines around ears and separate accessories.
    const hull = new THREE.Mesh(geometries.hull, assets.outline); hull.name = 'outline'; group.add(hull);
  }
  if (spec.accessories.includes('laptop')) { const screen = glyphMesh('</>', 0.43, 0.18); screen.name = 'screen'; screen.position.set(0.06, 0.24, 0.575); screen.rotation.x = -0.12; group.add(screen); }
  const effects = new THREE.Group(); effects.name = 'effects'; effects.visible = false;
  for (const [index, glyph] of ['…', '!', '✦', '☁ ×', 'Zzz'].entries()) {
    const sprite = glyphSprite(glyph, glyph === '✦' ? 0.27 : 0.55, glyph === '✦' ? 0.27 : 0.25);
    sprite.name = glyph; sprite.position.set(...characterFeatures(spec).effect); sprite.visible = false; effects.add(sprite);
    if (index === 2 && quality === 'high') { const second = glyphSprite(glyph, 0.18, 0.18); second.name = 'sparkle-2'; second.position.set(...characterFeatures(spec).sparkle); second.visible = false; effects.add(second); }
  }
  group.add(effects); group.add(makeReactionMarks(spec)); return group;
}
// Bake a small normal expansion once; one inverted-hull draw, no postprocessing or extra material per character.
const outlineExpansion = 0.014;
function expandHulls() {
  for (const geometries of cache.values()) {
    if (geometries.hull.userData.expanded) continue;
    const p = geometries.hull.getAttribute('position'); const n = geometries.hull.getAttribute('normal');
    for (let i = 0; i < p.count; i += 1) p.setXYZ(i, p.getX(i) + n.getX(i) * outlineExpansion, p.getY(i) + n.getY(i) * outlineExpansion, p.getZ(i) + n.getZ(i) * outlineExpansion);
    p.needsUpdate = true; geometries.hull.computeBoundingSphere(); geometries.hull.userData.expanded = true;
  }
}
export const createCharacter = buildCharacter;
export function characterStats() { return { built: cache.size, drawCallsPerCharacter: cache.size ? 6 : 0, sharedMaterials: sharedMaterialCount() }; }
let users = 0; let disposal: ReturnType<typeof setTimeout> | undefined;
export function retainCharacterAssets(invalidate: () => void) {
  clearTimeout(disposal); users += 1; const unsubscribe = subscribeAtlas(invalidate); let released = false;
  return () => { if (released) return; released = true; unsubscribe(); users -= 1;
    if (!users) disposal = setTimeout(() => { if (!users) disposeCharacterCache(); }, 0);
  };
}
/** Only call when no rigs/labels remain. React users release automatically, including StrictMode effect replay. */
export function disposeCharacterCache() {
  for (const geometry of cache.values()) Object.values(geometry).forEach(item => item.dispose());
  cache.clear(); disposeReactionMarkAssets(); disposeCharacterResources();
}
