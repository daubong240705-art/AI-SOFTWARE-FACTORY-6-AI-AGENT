export type ZoneKey = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export const cameraPresets: Record<ZoneKey, readonly [number, number, number]> = {
  A: [-13.5, -8.5, 60], B: [0, -8.5, 52], C: [0, 6, 60], D: [13.5, -8.5, 60], E: [13.5, 7.5, 56], F: [34, -16, 40],
};
export const cameraBounds = { x: [-20, 44] as const, z: [-26, 15] as const };
export const isoDistance = 80;
export const fitZoom = (width: number, height: number) => Math.min(width / 48, height / 30);
