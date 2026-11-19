import { chairmanFurniture, chairmanParts, chairmanWalls } from './chairman';
export type Point = readonly [number, number];
export type DeskAnchor = { id: string; position: Point; yaw: number; stand: Point; seat: Point; monitor: Point; sideMonitor: Point };
export type Zone = { id: string; name: string; rect: readonly [number, number, number, number]; anchor: Point; color: string };
// Screen fronts face the seat (-z) and the camera (+x), turned 34 degrees from +x.
export const monitorYaw = Math.PI / 2 + 0.6;
export const monitorFaceOffset = 0.075;
export const monitorFeedbackOffset = 0.03;
export const progressFillOffset = 0.03;
const desk = (id: string, x: number, z: number): DeskAnchor => ({ id, position: [x, z], yaw: 0, stand: [x, z - 1.9], seat: [x, z - 0.94], monitor: [x - 0.16, z + 0.24], sideMonitor: [x - 0.62, z + 0.02] });
export const zones = [
  { id: 'A', name: 'Chairman’s Office', rect: [-18, -9, -14, -3], anchor: [-13.5, -3.2], color: '#E0A458' },
  { id: 'B', name: 'Production Studio', rect: [-7, 7, -14, -3], anchor: [0, -3.2], color: '#B5D3A7' },
  { id: 'C', name: 'Collaboration Zone', rect: [-7, 7, 1, 13], anchor: [0, 1.6], color: '#AFCFE6' },
  { id: 'D', name: 'Testing Lab', rect: [9, 18, -14, -3], anchor: [13.5, -2.6], color: '#CDBFE6' },
  { id: 'E', name: 'Release Gallery', rect: [9, 18, 1, 14], anchor: [13.5, 3.2], color: '#F7DC8A' },
  { id: 'F', name: 'Portal Plaza', rect: [24, 44, -26, -6], anchor: [34, -12], color: '#B5D3A7' },
] as const satisfies readonly Zone[];
export const ownerDesk = desk('owner', -14.8, -10.5);
export const leadDesks = [desk('lead-1', -11.5, -5.5), desk('lead-2', -15.5, -5.5), desk('lead-3', -11, -10.5)];
export const productionPods = [
  { id: 'design', at: [-3.5, -10] as Point, prop: 'easel' }, { id: 'rules', at: [3.5, -10] as Point, prop: 'board' },
  { id: 'art', at: [-3.5, -5.5] as Point, prop: 'palette' }, { id: 'client', at: [3.5, -5.5] as Point, prop: 'monitor' },
] as const;
export const qaDesks = [desk('qa-1', 11.5, -10.5), desk('qa-2', 14.1, -10.5), desk('qa-3', 16.7, -10.5)];
export const annexDesks = Array.from({ length: 8 }, (_, i) => desk(`annex-${i}`, -16.3 + (i % 4) * 2.2, 2.7 + Math.floor(i / 4) * 3.1));
export const loungeSpots = Array.from({ length: 6 }, (_, i) => [-16 + (i % 3) * 1.5, 10.1 + Math.floor(i / 3)] as Point);
export const meetingSpots = Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4; return [Math.cos(a) * 2.7, 6 + Math.sin(a) * 2.7] as Point; });
export const meetingTable = { position: [0, 6] as Point, radius: 1.8 };
export const displayFrames = [
  ...Array.from({ length: 4 }, (_, i) => ({ id: `south-${i}`, position: [10.9 + i * 1.9, 1.6] as Point, yaw: 0 })),
  ...Array.from({ length: 5 }, (_, i) => ({ id: `west-${i}`, position: [9.6, 3.1 + i * 1.9] as Point, yaw: Math.PI / 2 })),
];
export const portalBooths = Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4; return [34 + Math.cos(a) * 7, -16 + Math.sin(a) * 7] as Point; });
export const playerSpawnRing = Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4; return [34 + Math.cos(a) * 4, -16 + Math.sin(a) * 4] as Point; });
export const windows = [[-14, -13.85], [-8, -13.85], [10.5, -13.85], [-17.85, -10], [-17.85, -3]] as const;
export const portalDesk = desk('counter', 16.5, 12.5);
export const allDesks = [portalDesk, ownerDesk, ...leadDesks, ...qaDesks, ...annexDesks];

