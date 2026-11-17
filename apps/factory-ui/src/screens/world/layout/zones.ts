export type Point = readonly [number, number];
export type DeskAnchor = { id: string; position: Point; yaw: number; stand: Point; seat: Point };
export type Zone = { id: string; name: string; rect: readonly [number, number, number, number]; anchor: Point; color: string };
const desk = (id: string, x: number, z: number, yaw = Math.PI / 4): DeskAnchor => ({ id, position: [x, z], yaw, stand: [x + 0.7, z + 1.65], seat: [x + 0.65, z + 0.65] });
export const zones = [
  { id: 'A', name: 'Phòng điều hành', rect: [-18, -9, -14, -3], anchor: [-13.5, -3.2], color: '#F2B8A9' },
  { id: 'B', name: 'Xưởng sản xuất', rect: [-7, 7, -14, -3], anchor: [0, -3.2], color: '#F7DC8A' },
  { id: 'C', name: 'Bàn cộng tác', rect: [-7, 7, 1, 13], anchor: [0, 1.6], color: '#B5D3A7' },
  { id: 'D', name: 'Phòng kiểm thử', rect: [9, 18, -14, -3], anchor: [13.5, -2.6], color: '#AFCFE6' },
  { id: 'E', name: 'Phòng trưng bày', rect: [9, 18, 1, 14], anchor: [13.5, 3.2], color: '#CDBFE6' },
  { id: 'F', name: 'Quảng trường Portal', rect: [24, 44, -26, -6], anchor: [34, -12], color: '#B5D3A7' },
] as const satisfies readonly Zone[];
export const ownerDesk = desk('owner', -14.5, -9.5);
export const leadDesks = [desk('lead-1', -11.5, -5.5), desk('lead-2', -15.5, -5.5), desk('lead-3', -11, -11.5)];
export const productionPods = [
  { id: 'design', at: [-3.5, -10] as Point, prop: 'easel' }, { id: 'rules', at: [3.5, -10] as Point, prop: 'board' },
  { id: 'art', at: [-3.5, -5.5] as Point, prop: 'palette' }, { id: 'client', at: [3.5, -5.5] as Point, prop: 'monitor' },
] as const;
export const qaDesks = [desk('qa-1', 11.5, -11), desk('qa-2', 14.5, -11), desk('qa-3', 17, -11)];
export const annexDesks = Array.from({ length: 8 }, (_, i) => desk(`annex-${i}`, -16.5 + (i % 4) * 2.2, 2.2 + Math.floor(i / 4) * 3));
export const loungeSpots = Array.from({ length: 6 }, (_, i) => [ -16 + (i % 3) * 3, 9.5 + Math.floor(i / 3) * 1.1 ] as Point);
export const meetingSpots = Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4; return [Math.cos(a) * 2.7, 6 + Math.sin(a) * 2.7] as Point; });
export const meetingTable = { position: [0, 6] as Point, radius: 1.8 };
export const displayFrames = [
  ...Array.from({ length: 4 }, (_, i) => ({ id: `south-${i}`, position: [10.9 + i * 1.9, 1.6] as Point, yaw: 0 })),
  ...Array.from({ length: 5 }, (_, i) => ({ id: `west-${i}`, position: [9.6, 3.1 + i * 1.9] as Point, yaw: Math.PI / 2 })),
];
export const portalBooths = Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4; return [34 + Math.cos(a) * 7, -16 + Math.sin(a) * 7] as Point; });
export const playerSpawnRing = Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4; return [34 + Math.cos(a) * 4, -16 + Math.sin(a) * 4] as Point; });
export const windows = [[-14, -13.85], [-8, -13.85], [-2, -13.85], [-17.85, -10], [-17.85, -3]] as const;
export const allDesks = [ownerDesk, ...leadDesks, ...qaDesks, ...annexDesks];

