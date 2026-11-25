import { windows } from './zones';
export type WallPanel = { id: string; mount: string; position: [number, number, number]; width: number; height: number; yaw: number; tile: number };
export const propWallPanels: WallPanel[] = [
  { id: 'neon', mount: 'sign:FACTORY', position: [0, 2.93, -13.60], width: 5, height: 0.44, yaw: 0, tile: 1 },
  ...windows.map(([x, z]) => { const yaw = x < -17 ? Math.PI / 2 : 0; return { id: `view:${x}:${z}`, mount: `window:${x}:${z}`, position: [x + (yaw ? 0.135 : 0), 1.9, z + (yaw ? 0 : 0.135)] as [number, number, number], width: 3.55, height: 1.02, yaw, tile: 2 }; }),
];