export const productionDesks = productionPods.flatMap(p => [desk(`${p.id}-1`, p.at[0] - 1, p.at[1]), desk(`${p.id}-2`, p.at[0] + 1, p.at[1])]);
export const desks = [...allDesks, ...productionDesks];
export const studio = { size: [36, 0.4, 28], center: [0, -0.2, 0], wallHeight: 3.6 } as const;
export const portalPath: readonly Point[] = [[18, -1], [23, -1], [27, -6], [30, -11], [34, -16]];
export const anchors = {
  bookshelf: [-10.5, -13.6], taskBoard: [0, -13.8], whiteboard: [-4.8, 8.8],
  labBench: [15, -7.5], scanner: [11.3, -7.5], arcade: [14, 8], counter: [16.5, 12.5],
  sofa: [-14.5, 12.4], coffee: [-17, 9], gate: [25, -3],
} as const satisfies Record<string, Point>;
export const funProps = { server: [-6.3, 3.6], aquarium: [1.6, 12], pingPong: [-3.2, 2.2], fan: [0, 0], board: [16, -13.65] } as const satisfies Record<string, Point>;
export const activitySpots = { 'ping-left': [-5.4, 2.2], 'ping-right': [-1, 2.2], cat: [-12.8, 10.1], 'plant-water': [5.5, 10.95] } as const satisfies Record<string, Point>;
export const catAnchors = { 'cat-perch': [-12.8, 10.95] } as const satisfies Record<string, Point>;
export const pen = { rect: [10, 17.5, -6, -3.5] as const };
export const plants: readonly Point[] = [[-5.5, 12], [5.5, 12], [-17, -13.1], [6.3, -12], [17, 6], [-9.5, 13.2]];
export const rugs = [
  { position: [-13.4, -8] as Point, size: [8.4, 10] as Point, color: '#E0A458' },
  { position: [0, -10.4] as Point, size: [13, 5.6] as Point, color: '#B5D3A7' },
  { position: [0, -5] as Point, size: [13, 3.9] as Point, color: '#B5D3A7' },
  { position: [0, 7] as Point, size: [13, 11] as Point, color: '#AFCFE6' },
  { position: [13.7, -8.2] as Point, size: [7.7, 10] as Point, color: '#CDBFE6' },
  { position: [13.7, 7.4] as Point, size: [7.7, 12.1] as Point, color: '#F7DC8A' },
  { position: [-13.6, 10.7] as Point, size: [8, 5.6] as Point, color: '#F2B8A9' },
];
// Floor-standing additions are also navigation obstacles; wall/desktop details need no footprint.
export const oiiaSpot: Point = [-10.1, 10.6];
export const loungeProps = { snack: [-17.2, 6.7] as Point, tv: [-11.2, 8] as Point, beanbags: [[-10.8, 12.3], [-11.8, 9.2]] as readonly Point[] };
export const walkwayLanes: readonly (readonly [Point, Point])[] = [
  [[-17.5, -1], [17.7, -1]], [[-8, -13], [-8, 13.4]], [[8, -13], [8, 13.4]], [[-8, -7.75], [8, -7.75]],
];
export const laneJunctions: readonly Point[] = [[-8, -1], [8, -1], [-8, -7.75], [8, -7.75]];
export const navigationBounds = { x: [-17.7, 17.8], z: [-13.7, 13.7] } as const;
export type Footprint = { id: string; position: Point; half: Point; yaw: number; radius?: number };
export const furnitureFootprints: Footprint[] = [
  ...chairmanWalls, ...chairmanFurniture,
  { id: 'office-door', position: [-16.24, -7.5], half: [0.04, 0.55], yaw: 0 },

  { id: 'oiia-cat', position: oiiaSpot, half: [0.5, 0.5], radius: 0.5, yaw: 0 },
  { id: 'server-rack', position: funProps.server, half: [0.45, 0.4], yaw: 0 },
  { id: 'aquarium', position: funProps.aquarium, half: [1.2, 0.5], yaw: 0 },
  { id: 'ping-pong', position: funProps.pingPong, half: [1.5, 0.8], yaw: 0 },
  ...desks.flatMap(d => [
    { id: d.id, position: d.position, half: [d.id === 'owner' ? 1.55 : 0.85, d.id === 'owner' ? 0.53 : 0.44] as Point, yaw: d.yaw },
    { id: `${d.id}-chair`, position: d.seat, half: [0.39, 0.4] as Point, yaw: d.yaw },
  ]),
  { id: 'meeting-table', position: meetingTable.position, half: [1.8, 1.8], yaw: 0, radius: 1.8 },
  { id: 'sofa', position: anchors.sofa, half: [2.5, 0.65], yaw: 0 },
  { id: 'coffee', position: anchors.coffee, half: [0.5, 0.5], yaw: 0 },
  { id: 'bench', position: anchors.labBench, half: [1.4, 0.55], yaw: 0 },
  { id: 'arcade', position: anchors.arcade, half: [0.7, 0.7], yaw: 0 },
  { id: 'gallery-north', position: [13.5, 1.6], half: [4, 0.12], yaw: 0 },
  { id: 'gallery-west', position: [9.6, 6.5], half: [0.12, 5], yaw: 0 },
  { id: 'qa-partition', position: [9.2, -9], half: [0.1, 4.5], yaw: 0 },
  { id: 'pen', position: [13.75, -4.75], half: [3.75, 1.25], yaw: 0 },
  { id: 'bookshelf', position: anchors.bookshelf, half: [1.2, 0.25], yaw: 0 },
  { id: 'whiteboard', position: anchors.whiteboard, half: [1.2, 0.18], yaw: Math.PI / 2 },
  { id: 'snack-shelf', position: loungeProps.snack, half: [0.5, 0.3], yaw: 0 },
  { id: 'console-tv', position: loungeProps.tv, half: [0.9, 0.27], yaw: 0 },
  ...loungeProps.beanbags.map((p, i) => ({ id: `beanbag-${i}`, position: p, half: [0.65, 0.65] as Point, yaw: 0 })),
  { id: 'ribbon-rope', position: [14, 9.6], half: [1.2, 0.12], yaw: 0 },
  ...[-0.85, 0.85].map(dx => ({ id: `scanner-${dx}`, position: [anchors.scanner[0] + dx, anchors.scanner[1]] as Point, half: [0.125, 0.175] as Point, yaw: 0 })),
  ...plants.map((p, i) => ({ id: `plant-${i}`, position: p, half: [0.35, 0.35] as Point, yaw: 0 })),
];

