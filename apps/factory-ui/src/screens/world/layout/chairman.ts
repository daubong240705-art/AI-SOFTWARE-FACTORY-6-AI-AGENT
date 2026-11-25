import type { Footprint, Part, Point } from './zones';
// Fixtures share their geometry with navigation, camera obstruction and the wall audit.
// The south doorway is 1.8 units wide; no worker desk is removed.
export const chairmanChair: Point = [-14.8, -11.44];
export const chairmanExit: Point = [-14.0, -12.35];
export const chairmanWalls = [
  { id: 'office-east', position: [-12.25, -10.9], half: [0.06, 2.8], yaw: 0 },
  { id: 'office-south-west', position: [-17, -8.1], half: [0.7, 0.06], yaw: 0 },
  { id: 'office-south-east', position: [-13.4, -8.1], half: [1.15, 0.06], yaw: 0 },
] satisfies Footprint[];
export const chairmanFurniture = [
  { id: 'office-sofa', position: [-16.9, -8.7], half: [0.7, 0.42], yaw: 0 },
  { id: 'office-trophies', position: [-12.65, -12.25], half: [0.24, 0.75], yaw: 0 },
  { id: 'office-books', position: [-12.65, -8.7], half: [0.24, 0.58], yaw: 0 },
] satisfies Footprint[];
export type OfficeSurface = { id: string; position: [number, number, number]; width: number; height: number; yaw: number };
export const chairmanSurfaces: OfficeSurface[] = [
  ...[-12.5, -10.75, -9].map((z, i) => ({ id: `office-tv-${i}`, position: [-12.47, 2.55, z] as [number, number, number], width: 1.45, height: 0.85, yaw: -Math.PI / 2 })),
  { id: 'office-photo', position: [-16.7, 3, -13.6], width: 1.35, height: 0.65, yaw: 0 },
  { id: 'office-whiteboard', position: [-14.9, 3.14, -13.6], width: 1.55, height: 0.65, yaw: 0 },
  { id: 'office-clock', position: [-12.9, 3, -13.6], width: 0.5, height: 0.5, yaw: 0 },
  { id: 'office-door-plate', position: [-13.5, 2.55, -8.02], width: 1.6, height: 0.3, yaw: 0 },
];
export function chairmanParts(): Part[] {
  const parts: Part[] = [];
  const box = (color: string, position: Part['position'], scale: Part['scale'], yaw = 0, mount?: string, shape: Part['shape'] = 'detail') => parts.push({ color, position, scale, yaw, shape, ...(mount ? { mount } : {}) });
  for (const wall of chairmanWalls) {
    const [x, z] = wall.position, [hx, hz] = wall.half;
    box('#BDE3D2', [x, 1.5, z], [hx * 2, 3, hz * 2], 0, undefined, 'glass');
    for (const y of [0.08, 3.02]) box('#8B7961', [x, y, z], [hx * 2 + 0.03, 0.08, hz * 2 + 0.03]);
    for (const side of [-1, 1]) box('#8B7961', [x + (hx > hz ? side * hx : 0), 1.5, z + (hz > hx ? side * hz : 0)], [0.08, 3, 0.08]);
  }
  // Open glass door angled outward from the west jamb, clear of the walking opening.
  box('#AFCFE6', [-16.24, 1.2, -7.5], [0.04, 2.4, 1.1], 0, undefined, 'glass');
  box('#E0A458', [-16.2, 1.2, -7.05], [0.12, 0.08, 0.12]);
  for (const dx of [-1.18, 1.18]) box('#644330', [-14.8 + dx, 0.36, -10.5], [0.55, 0.72, 0.9]);
  // Black leather chair upholstery supplements the existing swivel chair.
  box('#302B29', [-14.8, 1.02, -11.73], [0.79, 1.12, 0.2]);
  box('#433832', [-14.8, 0.58, -11.44], [0.76, 0.18, 0.72]);
  // Sofa and low side table in the corner.
  box('#527C69', [-16.9, 0.45, -8.7], [1.4, 0.55, 0.84]);
  box('#3E5C53', [-16.9, 0.86, -8.37], [1.4, 0.75, 0.18]);
  for (const dx of [-0.66, 0.66]) box('#3E5C53', [-16.9 + dx, 0.65, -8.7], [0.15, 0.6, 0.9]);
  // Bookshelf, perpendicular to the east glass.
  box('#644330', [-12.45, 0.95, -8.7], [0.08, 1.9, 1.16]);
  for (const y of [0.1, 0.7, 1.3, 1.9]) {
    box('#A87A50', [-12.65, y, -8.7], [0.5, 0.08, 1.16]);
    if (y < 1.8) for (let i = 0; i < 6; i++) box(['#AFCFE6', '#F2B8A9', '#F7DC8A'][i % 3]!, [-12.67, y + 0.27, -9.29 + i * 0.17], [0.32, 0.45, 0.12]);
  }
  for (const surface of chairmanSurfaces) box('#644330', [surface.position[0] - Math.sin(surface.yaw) * 0.08, surface.position[1], surface.position[2] - Math.cos(surface.yaw) * 0.08], [surface.width + 0.1, surface.height + 0.1, 0.08], surface.yaw, surface.id);
  // Red telephone, inbox tray and blueprint on the wider executive desktop.
  box('#A92C35', [-13.64, 0.97, -10.46], [0.47, 0.16, 0.35]);
  for (const dx of [-0.21, 0.21]) box('#DB4247', [-13.64 + dx, 1.05, -10.46], [0.12, 0.14, 0.2]);
  box('#8B7961', [-16, 0.94, -10.45], [0.56, 0.1, 0.62]);
  box('#527C86', [-15.6, 0.91, -10.25], [0.42, 0.025, 0.34]);
  box('#F7DC8A', [-15.6, 0.97, -10.25], [0.16, 0.09, 0.16], 0, undefined, 'cylinder');
  return parts;
}
