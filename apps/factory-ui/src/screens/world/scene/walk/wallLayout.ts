/** Shared physical dimensions for Walk rendering and the wall collision audit. */
export const walkPosters = Array.from({ length: 3 }, (_, slot) => ({
  position: [-11.2 + slot * 2.55, 3.12, 13.78] as [number, number, number],
  frame: [0.94, 0.72, 0.12] as [number, number, number],
  face: [0.78, 0.58] as [number, number],
  faceOffset: 0.09,
}));
export const walkWorkflow = {
  position: [4.9, 1.97, 13.78] as [number, number, number],
  frame: [3.5, 1.85, 0.12] as [number, number, number],
  face: [3.35, 1.7] as [number, number], faceOffset: 0.09,
};
export const southWindows = [[-18, -9.1], [-6.9, 2.9], [9.1, 18]] as const;
export const eastWindows = [[-14, -2.1], [0.1, 14]] as const;
export const walkWindow = { centerY: 1.895, height: 1.51, top: 2.65 };

/** Solid bay beside the south doorway: the workflow board gets real wall
 * space instead of masking the window. */
export const workflowBay = { position: [4.9, 1.8, 14] as [number, number, number], size: [4, 3.6, 0.2] as [number, number, number] };