export const palette = { cream: '#FFF8E7', rug: '#F6EBD3', wall: '#F1DFBC', trim: '#E9D4AE', wood: '#C99A6B', darkWood: '#A87A50', apricot: '#E0A458', butter: '#F7DC8A', sage: '#B5D3A7', sky: '#AFCFE6', rose: '#F2B8A9', lavender: '#CDBFE6', mint: '#BDE3D2', ink: '#4A3B2F' };
export const desktopHeight = 0.89;
export type Shape = 'box' | 'detail' | 'cylinder' | 'sphere' | 'screen' | 'glass' | 'rug';
export type Part = { shape: Shape; position: [number, number, number]; scale: [number, number, number]; yaw: number; color: string; zone?: string; mount?: string };
export type Label = { text: string; key: string; position: [number, number, number]; width: number; height: number; yaw: number; floor: boolean; color: string; mount?: string };
export type ArtKind = 'design' | 'rules' | 'art' | 'client' | 'qa' | 'lead' | 'owner' | 'caro' | 'uno' | 'baucua' | 'taixiu' | 'game' | 'sticky' | 'sign';
export type ArtPanel = { kind: ArtKind; position: [number, number, number]; width: number; height: number; yaw: number; text?: string; mount?: string };
export function environmentModel() {
  let mount: string | undefined;
  const parts: Part[] = [], labels: Label[] = [], artwork: ArtPanel[] = [];
  const shadows: { position: Point; size: Point }[] = [];
  const add = (shape: Shape, color: string, position: [number, number, number], scale: [number, number, number], yaw = 0, zone?: string) => parts.push({ shape, color, position, scale, yaw, ...(zone ? { zone } : {}), ...(mount ? { mount } : {}) });
  const box = (color: string, p: [number, number, number], s: [number, number, number], yaw = 0, zone?: string) => add(Math.min(...s) <= 0.04 && !zone ? 'detail' : 'box', color, p, s, yaw, zone);
  const art = (kind: ArtKind, p: [number, number, number], width: number, height: number, yaw = 0, text?: string) => artwork.push({ kind, position: p, width, height, yaw, ...(text ? { text } : {}), ...(mount ? { mount } : {}) });
  const label = (text: string, key: string, p: [number, number, number], width: number, height: number, yaw = 0) => labels.push({ text, key: `worldUi.scene.${key}`, position: p, width, height, yaw, floor: false, color: palette.ink, ...(mount ? { mount } : {}) });
  const blob = (p: Point, w: number, d: number) => shadows.push({ position: p, size: [w, d] });
  const colors = [palette.rose, palette.sky, palette.sage, palette.butter, palette.lavender, palette.mint];
  const sign = (text: string, x: number, y: number, z: number, width: number, color: string, yaw = 0) => {
    mount = `sign:${text}`;
    box(palette.darkWood, [x, y, z], [width + 0.16, 0.63, 0.1], yaw);
    box(color, [x + Math.sin(yaw) * 0.06, y, z + Math.cos(yaw) * 0.06], [width, 0.49, 0.04], yaw);
    if (text !== 'AI GAME STUDIO') art('sign', [x + Math.sin(yaw) * 0.085, y, z + Math.cos(yaw) * 0.085], width - 0.1, 0.42, yaw, text);
    mount = undefined;
  };
  // One merged static mesh for the shell; instances share one toon gradient.
  add('detail', '#F4E5CA', [0, -0.2, 0], [36, 0.4, 28], 0, 'slab');
  add('detail', palette.wood, [0, -0.37, 0], [36.25, 0.16, 28.25], 0, 'slab');
  box(palette.wall, [0, 1.8, -14], [36, 3.6, 0.2], 0, 'walls');
  box(palette.wall, [-18, 1.8, 0], [0.2, 3.6, 28], 0, 'walls');
  for (const y of [0.1, 0.9, 3.53]) {
    box(palette.wood, [0, y, -13.84], [36, 0.1, 0.12], 0, 'walls');
    box(palette.wood, [-17.84, y, 0], [0.12, 0.1, 28], 0, 'walls');
  }
  box(palette.trim, [0, 0.47, -13.88], [36, 0.8, 0.1], 0, 'walls');
  box(palette.trim, [-17.88, 0.47, 0], [0.1, 0.8, 28], 0, 'walls');
  for (let x = -17; x < 18; x += 1.5) box(palette.wood, [x, 0.48, -13.8], [0.04, 0.72, 0.06]);
  for (let z = -13; z < 14; z += 1.5) box(palette.wood, [-17.8, 0.48, z], [0.06, 0.72, 0.04]);
  // Warm alternating planks and staggered seams, all flush with the floor.
  for (let z = -13.5; z < 14; z++) {
    box(Math.round(z * 2) % 4 === 1 ? '#F8EDD9' : '#EEDFC4', [0, 0.003, z], [35.8, 0.008, 0.018]);
    for (let x = -16 + (Math.floor(z) % 2) * 2; x < 18; x += 4) box('#E8D6B7', [x, 0.004, z + 0.5], [0.015, 0.008, 0.98]);
  }
  for (const r of rugs) {
    add('rug', r.color, [r.position[0], 0.016, r.position[1]], [r.size[0], 0.024, r.size[1]], 0, 'rug');
    for (const side of [-1, 1]) box(palette.cream, [r.position[0], 0.03, r.position[1] + side * (r.size[1] / 2 - 0.14)], [r.size[0] - 0.28, 0.008, 0.035]);
  }
  box(palette.rug, [0, 0.012, -1], [36, 0.016, 1.8]);
  for (const x of [-8, 8]) box(palette.rug, [x, 0.012, 0], [1.7, 0.016, 28]);
  box(palette.rug, [0, 0.014, -7.75], [14, 0.018, 0.8]);
  for (const [x, z] of windows) {
    mount = `window:${x}:${z}`;
    const yaw = x < -17 ? Math.PI / 2 : 0;
    box(palette.cream, [x, 1.9, z], [3.9, 1.25, 0.12], yaw);
    add('glass', palette.sky, [x + (yaw ? 0.08 : 0), 1.9, z + (yaw ? 0 : 0.08)], [3.55, 1.02, 0.04], yaw);
    box(palette.cream, [x + (yaw ? 0.12 : 0), 1.9, z + (yaw ? 0 : 0.12)], [0.07, 1.08, 0.04], yaw);
  }
  mount = undefined;
  for (const [index, d] of desks.entries()) {
    const [x, z] = d.position, owner = d.id === 'owner';
    const kind: ArtKind = owner ? 'owner' : d.id.startsWith('qa') ? 'qa' : d.id.startsWith('design') ? 'design' : d.id.startsWith('rules') ? 'rules' : d.id.startsWith('art') ? 'art' : d.id.startsWith('client') ? 'client' : 'lead';
    const tint = ({ owner: palette.apricot, qa: palette.lavender, design: palette.butter, rules: palette.mint, art: palette.rose, client: palette.sky, lead: palette.sage } as const)[kind];
    const w = owner ? 3.1 : 1.7;
    box(palette.darkWood, [x, 0.72, z], [w - 0.06, 0.2, 0.84]);
    box(owner ? palette.darkWood : palette.wood, [x, desktopHeight - 0.08, z], [w, 0.16, 0.88]);
    box(tint, [x, 0.47, z + 0.29], [w - 0.18, 0.43, 0.1]);
    for (const dx of [-0.64, 0.64]) box(palette.darkWood, [x + dx, 0.36, z], [0.13, 0.7, 0.65]);
    // High backed chair is behind the agent; arms sit below the desktop.
    const [cx, cz] = d.seat;
    box(palette.ink, [cx, 0.43, cz], [0.72, 0.16, 0.72]);
    box(tint, [cx, 0.53, cz], [0.65, 0.16, 0.65]);
    box(palette.ink, [cx, 0.96, cz - 0.3], [0.66, 0.96, 0.17]);
    box(tint, [cx, 1.01, cz - 0.2], [0.53, 0.8, 0.09]);
    box(tint, [cx, 1.45, cz - 0.28], [0.49, 0.2, 0.18]);
    for (const dx of [-0.33, 0.33]) {
      box(palette.ink, [cx + dx, 0.64, cz], [0.07, 0.3, 0.09]);
      box(tint, [cx + dx, 0.77, cz + 0.02], [0.13, 0.09, 0.43]);
    }
    add('cylinder', palette.ink, [cx, 0.23, cz], [0.12, 0.4, 0.12]);
    box(palette.ink, [cx, 0.08, cz], [0.7, 0.08, 0.12]); box(palette.ink, [cx, 0.08, cz], [0.12, 0.08, 0.7]);
    for (const dx of [-0.28, 0.28]) for (const dz of [-0.28, 0.28]) add('sphere', palette.ink, [cx + dx, 0.07, cz + dz], [0.12, 0.12, 0.12]);
    // Single-sided bright faces clear the dark housing by at least 0.03 units.
    const [mx, mz] = d.monitor;
    box(palette.ink, [mx, 1.08, mz], [owner ? 1.08 : 0.78, 0.4, 0.085], monitorYaw);
    box(palette.ink, [mx, desktopHeight + 0.07, mz], [0.09, 0.14, 0.12]);
    box(palette.ink, [mx, desktopHeight + 0.0175, mz], [0.34, 0.035, 0.25]);
    art(kind, [mx + Math.sin(monitorYaw) * monitorFaceOffset, 1.08, mz + Math.cos(monitorYaw) * monitorFaceOffset], owner ? 0.98 : 0.7, 0.32, monitorYaw);
    const [tx, tz] = d.sideMonitor;
    box(palette.ink, [tx, 1.07, tz], [0.64, 0.36, 0.075], monitorYaw);
    box(palette.ink, [tx, desktopHeight + 0.06, tz], [0.1, 0.12, 0.15]);
    art(kind, [tx + Math.sin(monitorYaw) * monitorFaceOffset, 1.07, tz + Math.cos(monitorYaw) * monitorFaceOffset], 0.56, 0.28, monitorYaw);
    // Keyboard, keys, mouse pad and mouse.
    box(palette.ink, [x + 0.05, desktopHeight + 0.0175, z - 0.23], [0.6, 0.035, 0.2]);
    for (let row = 0; row < 3; row++) for (let col = 0; col < 7; col++) box(row === 2 ? tint : palette.cream, [x - 0.18 + col * 0.075, desktopHeight + 0.042, z - 0.29 + row * 0.06], [0.053, 0.014, 0.036]);
    box(tint, [x + 0.52, desktopHeight + 0.01, z - 0.22], [0.25, 0.02, 0.27]);
    add('sphere', palette.cream, [x + 0.52, desktopHeight + 0.055, z - 0.22], [0.11, 0.07, 0.15]);
    // Lamp, mug (dark coffee inset), tiny bear figurine and cable tray.
    add('cylinder', palette.ink, [x + 0.65, desktopHeight + 0.015, z + 0.23], [0.17, 0.03, 0.17]);
    box(palette.apricot, [x + 0.65, 1.08, z + 0.23], [0.045, 0.34, 0.045]);
    add('sphere', palette.butter, [x + 0.65, 1.25, z + 0.18], [0.25, 0.14, 0.24]);
    add('cylinder', palette.cream, [x - 0.34, desktopHeight + 0.085, z + 0.28], [0.13, 0.17, 0.13]);
    add('cylinder', palette.darkWood, [x - 0.34, desktopHeight + 0.174, z + 0.28], [0.096, 0.008, 0.096]);
    box(palette.cream, [x - 0.43, desktopHeight + 0.085, z + 0.28], [0.07, 0.09, 0.04]);
    add('sphere', tint, [x + 0.4, 0.98, z + 0.26], [0.14, 0.18, 0.13]);
    add('sphere', tint, [x + 0.4, 1.09, z + 0.26], [0.15, 0.14, 0.13]);
    for (const dx of [-0.055, 0.055]) add('sphere', tint, [x + 0.4 + dx, 1.15, z + 0.26], [0.065, 0.065, 0.06]);
    for (const dx of [-0.03, 0.03]) add('sphere', palette.ink, [x + 0.4 + dx, 1.1, z + 0.324], [0.018, 0.018, 0.015]);
    box(palette.ink, [x, 0.59, z + 0.2], [0.65, 0.07, 0.16]);
    for (const dx of [-0.2, 0, 0.2]) box(tint, [x + dx, 0.66, z + 0.28], [0.035, 0.13, 0.035]);
    if (index % 4 === 0) {
      add('cylinder', palette.cream, [x - 0.65, desktopHeight + 0.085, z - 0.29], [0.15, 0.17, 0.15]);
      add('sphere', palette.sage, [x - 0.65, 1.11, z - 0.29], [0.21, 0.22, 0.21]);
    }
    blob([x, z - 0.25], 2.25, 2.6);
    if (owner) {
      box(palette.cream, [x - 0.7, desktopHeight + 0.1, z + 0.25], [0.48, 0.2, 0.06]);
      label('You', 'owner', [x - 0.7, desktopHeight + 0.1, z + 0.285], 0.42, 0.16);
      add('cylinder', palette.ink, [x + 0.86, 0.98, z - 0.26], [0.12, 0.16, 0.12]);
      add('screen', palette.mint, [x + 0.86, 1.09, z - 0.26], [0.13, 0.08, 0.13]);
    }
  }
  // Open bookshelves with recognisable game boxes, spines and controllers.
  const shelf = (x: number, z: number, width: number, snack = false) => {
    box(palette.darkWood, [x, 0.9, z - 0.24], [width, 1.8, 0.08]);
    for (const dx of [-width / 2, width / 2]) box(palette.wood, [x + dx, 0.9, z], [0.1, 1.8, 0.5]);
    for (const y of [0.12, 0.68, 1.24, 1.8]) {
      box(palette.wood, [x, y, z], [width, 0.08, 0.54]);
      if (y > 1.7) continue;
      for (let i = 0; i < (snack ? 3 : 6); i++) {
        const dx = -width * 0.37 + i * width * (snack ? 0.36 : 0.145);
        box(colors[i % colors.length]!, [x + dx, y + 0.23, z], [snack ? 0.19 : 0.2, 0.36, 0.32]);
        box(palette.cream, [x + dx, y + 0.25, z + 0.17], [0.1, 0.045, 0.015]);
      }
    }
    if (!snack) {
      add('sphere', palette.ink, [x, 1.94, z], [0.45, 0.18, 0.25]);
      for (const dx of [-0.12, 0.12]) add('sphere', palette.cream, [x + dx, 2.015, z + 0.04], [0.06, 0.03, 0.06]);
    }
  };
  shelf(...anchors.bookshelf, 2.4); shelf(...loungeProps.snack, 1, true);
  // Task board is above the far desks; no freestanding slabs between pods.
  mount = 'task-board';
  box(palette.wood, [0, 1.53, -13.72], [10.8, 1.35, 0.16]);
  for (let i = 0; i < 5; i++) {
    const x = -4.3 + i * 2.15;
    box(palette.cream, [x, 1.53, -13.62], [2.02, 1.16, 0.04]);
    label(['To do', 'In progress', 'In review', 'Failed', 'Done'][i]!, ['backlog', 'working', 'review', 'error', 'done'][i]!, [x, 1.96, -13.585], 1.85, 0.22);
    // Neutral blank sticky notes are decoration, not invented task status.
    for (let j = 0; j < 3; j++) box(colors[(i + j) % colors.length]!, [x - 0.58 + j * 0.58, 1.48 - (j % 2) * 0.25, -13.58], [0.37, 0.28, 0.015]);
  }
  mount = undefined;
  sign('AI GAME STUDIO', 0, 2.93, -13.7, 5.2, palette.mint);
  // Soft string lights follow the north wall, below its crown trim.
  box(palette.ink, [0, 3.31, -13.64], [35, 0.025, 0.025]);
  for (let i = 0; i < 31; i++) {
    const x = -17 + i * 1.12, drop = 0.05 + (i % 4) * 0.04;
    box(palette.ink, [x, 3.31 - drop / 2, -13.64], [0.018, drop, 0.018]);
    add('screen', colors[i % colors.length]!, [x, 3.25 - drop, -13.64], [0.11, 0.13, 0.11]);
  }
  const posterKinds = ['caro', 'uno', 'baucua', 'taixiu'] as const;
  for (let i = 0; i < 4; i++) {
    const z = [-6.5, 0, 3.7, 7.1][i]!; mount = `game-poster:${i}`;
    box(palette.darkWood, [-17.73, 1.82, z], [1.65, 1.25, 0.1], Math.PI / 2);
    art(posterKinds[i]!, [-17.65, 1.82, z], 1.49, 1.09, Math.PI / 2);
  }
  mount = undefined;
  add('cylinder', palette.wood, [0, 0.82, 6], [meetingTable.radius * 2, 0.18, meetingTable.radius * 2]);
  add('cylinder', palette.darkWood, [0, 0.4, 6], [0.65, 0.8, 0.65]); blob([0, 6], 4.8, 4.8);
  for (const [dx, dz] of [[-0.7, 0], [0.3, -0.5], [0.5, 0.5]]) {
    box(palette.cream, [dx!, 0.93, 6 + dz!], [0.5, 0.025, 0.36]);
    box(palette.rose, [dx! + 0.1, 0.95, 6 + dz!], [0.12, 0.01, 0.12]);
  }
  const [wx, wz] = anchors.whiteboard;
  // Board faces +x: readable from the table and the isometric camera.
  mount = 'whiteboard';
  box(palette.wood, [wx, 1.18, wz], [2.4, 1.3, 0.15], Math.PI / 2);
  for (const dz of [-0.8, 0.8]) { box(palette.darkWood, [wx, 0.44, wz + dz], [0.15, 0.88, 0.1]); box(palette.darkWood, [wx, 0.08, wz + dz], [0.55, 0.12, 0.16]); }
  art('sticky', [wx + 0.11, 1.18, wz], 2.2, 1.1, Math.PI / 2);
  mount = undefined;
  add('glass', palette.sky, [9.2, 0.65, -9], [0.14, 1.3, 9]);
  for (const z of [-13.4, -9, -4.6]) box(palette.cream, [9.2, 0.7, z], [0.23, 1.4, 0.23]);
  const [lx, lz] = anchors.labBench;
  box(palette.cream, [lx, 0.45, lz], [2.8, 0.9, 1.1]); box(palette.lavender, [lx, 0.95, lz], [3, 0.12, 1.2]);
  box(palette.ink, [lx - 0.3, 1.3, lz], [1.4, 0.6, 0.1]);
  box(palette.ink, [lx - 0.3, 1.08, lz], [0.1, 0.18, 0.1]);
  art('game', [lx - 0.3, 1.3, lz + 0.08], 1.25, 0.48);
  box(palette.ink, [lx + 0.95, 1.25, lz + 0.1], [0.28, 0.52, 0.07]);
  art('game', [lx + 0.95, 1.25, lz + 0.17], 0.22, 0.43);
  add('sphere', palette.cream, [lx + 0.95, 1.02, lz + 0.15], [0.035, 0.035, 0.02]); blob(anchors.labBench, 3.6, 2);
  const [ax, az] = anchors.scanner;
  for (const dx of [-0.85, 0.85]) {
    box(palette.lavender, [ax + dx, 0.9, az], [0.25, 1.8, 0.35]);
    add('screen', palette.mint, [ax + dx, 0.95, az + 0.19], [0.07, 1.5, 0.025]);
  }
  box(palette.lavender, [ax, 1.85, az], [1.95, 0.25, 0.35]);
  add('screen', palette.mint, [ax, 1.85, az + 0.19], [1.65, 0.06, 0.025]);
  const [px0, px1, pz0, pz1] = pen.rect;
  for (const z of [pz0, pz1]) box(palette.wood, [(px0 + px1) / 2, 0.43, z], [px1 - px0, 0.09, 0.12]);
  for (const x of [px0, px1]) box(palette.wood, [x, 0.43, (pz0 + pz1) / 2], [0.12, 0.09, pz1 - pz0]);
  for (let x = px0; x <= px1; x += 0.75) for (const z of [pz0, pz1]) box(palette.darkWood, [x, 0.27, z], [0.12, 0.54, 0.12]);
  sign('Bug pen', 13.7, 0.76, -3.47, 1.8, palette.lavender);
  // Gallery frames remain empty until real game art is supplied by the data layer.
  box(palette.wall, [13.5, 1.7, 1.6], [8, 3.4, 0.18]); box(palette.wall, [9.6, 1.4, 6.5], [0.18, 2.8, 10]);
  for (const f of displayFrames) {
    mount = `gallery:${f.id}`;
    const [x, z] = f.position, nx = Math.sin(f.yaw), nz = Math.cos(f.yaw);
    box(palette.darkWood, [x + nx * 0.14, 1.43, z + nz * 0.14], [1.6, 1.2, 0.12], f.yaw);
    box(palette.cream, [x + nx * 0.21, 1.43, z + nz * 0.21], [1.4, 1, 0.04], f.yaw);
    box(palette.butter, [x + nx * 0.24, 0.67, z + nz * 0.24], [1.16, 0.22, 0.05], f.yaw);
    label('Empty space', 'empty', [x + nx * 0.275, 0.67, z + nz * 0.275], 1.04, 0.17, f.yaw);
    box(palette.ink, [x + nx * 0.3, 2.53, z + nz * 0.3], [0.1, 0.1, 0.5], f.yaw);
    add('cylinder', palette.ink, [x + nx * 0.52, 2.44, z + nz * 0.52], [0.2, 0.22, 0.2]);
    add('screen', palette.butter, [x + nx * 0.52, 2.32, z + nz * 0.52], [0.16, 0.025, 0.16]);
  }
  mount = undefined;
  const [gx, gz] = anchors.arcade;
  box(palette.darkWood, [gx, 0.17, gz], [2, 0.34, 2]); box(palette.butter, [gx, 0.35, gz], [1.9, 0.06, 1.9]);
  box(palette.lavender, [gx, 1.04, gz], [1.15, 1.35, 1]);
  box(palette.ink, [gx, 1.42, gz + 0.54], [0.91, 0.66, 0.08]);
  mount = 'arcade-screen';
  art('game', [gx, 1.42, gz + 0.61], 0.77, 0.51);
  mount = undefined;
  box(palette.rose, [gx, 1.04, gz + 0.65], [1.1, 0.12, 0.46]);
  box(palette.ink, [gx - 0.25, 1.16, gz + 0.68], [0.035, 0.2, 0.035]);
  add('sphere', palette.apricot, [gx - 0.25, 1.27, gz + 0.68], [0.12, 0.12, 0.12]);
  for (const dx of [0.1, 0.26, 0.42]) add('cylinder', palette.butter, [gx + dx, 1.12, gz + 0.73], [0.09, 0.04, 0.09]);
  sign('PLAY', gx, 2.1, gz + 0.3, 1.02, palette.mint); blob(anchors.arcade, 2.8, 2.8);
  for (const dx of [-1.2, 1.2]) { add('cylinder', palette.apricot, [gx + dx, 0.42, 9.6], [0.07, 0.8, 0.07]); add('sphere', palette.butter, [gx + dx, 0.85, 9.6], [0.16, 0.16, 0.16]); add('cylinder', palette.ink, [gx + dx, 0.055, 9.6], [0.3, 0.08, 0.3]); }
  box(palette.rose, [gx, 0.72, 9.6], [2.4, 0.065, 0.065]);
  const [cx, cz] = anchors.sofa;
  box(palette.rose, [cx, 0.46, cz], [5, 0.62, 1.3]); box(palette.rose, [cx, 0.95, cz + 0.5], [5, 0.65, 0.3]);
  for (const dx of [-2.3, 2.3]) box(palette.rose, [cx + dx, 0.8, cz], [0.35, 0.6, 1.4]);
  for (const dx of [-1.25, 0, 1.25]) box(palette.butter, [cx + dx, 0.8, cz - 0.15], [0.8, 0.32, 0.5]); blob(anchors.sofa, 6, 2.3);
  for (const [i, p] of loungeProps.beanbags.entries()) { add('sphere', colors[i + 3]!, [p[0], 0.35, p[1]], [1.3, 0.7, 1.3]); add('sphere', colors[i + 3]!, [p[0], 0.62, p[1] + 0.27], [0.85, 0.64, 0.8]); blob(p, 1.6, 1.6); }
  const [tvx, tvz] = loungeProps.tv;
  box(palette.wood, [tvx, 0.34, tvz], [1.8, 0.68, 0.54]);
  mount = 'tv';
  box(palette.ink, [tvx, 1.25, tvz], [1.72, 0.94, 0.1]); art('game', [tvx, 1.25, tvz + 0.08], 1.56, 0.78);
  mount = undefined;
  box(palette.cream, [tvx + 0.42, 0.76, tvz + 0.12], [0.34, 0.15, 0.25]);
  add('sphere', palette.ink, [tvx - 0.46, 0.75, tvz + 0.12], [0.34, 0.11, 0.2]);
  for (const dx of [-0.08, 0.08]) add('sphere', palette.rose, [tvx - 0.46 + dx, 0.8, tvz + 0.14], [0.04, 0.025, 0.04]);
  const [fx, fz] = anchors.coffee;
  box(palette.wood, [fx, 0.46, fz], [1, 0.92, 1]); box(palette.ink, [fx, 1.2, fz], [0.7, 0.6, 0.65]);
  box(palette.cream, [fx, 1.08, fz + 0.35], [0.42, 0.3, 0.12]);
  add('cylinder', palette.cream, [fx, 0.97, fz + 0.4], [0.17, 0.18, 0.17]);
  add('screen', palette.mint, [fx + 0.22, 1.36, fz + 0.34], [0.08, 0.06, 0.025]);
  for (const [i, [x, z]] of plants.entries()) {
    add('cylinder', i % 2 ? palette.cream : palette.apricot, [x, 0.24, z], [0.6, 0.48, 0.6]);
    add('cylinder', palette.darkWood, [x, 0.49, z], [0.5, 0.025, 0.5]);
    blob([x, z], 1.3, 1.3);
  }
  // Mounted signs have no posts in the walking lanes.
  // The office door plate replaces the former wall-wide owner sign.
  sign(zones[1].name, 7, 2.93, -13.71, 4.4, palette.sage);
  sign(zones[2].name, wx, 2.2, wz, 3, palette.sky, Math.PI / 2);
  for (const dz of [-1, 1]) box(palette.darkWood, [wx, 1.95, wz + dz], [0.06, 0.5, 0.06]);
  sign(zones[3].name, 13.7, 2.93, -13.71, 4.5, palette.lavender);
  sign(zones[4].name, 13.5, 3.05, 1.75, 4.5, palette.butter);
  sign('Annex', -17.68, 2.85, 2.8, 3, palette.sage, Math.PI / 2);
  sign('Lounge', -17.68, 2.85, 10.6, 3, palette.rose, Math.PI / 2);
  add('cylinder', palette.sage, [34, -0.25, -16], [20, 0.5, 20]); add('cylinder', palette.rug, [34, 0.015, -16], [12, 0.035, 12]);
  for (let i = 1; i < portalPath.length; i++) { const a = portalPath[i - 1]!, b = portalPath[i]!; box(palette.rug, [(a[0] + b[0]) / 2, -0.03, (a[1] + b[1]) / 2], [2, 0.12, Math.hypot(b[0] - a[0], b[1] - a[1]) + 0.5], Math.atan2(b[0] - a[0], b[1] - a[1])); }
  for (const dx of [-1.3, 1.3]) box(palette.wood, [anchors.gate[0] + dx, 1.3, anchors.gate[1]], [0.35, 2.6, 0.4]);
  sign(zones[5].name, 25, 2.65, -3, 4.4, palette.mint);
  label('Coming soon', 'comingSoon', [25, 2.13, -2.74], 2.4, 0.26);
  return { parts: [...parts, ...chairmanParts()], labels, shadows, artwork };
}
