import { walkFixtures } from './sceneryModel';
import { furnitureFootprints, navigationBounds, type Footprint } from '../../layout/zones';

export type WalkPoint = { x: number; z: number };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Circle vs oriented furniture, with small swept steps to prevent tunnelling while running. */
export function resolveWalkMove(from: WalkPoint, delta: WalkPoint, radius = 0.35, footprints: readonly Footprint[] = [...furnitureFootprints, ...walkFixtures], south = navigationBounds.z[1] as number): WalkPoint {
  const next = { ...from };
  const steps = Math.max(1, Math.ceil(Math.hypot(delta.x, delta.z) / 0.09));
  const bound = () => {
    next.x = clamp(next.x, navigationBounds.x[0] + radius, navigationBounds.x[1] - radius);
    next.z = clamp(next.z, navigationBounds.z[0] + radius, south - radius);
  };
  for (let step = 0; step < steps; step++) {
    next.x += delta.x / steps; next.z += delta.z / steps; bound();
    for (let pass = 0; pass < 3; pass++) for (const f of footprints) {
      const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
      const dx = next.x - f.position[0], dz = next.z - f.position[1];
      let x = dx * c - dz * s, z = dx * s + dz * c;
      if (f.radius !== undefined) {
        const distance = Math.hypot(x, z), overlap = f.radius + radius - distance;
        if (overlap <= 0) continue;
        if (distance < 1e-8) x = f.radius + radius + 0.001;
        else { x *= (distance + overlap + 0.001) / distance; z *= (distance + overlap + 0.001) / distance; }
      } else {
        const qx = clamp(x, -f.half[0], f.half[0]), qz = clamp(z, -f.half[1], f.half[1]);
        const nx = x - qx, nz = z - qz, distance = Math.hypot(nx, nz);
        if (distance >= radius) continue;
        if (distance > 1e-8) { x += nx / distance * (radius - distance + 0.001); z += nz / distance * (radius - distance + 0.001); }
        else if (f.half[0] - Math.abs(x) < f.half[1] - Math.abs(z)) x = (x < 0 ? -1 : 1) * (f.half[0] + radius + 0.001);
        else z = (z < 0 ? -1 : 1) * (f.half[1] + radius + 0.001);
      }
      next.x = f.position[0] + x * c + z * s;
      next.z = f.position[1] - x * s + z * c;
    }
    bound();
  }
  return next;
}
