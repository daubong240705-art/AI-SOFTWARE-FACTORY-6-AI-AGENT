export type ZoneKey = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export const cameraPresets: Record<ZoneKey, readonly [number, number, number]> = {
  A: [-13.5, -8.5, 60], B: [0, 26, 42], C: [-8, 18, 60], D: [13.5, -8.5, 60], E: [-14, 11, 56], F: [8, 16, 52],
};
export const cameraBounds = { x: [-20, 20] as const, z: [-15, 24] as const };
export const isoDistance = 80;
export const fitZoom = (width: number, height: number, south = 24) => Math.min(width / ((south + 50) / Math.SQRT2 + 5), height / ((south + 50) / Math.sqrt(6) + 8));