export const productionDesks = productionPods.flatMap(p => [desk(`${p.id}-1`, p.at[0] - 1, p.at[1]), desk(`${p.id}-2`, p.at[0] + 1, p.at[1])]);
export const desks = [...allDesks, ...productionDesks];
export const studio = { size: [36, 0.4, 28], center: [0, -0.2, 0], wallHeight: 2.6 } as const;
export const portalPath: readonly Point[] = [[18, -1], [23, -1], [27, -6], [30, -11], [34, -16]];
export const anchors = {
  bookshelf: [-10.5, -13.6], taskBoard: [0, -13.8], whiteboard: [-4.8, 8.8],
  labBench: [15, -7.5], scanner: [13.5, -6], arcade: [14, 8], counter: [16.5, 12.5],
  sofa: [-14.5, 12.4], coffee: [-17, 9], gate: [25, -3],
} as const satisfies Record<string, Point>;
export const pen = { rect: [10, 17.5, -6, -3.5] as const };
export const plants: readonly Point[] = [[-5.5, 12], [5.5, 12], [-17, -12], [6, -12], [17, 6], [-10, 12]];
export const rugs = [
  { position: [-14, -8] as Point, size: [7, 8] as Point }, { position: [-13.5, 10.5] as Point, size: [8, 5] as Point },
  { position: [0, 6] as Point, size: [8, 8] as Point },
];
export const walkwayLanes: readonly (readonly [Point, Point])[] = [
  [[-17.5, -1], [17.7, -1]], [[-8, -13], [-8, 13.4]], [[8, -13], [8, 13.4]], [[-8, -7.75], [8, -7.75]],
];
export const laneJunctions: readonly Point[] = [[-8, -1], [8, -1], [-8, -7.75], [8, -7.75]];
export const navigationBounds = { x: [-17.7, 17.8], z: [-13.7, 13.7] } as const;
export type Footprint = { id: string; position: Point; half: Point; yaw: number; radius?: number };
export const furnitureFootprints: Footprint[] = [
  ...desks.flatMap(d => [
    { id: d.id, position: d.position, half: [d.id === 'owner' ? 1.05 : 0.85, 0.44] as Point, yaw: d.yaw },
    { id: `${d.id}-chair`, position: d.seat, half: [0.3, 0.3] as Point, yaw: d.yaw },
  ]),
  { id: 'meeting-table', position: meetingTable.position, half: [1.8, 1.8], yaw: 0, radius: 1.8 },
  { id: 'sofa', position: anchors.sofa, half: [2.5, 0.65], yaw: 0 },
  { id: 'coffee', position: anchors.coffee, half: [0.5, 0.5], yaw: 0 },
  { id: 'bench', position: anchors.labBench, half: [1.4, 0.55], yaw: 0 },
  { id: 'arcade', position: anchors.arcade, half: [0.7, 0.7], yaw: 0 },
  { id: 'counter', position: anchors.counter, half: [1, 0.5], yaw: 0 },
  { id: 'gallery-north', position: [13.5, 1.6], half: [4, 0.12], yaw: 0 },
  { id: 'gallery-west', position: [9.6, 6.5], half: [0.12, 5], yaw: 0 },
  { id: 'qa-partition', position: [9.2, -9], half: [0.1, 4.5], yaw: 0 },
  { id: 'pen', position: [13.75, -4.75], half: [3.75, 1.25], yaw: 0 },
  { id: 'bookshelf', position: anchors.bookshelf, half: [1.2, 0.25], yaw: 0 },
  { id: 'whiteboard', position: anchors.whiteboard, half: [1.2, 0.18], yaw: 0 },
  ...productionPods.map(p => ({ id: `${p.id}-prop`, position: [p.at[0], p.at[1] - (p.prop === 'easel' || p.prop === 'palette' ? 1.65 : 1.5)] as Point, half: [0.45, p.prop === 'board' ? 0.45 : 0.15] as Point, yaw: 0 })),
  ...[-0.85, 0.85].map(dx => ({ id: `scanner-${dx}`, position: [anchors.scanner[0] + dx, anchors.scanner[1]] as Point, half: [0.125, 0.175] as Point, yaw: 0 })),
  ...plants.map((p, i) => ({ id: `plant-${i}`, position: p, half: [0.35, 0.35] as Point, yaw: 0 })),
];

