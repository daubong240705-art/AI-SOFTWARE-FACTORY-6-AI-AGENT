import { seatHash } from '../../../components/mascot/skins';
import type { Pose } from './spec';

export const characterPoses: Pose[] = ['idle', 'thinking', 'working', 'attention', 'success', 'error', 'resting'];
export type EffectGlyph = '…' | '!' | '✦' | '☁ ×' | 'Zzz' | null;
export type PoseFrame = {
  y: number; sx: number; sy: number; sz: number; rx: number; ry: number; rz: number;
  closed: boolean; effect: EffectGlyph; effectY: number; sparkle: number;
};
const tau = Math.PI * 2;
const positiveMod = (n: number, d: number) => ((n % d) + d) % d;
export function phaseForSeat(seat: string) {
  // Avalanche short seat names too: raw polynomial hashes of BA/FE/BE are almost identical.
  let hash = seatHash(seat);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0xffffffff * 60;
}
function pulse(t: number, start: number, duration: number, height: number) {
  const p = (t - start) / duration;
  return p > 0 && p < 1 ? Math.sin(Math.PI * p) * height : 0;
}
/** All motion is sampled from elapsed seconds. No accumulated frame deltas or random timers. */
export function samplePose(pose: Pose, elapsed: number, phase: number, still = false): PoseFrame {
  const t = still ? 0 : elapsed + phase;
  const frame: PoseFrame = { y: 0, sx: 1, sy: 1, sz: 1, rx: 0, ry: 0, rz: 0, closed: false, effect: null, effectY: 0, sparkle: 1 };
  const period = 3 + positiveMod(phase * 1.713, 3);
  frame.closed = !still && positiveMod(t + phase * 0.71, period) < 0.14;
  let breathe = still ? 0 : Math.sin(t * tau * (pose === 'resting' ? 0.14 : 0.25)) * 0.017;
  let jump = 0; let landing = 0;
  switch (pose) {
    case 'idle':
      frame.ry = still ? 0 : Math.sin(t * 0.47) * 0.09;
      frame.rz = still ? 0 : Math.sin(t * 0.7) * 0.012;
      break;
    case 'thinking':
      frame.rz = -0.12 + (still ? 0 : Math.sin(t * tau * 0.18) * 0.035);
      frame.ry = 0.06; frame.effect = '…'; break;
    case 'working':
      frame.rx = 0.12;
      frame.y = still ? 0 : (1 + Math.sin(t * tau * 2.8)) * 0.009;
      frame.rz = still ? 0 : Math.sin(t * tau * 1.4) * 0.018;
      breathe *= 0.35; break;
    case 'attention': {
      frame.effect = '!'; const cycle = positiveMod(t, 3.7);
      jump = still ? 0 : pulse(cycle, 0.16, 0.55, 0.23);
      landing = still ? 0 : pulse(cycle, 0, 0.16, 0.065) + pulse(cycle, 0.71, 0.22, 0.09);
      frame.rz = still ? -0.035 : Math.sin(t * 8) * 0.06 * (jump / 0.23);
      break;
    }
    case 'success': {
      frame.effect = '✦'; const cycle = positiveMod(t, 4.6);
      jump = still ? 0 : pulse(cycle, 0.14, 0.45, 0.19) + pulse(cycle, 0.78, 0.53, 0.27);
      landing = still ? 0 : pulse(cycle, 0, 0.14, 0.05) + pulse(cycle, 0.59, 0.19, 0.07) + pulse(cycle, 1.31, 0.22, 0.09);
      frame.rz = still ? 0.05 : Math.sin(t * 5) * 0.065;
      frame.sparkle = still ? 1 : 0.8 + Math.sin(t * 5.5) * 0.2; break;
    }
    case 'error':
      frame.sy = 0.82; frame.sx = 1.08; frame.sz = 1.04; frame.rz = 0.1; frame.rx = 0.12;
      frame.effect = '☁ ×'; breathe *= 0.4; break;
    case 'resting':
      frame.closed = true; frame.sy = 0.94; frame.sx = 1.03; frame.rz = -0.055; frame.effect = 'Zzz'; break;
  }
  frame.y += jump;
  frame.sy += breathe + jump * 0.2 - landing;
  frame.sx -= breathe * 0.5 + jump * 0.12 - landing * 0.65;
  frame.sz -= breathe * 0.5 + jump * 0.12 - landing * 0.65;
  frame.effectY = still ? 0 : Math.sin(t * 1.7) * 0.025;
  return frame;
}
export function blendPose(from: PoseFrame, to: PoseFrame, amount: number): PoseFrame {
  const a = Math.max(0, Math.min(1, amount)); const mix = (x: number, y: number) => x + (y - x) * a;
  return { y: mix(from.y, to.y), sx: mix(from.sx, to.sx), sy: mix(from.sy, to.sy), sz: mix(from.sz, to.sz),
    rx: mix(from.rx, to.rx), ry: mix(from.ry, to.ry), rz: mix(from.rz, to.rz),
    closed: a < 0.5 ? from.closed : to.closed, effect: a < 0.5 ? from.effect : to.effect,
    effectY: mix(from.effectY, to.effectY), sparkle: mix(from.sparkle, to.sparkle) };
}
// Structural input accepts layout/waypoints paths without a dependency on a layout module that the integrator owns.
export type Waypoint = readonly [x: number, z: number] | readonly [x: number, y: number, z: number] | { readonly x: number; readonly z: number; readonly y?: number };
export type HopPath = readonly Waypoint[];
export type HopSample = { position: [number, number, number]; yaw: number; squash: number; done: boolean };
export type HopMotion = { duration: number; sample: (elapsed: number) => HopSample };
function xyz(point: Waypoint): [number, number, number] {
  if ('x' in point) return [point.x, point.y ?? 0, point.z];
  return point.length === 2 ? [point[0], 0, point[1]] : [point[0], point[1], point[2]];
}
/** Build once, then sample with seconds since departure. Speed is world units/second; stops at the last waypoint. */
export function hopAlong(path: HopPath, speed: number): HopMotion {
  if (!Number.isFinite(speed) || speed <= 0) throw new RangeError('Hop speed must be positive and finite');
  const points = path.map(xyz);
  if (points.some(point => point.some(value => !Number.isFinite(value)))) throw new RangeError('Hop waypoints must be finite');
  const lengths = points.slice(1).map((point, i) => Math.hypot(point[0] - points[i]![0], point[1] - points[i]![1], point[2] - points[i]![2]));
  const distance = lengths.reduce((total, length) => total + length, 0); const duration = distance / speed;
  return { duration, sample(elapsed) {
    if (!Number.isFinite(elapsed)) throw new RangeError('Hop elapsed time must be finite');
    if (!points.length) return { position: [0, 0, 0], yaw: 0, squash: 1, done: true };
    if (elapsed >= duration || distance === 0) return { position: [...points[points.length - 1]!], yaw: 0, squash: 1, done: true };
    let remaining = Math.max(0, elapsed) * speed; let index = 0;
    while (index < lengths.length - 1 && remaining >= lengths[index]!) { remaining -= lengths[index]!; index += 1; }
    const a = points[index]!; const b = points[index + 1]!; const length = lengths[index] ?? 0; const p = length ? remaining / length : 1;
    const hops = Math.max(1, Math.ceil(length / 0.55)); const hopPhase = positiveMod(p * hops, 1);
    const lift = Math.sin(hopPhase * Math.PI); const landing = Math.exp(-(((hopPhase - 0.96) / 0.07) ** 2));
    return { position: [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p + lift * 0.12, a[2] + (b[2] - a[2]) * p],
      yaw: Math.atan2(b[0] - a[0], b[2] - a[2]), squash: 1 + lift * 0.04 - landing * 0.07, done: false };
  } };
}
