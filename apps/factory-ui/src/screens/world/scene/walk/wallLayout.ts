/** Shared physical dimensions for Walk rendering and the wall collision audit. */
export const southWindows = [[-18, -9.1], [-6.9, 2.9], [9.1, 18]] as const;
export const eastWindows = [[-14, -2.1], [0.1, 14]] as const;
export const walkWindow = { centerY: 1.895, height: 1.51, top: 2.65 };

export const southWallBay = { position: [4.9, 1.8, 14] as [number, number, number], size: [4, 3.6, 0.2] as [number, number, number] };
