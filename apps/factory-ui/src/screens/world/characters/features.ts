import type { CharacterSpec } from './spec';

export type FeaturePoint = [number, number, number];
type Ellipsoid = { center: FeaturePoint; radius: FeaturePoint };
const surface = (x: number, y: number, { center: [cx, cy, cz], radius: [rx, ry, rz] }: Ellipsoid) => {
  const d = 1 - ((x - cx) / rx) ** 2 - ((y - cy) / ry) ** 2;
  return d >= 0 ? cz + rz * Math.sqrt(d) : -Infinity;
};
export const hasFacePatch = (spec: CharacterSpec) => spec.colors.belly !== spec.colors.body;
/** Exact front surface of the body and white cheek/belly primitives in build.ts. */
export function faceSurface(spec: CharacterSpec, x: number, y: number): number {
  const surfaces: Ellipsoid[] = [{ center: [0, 0.4, 0], radius: [0.55, 0.44, 0.43] }];
  if (hasFacePatch(spec)) surfaces.push(
    { center: [0, 0.4, 0.17], radius: [0.46, 0.345, 0.284] },
  );
  return Math.max(...surfaces.map(shape => surface(x, y, shape)));
}

/** All paired primitives use these same anchors, in every pose and quality. */
export function characterFeatures(spec: CharacterSpec) {
  const half = spec.code === 'BA' ? 0.13 : 0.105;
  const eyeY = spec.code === 'LEAD' ? 0.46 : spec.code === 'DEVOPS' ? 0.505 : 0.48;
  const eye = (x: number): FeaturePoint => [x, eyeY, faceSurface(spec, x, eyeY) + (spec.face.mask ? 0.016 : 0.006)];
  const cheek = (x: number): FeaturePoint => [x, eyeY - 0.065, faceSurface(spec, x, eyeY - 0.065) + 0.005];
  const earX = spec.ears === 'long' ? 0.19 : spec.ears === 'crest' ? 0.065 : 0.32;
  const earY = spec.ears === 'long' ? 0.91 : spec.ears === 'round' ? 0.79 : spec.ears === 'crest' ? 0.91 : 0.83;
  return {
    eyes: [eye(-half), eye(half)],
    cheeks: spec.face.cheeks ? [cheek(-0.28), cheek(0.28)] : [],
    ears: spec.ears === 'none' ? [] : [[-earX, earY, 0], [earX, earY, 0]] as FeaturePoint[],
    mask: { centerY: 0.535, bottom: 0.385, top: 0.65 },
    nose: [0, 0.388, faceSurface(spec, 0, 0.388) + 0.01] as FeaturePoint,
    effect: [0.54, 1.42, 0] as FeaturePoint,
    sparkle: [0.3, 1.24, 0] as FeaturePoint,
  };
}
