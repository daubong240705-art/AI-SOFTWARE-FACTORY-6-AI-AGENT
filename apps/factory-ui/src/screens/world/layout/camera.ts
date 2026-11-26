export type ZoneKey = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export const cameraPresets: Record<ZoneKey, readonly [number, number, number]> = {
  A: [-13.5, -8.5, 60], B: [0, 26, 42], C: [-8, 18, 60], D: [13.5, -8.5, 60], E: [-14, 11, 56], F: [8, 16, 52],
};
export const cameraBounds = { x: [-18, 18] as const, north: -14 };
export const isoDistance = 80;
export const fitTarget = (south: number) => [0, (south + cameraBounds.north) / 2 - 2] as const;
export const fitZoom = (width: number, height: number, south = 24) => {
  const span = 36 + south - cameraBounds.north;
  return Math.min(width / (span / Math.SQRT2 + 9), height / (span / Math.sqrt(6) + 8), 120);
};
