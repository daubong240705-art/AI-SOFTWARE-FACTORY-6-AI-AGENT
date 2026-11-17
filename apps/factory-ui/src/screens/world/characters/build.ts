import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { characterResources, disposeCharacterResources, glyphMesh, glyphSprite, sharedMaterialCount, subscribeAtlas } from './resources';
import type { CharacterSpec } from './spec';
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
function ears(spec: CharacterSpec, parts: Parts) {
  const { colors: c } = spec; const out = parts.solid;
  if (spec.ears === 'none') return;
  if (spec.ears === 'crest') {
    for (let i = 0; i < 3; i += 1) silhouette(parts, sphere(out, i === 1 ? c.body : c.accent, [(i - 1) * 0.065, 0.91 + (i === 1 ? 0.025 : 0), -0.02], [0.067, 0.13, 0.07], [0, 0, -0.35 + i * 0.2]));
    return;
  }
  for (const side of [-1, 1]) {
    const x = side * (spec.ears === 'long' ? 0.19 : 0.35);
    if (spec.ears === 'round') {
      silhouette(parts, sphere(out, c.body, [x, 0.79, 0], [0.155, 0.16, 0.12]));
      sphere(out, c.accent, [x, 0.8, 0.1], [0.091, 0.09, 0.035]);
    } else if (spec.ears === 'long') {
      silhouette(parts, part(out, new THREE.CapsuleGeometry(0.08, 0.26, 6, 12), c.body, [x, 0.91, 0], [1, 1, 0.8], [0, 0, side * -0.12]));
      part(out, new THREE.CapsuleGeometry(0.039, 0.23, 6, 10), c.inner, [x, 0.92, 0.062], [1, 1, 0.35], [0, 0, side * -0.12]);
    } else {
      const earBody = spec.code === 'DEVOPS' ? c.inner : c.body;
      silhouette(parts, part(out, new THREE.ConeGeometry(0.17, 0.35, 16), earBody, [x, 0.83, 0], [1, 1, 0.65], [0, 0, -side * 0.18]));
      part(out, new THREE.ConeGeometry(0.105, 0.23, 16), spec.face.mask ?? c.inner, [x, 0.83, 0.074], [1, 1, 0.25], [0, 0, -side * 0.18]);
    }
  }
}
function face(spec: CharacterSpec, parts: Parts) {
  const { colors: c, face: f } = spec; const out = parts.solid;
  const patch = c.belly !== c.body || Boolean(f.mask);
  const eyeZ = patch ? 0.489 : 0.419;
  // The patch follows the blob surface: its upper edge sits behind the eyes, its lower edge is a broad belly.
  if (patch) {
    sphere(out, c.belly, [0, 0.4, 0.17], [0.46, 0.345, 0.284]);
    for (const x of [-0.21, 0.21]) sphere(out, c.belly, [x, 0.52, 0.23], [0.22, 0.22, 0.245]);
  }
  if (f.mask) {
    for (const x of [-0.19, 0.19]) sphere(out, f.mask, [x, 0.56, 0.346], [0.255, 0.136, 0.13], [0, 0, x < 0 ? -0.19 : 0.19]);
  }
  for (const side of [-1, 1]) {
    const x = side * 0.145;
    sphere(parts.open, c.outline, [x, 0.55, eyeZ], [0.035, 0.074, 0.014]);
    sphere(parts.open, '#FBFBFB', [x - 0.009, 0.578, eyeZ + 0.013], [0.009, 0.014, 0.005]);
    part(parts.closed, new THREE.TorusGeometry(0.043, 0.009, 5, 12, Math.PI), c.outline, [x, 0.548, eyeZ + 0.003], [1, 0.6, 0.5], [0, 0, Math.PI]);
    if (f.cheeks) sphere(out, c.cheek, [side * 0.31, 0.408, 0.366], [0.082, 0.044, 0.019], [0, side * 0.42, 0]);
    if (f.brows) rod(out, c.outline, [x - 0.065, side < 0 ? 0.69 : 0.655, 0.338], [x + 0.065, side < 0 ? 0.655 : 0.69, 0.338], 0.014);
    if (f.whiskers) for (const dy of [-0.045, 0.045]) rod(out, f.whiskers, [side * 0.39, 0.414 + dy, 0.37], [side * 0.58, 0.414 + dy * 1.6, 0.33], 0.012);
  }
  if (f.beak) part(out, new THREE.ConeGeometry(0.038, 0.074, 4), f.beak, [0, 0.438, 0.49], [1, 1, 1], [Math.PI / 2, 0, 0]);
  else ring(out, c.outline, [0, 0.411, patch ? 0.467 : 0.438], 0.027, 0.007, [0, 0, Math.PI], Math.PI);
}
function accessories(spec: CharacterSpec, parts: Parts) {
  const { colors: c } = spec; const out = parts.solid;
  for (const accessory of spec.accessories) {
    switch (accessory) {
      case 'crown':
        silhouette(parts, part(out, new THREE.CylinderGeometry(0.17, 0.155, 0.065, 20), c.accent, [0, 0.899, 0]));
        for (let i = 0; i < 5; i += 1) { const angle = i * Math.PI * 2 / 5; silhouette(parts, part(out, new THREE.ConeGeometry(0.048, 0.16, 8), c.accent, [Math.sin(angle) * 0.13, 0.995, Math.cos(angle) * 0.13])); }
        break;
      case 'headset': {
        silhouette(parts, part(out, new THREE.TorusGeometry(0.535, 0.028, 6, 28, Math.PI), c.dark, [0, 0.4, 0], [1, 0.82, 1]));
        const side = spec.code === 'LEAD' ? 1 : -1;
        silhouette(parts, sphere(out, c.dark, [side * 0.53, 0.47, 0.04], [0.078, 0.12, 0.095]));
        rod(out, c.dark, [side * 0.54, 0.4, 0.1], [side * 0.43, 0.26, 0.39], 0.018);
        rod(out, c.dark, [side * 0.43, 0.26, 0.39], [side * 0.16, 0.26, 0.48], 0.018);
        sphere(out, c.dark, [side * 0.16, 0.26, 0.48], [0.053, 0.027, 0.025]); break;
      }
      case 'glasses':
        for (const x of [-0.16, 0.16]) ring(out, c.outline, [x, 0.546, 0.5], 0.12, 0.018);
        rod(out, c.outline, [-0.04, 0.56, 0.5], [0.04, 0.56, 0.5], 0.013);
        for (const side of [-1, 1]) rod(out, c.outline, [side * 0.28, 0.57, 0.49], [side * 0.46, 0.6, 0.25], 0.012);
        break;
      case 'laptop':
        silhouette(parts, box(out, '#3A3F59', [0.06, 0.084, 0.5], [0.58, 0.048, 0.23]));
        silhouette(parts, box(out, '#3A3F59', [0.06, 0.24, 0.548], [0.53, 0.31, 0.046], [-0.12, 0, 0]));
        break;
      case 'brush':
        silhouette(parts, rod(out, '#D48C62', [0.3, 0.1, 0.41], [0.57, 0.4, 0.43], 0.022));
        rod(out, '#EDEEF3', [0.48, 0.3, 0.425], [0.57, 0.4, 0.43], 0.03);
        silhouette(parts, sphere(out, '#FA7298', [0.59, 0.45, 0.43], [0.047, 0.1, 0.031], [0, 0, -0.45]));
        break;
      case 'gear': {
        const center: Vec3 = [0.45, 0.245, 0.44];
        silhouette(parts, ring(out, c.accent, center, 0.113, 0.04));
        for (let i = 0; i < 8; i += 1) { const a = i * Math.PI / 4; silhouette(parts, box(out, c.accent, [center[0] + Math.cos(a) * 0.14, center[1] + Math.sin(a) * 0.14, center[2]], [0.07, 0.06, 0.06], [0, 0, a])); }
        break;
      }
      case 'magnifier':
        silhouette(parts, ring(out, c.accent, [0.45, 0.44, 0.48], 0.142, 0.028));
        sphere(out, c.inner, [0.45, 0.44, 0.478], [0.116, 0.116, 0.012]);
        rod(out, '#FBFBFB', [0.39, 0.46, 0.493], [0.43, 0.51, 0.493], 0.009);
        silhouette(parts, rod(out, c.accent, [0.51, 0.31, 0.48], [0.59, 0.14, 0.48], 0.032));
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
    sprite.name = glyph; sprite.position.set(0.12, 1.25, 0); sprite.visible = false; effects.add(sprite);
    if (index === 2 && quality === 'high') { const second = glyphSprite(glyph, 0.18, 0.18); second.name = 'sparkle-2'; second.position.set(-0.4, 0.95, 0); second.visible = false; effects.add(second); }
  }
  group.add(effects); return group;
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
  cache.clear(); disposeCharacterResources();
}
