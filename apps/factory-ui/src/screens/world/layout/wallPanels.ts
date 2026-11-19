import { funProps, windows } from './zones';
export type WallPanel = { id: string; mount: string; position: [number, number, number]; width: number; height: number; yaw: number; tile: number };
export const propWallPanels: WallPanel[] = [
  { id: 'achievements', mount: 'achievements', position: [funProps.board[0], 1.85, funProps.board[1] + 0.08], width: 3.2, height: 1.08, yaw: 0, tile: 0 },
  { id: 'neon', mount: 'sign:AI GAME STUDIO', position: [0, 2.93, -13.60], width: 5, height: 0.44, yaw: 0, tile: 1 },
  ...windows.map(([x, z]) => { const yaw = x < -17 ? Math.PI / 2 : 0; return { id: `view:${x}:${z}`, mount: `window:${x}:${z}`, position: [x + (yaw ? 0.135 : 0), 1.9, z + (yaw ? 0 : 0.135)] as [number, number, number], width: 3.55, height: 1.02, yaw, tile: 2 }; }),
];
export const galleryFace = { width: 1.36, height: 0.94, y: 1.43, offset: 0.28 };
export const galleryPlate = { width: 1.17, height: 0.23, y: 0.67, offset: 0.32 };