export const palette = { cream: '#FFF8E7', rug: '#F6EBD3', wall: '#F1DFBC', trim: '#E9D4AE', wood: '#C99A6B', darkWood: '#A87A50', apricot: '#E0A458', butter: '#F7DC8A', sage: '#B5D3A7', sky: '#AFCFE6', rose: '#F2B8A9', lavender: '#CDBFE6', ink: '#4A3B2F' };
type Shape = 'box' | 'cylinder' | 'sphere' | 'screen' | 'glass';
export type Part = { shape: Shape; position: [number, number, number]; scale: [number, number, number]; yaw: number; color: string; zone?: string };
export type Label = { text: string; key: string; position: [number, number, number]; width: number; height: number; yaw: number; floor: boolean; color: string };
export function environmentModel() {
  const parts: Part[] = []; const labels: Label[] = []; const shadows: { position: Point; size: Point }[] = [];
  const add = (shape: Shape, color: string, p: [number, number, number], s: [number, number, number], yaw = 0, zone?: string) => parts.push({ shape, color, position: p, scale: s, yaw, ...(zone ? { zone } : {}) });
  const box = (color: string, p: [number, number, number], s: [number, number, number], yaw = 0, zone?: string) => add('box', color, p, s, yaw, zone);
  const label = (text: string, p: [number, number, number], w: number, h: number, floor = false, yaw = 0, color = palette.ink) => {
    const texts: Record<string, string> = { 'Bạn': 'owner', 'Chỗ trống': 'empty', 'Sắp mở': 'comingSoon', 'Chờ làm': 'backlog', 'Đang làm': 'working', 'Chờ duyệt': 'review', 'Gặp lỗi': 'error', 'Xong': 'done' };
    const zone = zones.find(zone => zone.name === text);
    labels.push({ text, key: zone ? `worldUi.scene.zones.${zone.id}` : `worldUi.scene.${texts[text]}`, position: p, width: w, height: h, floor, yaw, color });
  };
  const blob = (p: Point, w: number, d: number) => shadows.push({ position: p, size: [w, d] });
  // Static slab and back wall pieces are merged into a single vertex-coloured mesh.
  box(palette.cream, [0, -0.2, 0], [36, 0.4, 28], 0, 'slab');
  box(palette.trim, [0, -0.37, 0], [36.25, 0.16, 28.25], 0, 'slab');
  box(palette.wall, [0, 1.3, -14], [36, 2.6, 0.2], 0, 'walls');
  box(palette.wall, [-18, 1.3, 0], [0.2, 2.6, 28], 0, 'walls');
  box(palette.trim, [0, 0.45, -13.87], [36, 0.9, 0.1], 0, 'walls');
  box(palette.trim, [-17.87, 0.45, 0], [0.1, 0.9, 28], 0, 'walls');
  box(palette.trim, [0, 0.045, 13.92], [36, 0.09, 0.16], 0, 'slab');
  box(palette.trim, [17.92, 0.045, -8], [0.16, 0.09, 12], 0, 'slab');
  box(palette.trim, [17.92, 0.045, 7], [0.16, 0.09, 14], 0, 'slab');
  box(palette.rug, [0, 0.012, -1], [36, 0.02, 2]);
  for (const x of [-8, 8]) box(palette.rug, [x, 0.012, 0], [2, 0.02, 28]);
  box(palette.rug, [0, 0.014, -7.75], [14, 0.022, 0.9]);
  for (const r of rugs) box(palette.rug, [r.position[0], 0.014, r.position[1]], [r.size[0], 0.025, r.size[1]]);
  for (const [x, z] of windows) {
    const yaw = x < -17 ? Math.PI / 2 : 0;
    box(palette.cream, [x, 1.9, z], [3.9, 1.25, 0.12], yaw);
    add('glass', palette.sky, [x + (yaw ? 0.08 : 0), 1.9, z + (yaw ? 0 : 0.08)], [3.55, 1.02, 0.04], yaw);
    box(palette.cream, [x + (yaw ? 0.12 : 0), 1.9, z + (yaw ? 0 : 0.12)], [0.07, 1.08, 0.04], yaw);
  }
  for (const d of desks) {
    const [x, z] = d.position; const yaw = d.yaw;
    const local = (a: number, y: number, b: number): [number, number, number] => [x + a * Math.cos(yaw) + b * Math.sin(yaw), y, z - a * Math.sin(yaw) + b * Math.cos(yaw)];
    box(palette.wood, [x, 0.78, z], [d.id === 'owner' ? 2.1 : 1.7, 0.16, 0.88], yaw);
    for (const a of [-0.59, 0.59]) box(palette.darkWood, local(a, 0.37, 0), [0.21, 0.7, 0.62], yaw);
    box(palette.sage, [d.seat[0], 0.43, d.seat[1]], [0.62, 0.17, 0.64], yaw);
    box(palette.sage, local(0, 0.73, 1.18), [0.66, 0.56, 0.16], yaw);
    add('cylinder', palette.darkWood, [d.seat[0], 0.2, d.seat[1]], [0.14, 0.4, 0.14]);
    box(palette.ink, local(0, 1.035, -0.11), [d.id === 'owner' ? 0.96 : 0.69, 0.35, 0.1], yaw);
    add('screen', palette.sky, local(0, 1.04, -0.05), [d.id === 'owner' ? 0.87 : 0.6, 0.26, 0.025], yaw);
    box(palette.ink, local(0, 0.88, -0.11), [0.13, 0.1, 0.13], yaw);
    add('cylinder', palette.apricot, local(0.6, 0.92, 0.06), [0.055, 0.24, 0.055]);
    add('sphere', palette.butter, local(0.6, 1.05, 0.06), [0.22, 0.12, 0.22]);
    blob(d.position, 2.6, 2.4);
    if (d.id === 'owner') { box(palette.cream, local(-0.65, 0.96, 0.25), [0.42, 0.18, 0.07], yaw); label('Bạn', local(-0.65, 0.96, 0.295), 0.36, 0.14, false, yaw); }
  }
  const [sx, sz] = anchors.bookshelf;
  box(palette.darkWood, [sx, 1, sz], [2.4, 2, 0.5]);
  for (const y of [0.55, 1.15, 1.75]) {
    box(palette.wood, [sx, y, sz + 0.27], [2.25, 0.1, 0.18]);
    for (let i = 0; i < 8; i++) box([palette.rose, palette.sky, palette.sage, palette.butter][i % 4]!, [sx - 0.92 + i * 0.26, y + 0.2, sz + 0.18], [0.16, 0.3 + (i % 3) * 0.04, 0.25], (i % 3 - 1) * 0.08);
  }
  box(palette.wood, [0, 1.75, -13.8], [13, 1.7, 0.18]);
  for (let i = 0; i < 5; i++) { const x = -5.15 + i * 2.58; box(palette.cream, [x, 1.68, -13.69], [2.4, 1.4, 0.04]); label(['Chờ làm', 'Đang làm', 'Chờ duyệt', 'Gặp lỗi', 'Xong'][i]!, [x, 2.23, -13.65], 2.1, 0.3); }
  for (const pod of productionPods) {
    const [x, z] = pod.at;
    if (pod.prop === 'easel' || pod.prop === 'palette') {
      box(palette.darkWood, [x, 0.7, z - 1.65], [0.12, 1.4, 0.15]);
      box(pod.prop === 'palette' ? palette.rose : palette.cream, [x, 1.12, z - 1.62], [0.9, 0.7, 0.1]);
      if (pod.prop === 'palette') for (let i = 0; i < 3; i++) add('sphere', [palette.sky, palette.sage, palette.butter][i]!, [x - 0.25 + i * 0.25, 1.12, z - 1.53], [0.13, 0.13, 0.05]);
    } else if (pod.prop === 'board') {
      box(palette.wood, [x, 0.55, z - 1.5], [0.9, 0.1, 0.9]);
      for (let i = 0; i < 4; i++) add('cylinder', i % 2 ? palette.cream : palette.ink, [x - 0.27 + i * 0.18, 0.68, z - 1.5], [0.12, 0.2, 0.12]);
    } else { box(palette.ink, [x, 0.95, z - 1.5], [0.8, 0.35, 0.12]); add('screen', palette.lavender, [x, 0.95, z - 1.42], [0.7, 0.25, 0.03]); }
  }
  add('cylinder', palette.wood, [0, 0.82, 6], [meetingTable.radius * 2, 0.18, meetingTable.radius * 2]);
  add('cylinder', palette.darkWood, [0, 0.4, 6], [0.65, 0.8, 0.65]); blob([0, 6], 4.8, 4.8);
  for (let i = 0; i < 7; i++) { const a = i * Math.PI * 2 / 7; add('cylinder', palette.trim, [Math.cos(a) * 1.15, 0.94, 6 + Math.sin(a) * 1.15], [0.42, 0.055, 0.42]); }
  box(palette.wood, [anchors.whiteboard[0], 1.05, anchors.whiteboard[1]], [2.4, 1.3, 0.15]);
  for (const dx of [-0.8, 0.8]) box(palette.darkWood, [anchors.whiteboard[0] + dx, 0.3, anchors.whiteboard[1]], [0.12, 0.6, 0.24]);
  box(palette.cream, [anchors.whiteboard[0], 1.05, anchors.whiteboard[1] + 0.09], [2.2, 1.1, 0.04]);
  add('glass', palette.sky, [9.2, 0.65, -9], [0.14, 1.3, 9]);
  for (const z of [-13.4, -9, -4.6]) box(palette.cream, [9.2, 0.7, z], [0.23, 1.4, 0.23]);
  const [lx, lz] = anchors.labBench; box(palette.cream, [lx, 0.45, lz], [2.8, 0.9, 1.1]); box(palette.sky, [lx, 0.95, lz], [3, 0.12, 1.2]);
  box(palette.ink, [lx, 1.25, lz], [1.5, 0.45, 0.14]); add('screen', palette.sage, [lx, 1.25, lz + 0.08], [1.35, 0.34, 0.02]); blob(anchors.labBench, 3.6, 2);
  const [ax, az] = anchors.scanner; for (const dx of [-0.85, 0.85]) box(palette.sky, [ax + dx, 0.9, az], [0.25, 1.8, 0.35]); box(palette.sky, [ax, 1.85, az], [1.95, 0.25, 0.35]);
  const [px0, px1, pz0, pz1] = pen.rect;
  for (const z of [pz0, pz1]) box(palette.wood, [(px0 + px1) / 2, 0.43, z], [px1 - px0, 0.09, 0.12]);
  for (const x of [px0, px1]) box(palette.wood, [x, 0.43, (pz0 + pz1) / 2], [0.12, 0.09, pz1 - pz0]);
  for (let x = px0; x <= px1; x += 0.75) for (const z of [pz0, pz1]) box(palette.darkWood, [x, 0.27, z], [0.12, 0.54, 0.12]);
  box(palette.wall, [13.5, 1.25, 1.6], [8, 2.5, 0.18]); box(palette.wall, [9.6, 1.25, 6.5], [0.18, 2.5, 10]);
  for (const f of displayFrames) {
    const [x, z] = f.position; const yaw = f.yaw; const nx = Math.sin(yaw), nz = Math.cos(yaw);
    box(palette.wood, [x + nx * 0.14, 1.4, z + nz * 0.14], [1.6, 1.2, 0.12], yaw);
    box(palette.cream, [x + nx * 0.21, 1.4, z + nz * 0.21], [1.4, 1, 0.04], yaw);
    label('Chỗ trống', [x + nx * 0.24, 1.4, z + nz * 0.24], 1.15, 0.24, false, yaw, palette.darkWood);
  }
  const [gx, gz] = anchors.arcade; box(palette.trim, [gx, 0.2, gz], [2, 0.4, 2]); box(palette.lavender, [gx, 1, gz], [1.2, 1.3, 1.1]); box(palette.ink, [gx, 1.3, gz + 0.58], [0.85, 0.65, 0.08]); add('screen', palette.sky, [gx, 1.32, gz + 0.63], [0.7, 0.48, 0.02]); box(palette.rose, [gx, 0.94, gz + 0.65], [1.1, 0.12, 0.5]); add('sphere', palette.apricot, [gx - 0.25, 1.07, gz + 0.68], [0.1, 0.16, 0.1]); blob(anchors.arcade, 2.8, 2.8);
  box(palette.wood, [anchors.counter[0], 0.55, anchors.counter[1]], [2, 1.1, 1]); box(palette.cream, [anchors.counter[0], 1.13, anchors.counter[1]], [2.2, 0.12, 1.1]);
  const [cx, cz] = anchors.sofa; box(palette.rose, [cx, 0.46, cz], [5, 0.62, 1.3]); box(palette.rose, [cx, 0.95, cz - 0.5], [5, 0.65, 0.3]);
  for (const dx of [-2.3, 2.3]) box(palette.rose, [cx + dx, 0.8, cz], [0.35, 0.6, 1.4]);
  for (const dx of [-1.25, 0, 1.25]) box(palette.butter, [cx + dx, 0.8, cz - 0.15], [0.8, 0.32, 0.5]); blob(anchors.sofa, 6, 2.3);
  const [fx, fz] = anchors.coffee; box(palette.wood, [fx, 0.46, fz], [1, 0.92, 1]); box(palette.ink, [fx, 1.2, fz], [0.7, 0.6, 0.65]); box(palette.cream, [fx, 1.08, fz + 0.35], [0.42, 0.3, 0.12]); add('cylinder', palette.cream, [fx, 0.97, fz + 0.4], [0.17, 0.18, 0.17]);
  for (const [x, z] of plants) { add('cylinder', palette.apricot, [x, 0.24, z], [0.6, 0.48, 0.6]); add('sphere', palette.sage, [x, 0.82, z], [0.9, 0.95, 0.85]); add('sphere', palette.sage, [x + 0.23, 0.6, z], [0.55, 0.6, 0.55]); blob([x, z], 1.3, 1.3); }
  add('cylinder', palette.sage, [34, -0.25, -16], [20, 0.5, 20]); add('cylinder', palette.rug, [34, 0.015, -16], [12, 0.035, 12]);
  for (let i = 1; i < portalPath.length; i++) { const a = portalPath[i - 1]!, b = portalPath[i]!; box(palette.rug, [(a[0] + b[0]) / 2, -0.03, (a[1] + b[1]) / 2], [2, 0.12, Math.hypot(b[0] - a[0], b[1] - a[1]) + 0.5], Math.atan2(b[0] - a[0], b[1] - a[1])); }
  for (const dx of [-1.3, 1.3]) box(palette.wood, [anchors.gate[0] + dx, 1.3, anchors.gate[1]], [0.35, 2.6, 0.4]); box(palette.apricot, [25, 2.65, -3], [3.1, 0.5, 0.5]); label('Sắp mở', [25, 2.67, -2.74], 2.4, 0.34);
  for (const z of zones) label(z.name, [z.anchor[0], 0.045, z.anchor[1]], z.id === 'B' || z.id === 'C' ? 6 : 6.5, 0.72, true, 0, palette.darkWood);
  return { parts, labels, shadows };
}
