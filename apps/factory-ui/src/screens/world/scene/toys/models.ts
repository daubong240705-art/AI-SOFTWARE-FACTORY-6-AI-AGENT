import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Tool } from './store';

type V = [number, number, number];
const ramp = new THREE.DataTexture(new Uint8Array([95, 175, 235, 255]), 4, 1, THREE.RedFormat);
ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;
export const toyInk = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: ramp });
export const toyOutlineInk = new THREE.MeshBasicMaterial({ color: '#362C40', side: THREE.BackSide });
export const toyGlowInk = new THREE.MeshBasicMaterial({ vertexColors: true });
function build(tool: Tool, low: boolean) {
  const parts: THREE.BufferGeometry[] = [], glow: THREE.BufferGeometry[] = [];
  const segments = low ? 8 : 20;
  function add(g: THREE.BufferGeometry, color: string, at: V = [0, 0, 0], rot: V = [0, 0, 0], luminous = false) {
    if (g.index) { const indexed = g; g = g.toNonIndexed(); indexed.dispose(); }
    g.rotateX(rot[0]).rotateY(rot[1]).rotateZ(rot[2]).translate(...at);
    const c = new THREE.Color(color), colors = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) c.toArray(colors, i);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); (luminous ? glow : parts).push(g);
  }
  const box = (c: string, at: V, size: V, roll = 0, luminous = false) => add(new THREE.BoxGeometry(...size), c, at, [0, 0, roll], luminous);
  const sphere = (c: string, at: V, size: V) => add(new THREE.SphereGeometry(0.5, segments, low ? 5 : 10).scale(...size), c, at);
  const cylinder = (c: string, at: V, radius: number, height: number, rot: V = [0, 0, 0], top = radius) => add(new THREE.CylinderGeometry(top, radius, height, segments), c, at, rot);
  const torus = (c: string, at: V, radius: number, tube: number, rot: V = [0, 0, 0], arc = Math.PI * 2) => add(new THREE.TorusGeometry(radius, tube, low ? 3 : 6, segments, arc), c, at, rot);
  const rod = (c: string, a: V, b: V, radius: number) => {
    const from = new THREE.Vector3(...a), delta = new THREE.Vector3(...b).sub(from);
    const g = new THREE.CylinderGeometry(radius, radius, delta.length(), low ? 4 : 6);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize()));
    add(g, c, from.addScaledVector(delta, 0.5).toArray() as V);
  };
  switch (tool) {
    case 'whip': {
      cylinder('#462D2C', [0, -0.26, 0], 0.085, 0.65);
      for (let i = 0; i < (low ? 6 : 15); i++) torus(i % 2 ? '#B77848' : '#79513D', [0, -0.53 + i * (low ? 0.1 : 0.04), 0], 0.083, 0.016, [Math.PI / 2, 0, 0.15]);
      cylinder('#E8B659', [0, 0.08, 0], 0.102, 0.09); sphere('#E8B659', [0, -0.61, 0], [0.18, 0.14, 0.18]);
      torus('#B77848', [0.05, -0.68, 0], 0.14, 0.022, [0, 0.4, 0]);
      // Three interwoven leather strands, baked once. The centreline is 1.9 metres long.
      for (let strand = 0; strand < (low ? 1 : 3); strand++) {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 48; i++) { const p = i / 48, a = p * 70 + strand * Math.PI * 2 / 3, r = (1 - p) * 0.022;
          pts.push(new THREE.Vector3(p * 1.85 + Math.cos(a) * r, 0.15 + Math.sin(p * Math.PI * 1.5) * 0.23 + Math.sin(a) * r, Math.sin(a) * r)); }
        add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), low ? 16 : 96, low ? 0.032 : 0.017, low ? 4 : 5, false), ['#674237', '#A56C48', '#3D2929'][strand]!);
      }
      rod('#E6C58F', [1.82, -0.08, 0], [2.03, -0.15, 0], 0.012); break;
    }
    case 'taser':
      box('#30394B', [-0.25, 0, 0], [0.7, 0.38, 0.3]); box('#F0BB35', [-0.38, -0.35, 0], [0.25, 0.46, 0.25], -0.2);
      for (let i = 0; i < 5; i++) box('#574B42', [-0.39, -0.23 - i * 0.06, 0.13], [0.19, 0.022, 0.025], -0.2);
      for (const y of [-0.135, 0.135]) { cylinder('#B6C5CE', [0.24, y, 0], 0.035, 0.4, [0, 0, Math.PI / 2]); box('#C9FFFF', [0.45, y, 0], [0.09, 0.07, 0.075], 0, true); }
      box('#101C2F', [-0.28, 0.02, 0.159], [0.37, 0.19, 0.02]);
      for (let i = 0; i < 4; i++) box('#79FFD0', [-0.4 + i * 0.08, 0.025, 0.176], [0.055, 0.105, 0.025], 0, true);
      box('#F96684', [-0.03, 0.07, 0.174], [0.07, 0.07, 0.03]); break;
    case 'coffee': {
      // Open ceramic wall, separate dark coffee surface, thick rolled lip and a real handle.
      add(new THREE.CylinderGeometry(0.29, 0.24, 0.57, segments, 1, true), '#FFF5E6');
      cylinder('#FFF5E6', [0, -0.28, 0], 0.24, 0.035); cylinder('#74432F', [0, 0.235, 0], 0.26, 0.022);
      torus('#FFFFFF', [0, 0.285, 0], 0.28, 0.035, [Math.PI / 2, 0, 0]); torus('#FFF5E6', [0.34, 0.025, 0], 0.19, 0.065);
      // A layered rosetta and cream heart, all geometry so there is no asset request.
      for (let i = 0; i < (low ? 4 : 8); i++) for (const side of [-1, 1]) sphere('#FFE6B7', [side * (0.1 - i * 0.009), 0.251, -0.12 + i * 0.033], [0.15 - i * 0.012, 0.012, 0.04]);
      rod('#FFF4D7', [0, 0.259, -0.18], [0, 0.259, 0.19], 0.011);
      sphere('#326F78', [0, -0.015, 0.252], [0.3, 0.29, 0.035]);
      box('#FFF5E6', [0, 0, 0.278], [0.035, 0.18, 0.015]); box('#FFF5E6', [0.05, 0.07, 0.278], [0.13, 0.035, 0.015]); box('#FFF5E6', [0.04, 0.01, 0.278], [0.1, 0.035, 0.015]); break;
    }
    case 'hammer':
      cylinder('#D89741', [0, -0.4, 0], 0.065, 1.15); cylinder('#775140', [0, -0.85, 0], 0.085, 0.3);
      cylinder('#ED7FAD', [0, 0.25, 0], 0.29, 1.12, [0, 0, Math.PI / 2]);
      for (const side of [-1, 1]) { cylinder('#FFE082', [side * 0.56, 0.25, 0], 0.32, 0.12, [0, 0, Math.PI / 2]); sphere('#F7B8CF', [side * 0.64, 0.25, 0], [0.13, 0.52, 0.52]); }
      for (const x of [-0.32, -0.17, 0.17, 0.32]) cylinder('#7256A3', [x, 0.25, 0], 0.296, 0.045, [0, 0, Math.PI / 2]);
      torus('#FFE082', [0, 0.25, 0.291], 0.12, 0.024); break;
    case 'feather':
      rod('#FFF2CF', [0, -0.8, 0], [0.05, 0.73, 0], 0.018);
      for (const side of [-1, 1]) for (let i = 0; i < (low ? 10 : 38); i++) {
        const p = i / (low ? 10 : 38), y = -0.38 + p * 1.12, width = Math.sin(p * Math.PI) * 0.29;
        rod(i % 3 ? '#DCB7F4' : '#F598C2', [0.025 * p, y, 0], [side * width, y + 0.19, Math.sin(i) * 0.025], low ? 0.026 : 0.012);
        if (!low) rod('#F9D8ED', [side * width * 0.3, y + 0.05, 0], [side * width, y + 0.23, 0.01], 0.006);
      } break;
    case 'megaphone':
      add(new THREE.CylinderGeometry(0.16, 0.44, 0.75, segments, 1, true), '#EA82AD', [0.05, 0.05, 0], [0, 0, Math.PI / 2]);
      cylinder('#413B59', [0.3, 0.05, 0], 0.32, 0.025, [0, 0, Math.PI / 2]);
      torus('#FFF3D8', [0.425, 0.05, 0], 0.44, 0.046, [0, Math.PI / 2, 0]);
      cylinder('#FFF3D8', [-0.36, 0.05, 0], 0.17, 0.2, [0, 0, Math.PI / 2]);
      box('#534564', [-0.25, -0.34, 0], [0.18, 0.49, 0.19], -0.2); box('#F9D371', [-0.12, -0.2, 0.11], [0.1, 0.12, 0.05]);
      for (let i = 0; i < 4; i++) box('#C4B6DF', [-0.28, -0.27 - i * 0.07, 0.1], [0.12, 0.025, 0.025]); break;
    case 'cookie':
      sphere('#CA8846', [0, 0, 0], [0.79, 0.79, 0.19]); sphere('#EBC087', [0, 0, 0.055], [0.74, 0.74, 0.13]);
      for (let i = 0; i < (low ? 9 : 21); i++) { const a = i * 2.4, r = Math.sqrt((i + 0.5) / (low ? 9 : 21)) * 0.32;
        sphere(i % 3 ? '#553329' : '#7B4930', [Math.sin(a) * r, Math.cos(a) * r, 0.12], [0.07 + i % 3 * 0.015, 0.065, 0.045]); }
      if (!low) for (let i = 0; i < 34; i++) sphere('#D49E61', [Math.sin(i * 4.1) * 0.34, Math.cos(i * 2.7) * 0.3, 0.117], [0.017, 0.017, 0.012]); break;
  }
  const merge = (items: THREE.BufferGeometry[]) => { const g = mergeGeometries(items)!; items.forEach(item => item.dispose()); g.computeBoundingSphere(); return g; };
  const solid = merge(parts), hull = solid.clone(), pos = hull.getAttribute('position'), normal = hull.getAttribute('normal');
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) + normal.getX(i) * 0.012, pos.getY(i) + normal.getY(i) * 0.012, pos.getZ(i) + normal.getZ(i) * 0.012);
  hull.computeBoundingSphere(); return { solid, hull, glow: glow.length ? merge(glow) : null };
}
const names: Tool[] = ['whip', 'taser', 'coffee', 'hammer', 'feather', 'megaphone', 'cookie'];
export const detailedToys = Object.fromEntries(names.map(name => [name, build(name, false)])) as Record<Tool, ReturnType<typeof build>>;
export const lightToys = Object.fromEntries(names.map(name => [name, build(name, true)])) as typeof detailedToys;
export const toyModels = Object.fromEntries(names.map(name => [name, detailedToys[name].solid])) as Record<Tool, THREE.BufferGeometry>;
export const clamp = (n: number) => Math.max(0, Math.min(1, n));
export const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };
export const back = (n: number) => { const t = clamp(n) - 1; return 1 + 2.7 * t * t * t + 1.7 * t * t; };
/** One shared impact clock: a 70ms held frame, followed by normal recovery. */
export function actionAge(started: number, now = Date.now()) { const age = (now - started) / 1000; return age < 0.68 ? age : age < 0.75 ? 0.68 : age - 0.07; }

/** GPU deformation keeps the leather braid and its outline together, without vertex uploads. */
export function createWhipMaterials() {
  const clock = { value: 0 };
  const solid = toyInk.clone(), outline = toyOutlineInk.clone();
  const vertex = `
    #include <begin_vertex>
    if (position.x > 0.07) {
      float along = max(0.0, position.x - 0.07);
      float windup = sin(clamp(uToyAge / 0.68, 0.0, 1.0) * 3.14159265);
      float follow = max(0.0, 1.0 - abs(uToyAge - 0.92) / 0.65);
      float wave = sin(along * 6.0 - uToyAge * 19.0);
      transformed.y += wave * along * (windup * 0.36 + follow * 0.14);
      transformed.z += cos(along * 5.0 - uToyAge * 16.0) * along * windup * 0.08;
    }`;
  for (const material of [solid, outline]) {
    material.onBeforeCompile = shader => {
      shader.uniforms.uToyAge = clock;
      shader.vertexShader = 'uniform float uToyAge;\n' + shader.vertexShader.replace('#include <begin_vertex>', vertex);
    };
    material.customProgramCacheKey = () => 'factory-braided-leather-v1';
  }
  return { solid, outline, clock };
}
export const warmWhipMaterials = createWhipMaterials();
