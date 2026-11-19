import { anchors, desks, displayFrames, loungeProps, monitorYaw, palette, type Part } from '../../layout/zones';

export const walkFixtures = [
  { id: 'water-cooler', position: [17, 13.1] as const, half: [0.4, 0.4] as const, yaw: 0 },
  { id: 'coat-rack', position: [-17, 13.2] as const, half: [0.35, 0.35] as const, radius: 0.35, yaw: 0 },
];
/** Closed solids, shared by the renderer and analytic Walk camera obstruction checks. */
export function walkSceneryParts(): Part[] {
  const parts: Part[] = [];
  const box = (color: string, position: Part['position'], scale: Part['scale'], yaw = 0) => parts.push({ shape: 'detail', color, position, scale, yaw });
  // South doors align with the two existing north/south walking lanes. East door opens onto the Portal path.
  const wall = (start: number, end: number, east = false) => {
    const p = (along: number, y: number): Part['position'] => east ? [18, y, along] : [along, y, 14];
    const scale = (width: number, height: number): Part['scale'] => east ? [0.2, height, width] : [width, height, 0.2];
    const middle = (start + end) / 2, width = end - start;
    box(palette.wall, p(middle, 0.57), scale(width, 1.14));
    box(palette.wall, p(middle, 3.2), scale(width, 0.8));
    // Actual window openings rather than opaque walls with a glass overlay.
    box(palette.sky, p(middle, 1.97), east ? [0.025, 1.66, width] : [width, 1.66, 0.025]);
    parts[parts.length - 1]!.shape = 'glass';
    for (let a = start; a <= end; a += 2.5) box(palette.cream, p(a, 1.97), east ? [0.24, 1.7, 0.06] : [0.06, 1.7, 0.24]);
    for (const y of [0.12, 1.14, 2.8, 3.53]) box(palette.wood, p(middle, y), scale(width, 0.07));
  };
  for (const [a, b] of [[-18, -9.1], [-6.9, 6.9], [9.1, 18]]) wall(a!, b!);
  for (const [a, b] of [[-14, -2.1], [0.1, 14]]) wall(a!, b!, true);
  for (const x of [-8, 8]) {
    box(palette.wall, [x, 3, 14], [2.2, 1.2, 0.2]);
    for (const dx of [-1.1, 1.1]) box(palette.wood, [x + dx, 1.2, 13.94], [0.12, 2.4, 0.3]);
    box(palette.wood, [x, 2.4, 13.94], [2.3, 0.12, 0.3]);
  }
  box(palette.wall, [18, 3, -1], [0.2, 1.2, 2.2]);
  for (const z of [-2.1, 0.1]) box(palette.wood, [17.94, 1.2, z], [0.3, 2.4, 0.12]);
  box(palette.wood, [17.94, 2.4, -1], [0.3, 0.12, 2.3]);
  box('#EFE5D4', [0, 3.7, 0], [36.2, 0.2, 28.2]);
  for (const x of [-12, 0, 12]) for (const z of [-9, 0, 9]) {
    box('#B8AF9F', [x, 3.56, z], [2.6, 0.1, 1.3]);
    box('#FFF5D4', [x, 3.49, z], [2.4, 0.035, 1.1]);
  }
  for (const [x, z] of [[-13, 8], [0, 6], [13, 7]]) {
    box(palette.ink, [x!, 3.2, z!], [0.035, 0.6, 0.035]);
    box(palette.apricot, [x!, 2.87, z!], [0.6, 0.16, 0.6]);
    box('#FFF5D4', [x!, 2.77, z!], [0.5, 0.04, 0.5]);
  }
  for (const d of desks) {
    const [x, z] = d.position;
    box('#69523E', [x, 0.69, z], [1.45, 0.04, 0.68]);
    box('#34404B', [x, 0.55, z + 0.23], [0.9, 0.08, 0.22]);
    for (const dx of [-0.3, 0, 0.3]) box('#527C86', [x + dx, 0.66, z + 0.25], [0.025, 0.2, 0.025]);
    box('#34404B', [x + 0.56, 0.34, z + 0.3], [0.025, 0.6, 0.025]);
    box('#52636A', [d.seat[0], 0.99, d.seat[1] - 0.4], [0.51, 0.65, 0.04]);
    for (const [mx, mz] of [d.monitor, d.sideMonitor]) {
      const backYaw = monitorYaw + Math.PI, nx = Math.sin(backYaw), nz = Math.cos(backYaw);
      // Factory F, built from three strokes so it stays crisp at any camera angle.
      for (const [dx, dy, w, h] of [[-0.055, 0, 0.025, 0.15], [0, 0.065, 0.12, 0.025], [-0.01, 0, 0.1, 0.025]]) {
        box('#BDE3D2', [mx + nx * 0.054 + Math.cos(backYaw) * dx!, 1.08 + dy!, mz + nz * 0.054 - Math.sin(backYaw) * dx!], [w!, h!, 0.012], backYaw);
      }
      for (let i = 0; i < 4; i++) box('#81929C', [mx + nx * 0.054 + Math.cos(backYaw) * (i * 0.045 - 0.07), 0.96, mz + nz * 0.054 - Math.sin(backYaw) * (i * 0.045 - 0.07)], [0.025, 0.012, 0.01], backYaw);
    }
  }
  // Finish freestanding art backs, the TV housing and board trays.
  for (const f of displayFrames) {
    const nx = Math.sin(f.yaw), nz = Math.cos(f.yaw);
    box('#7E6A54', [f.position[0] + nx * 0.065, 1.43, f.position[1] + nz * 0.065], [1.48, 1.08, 0.035], f.yaw);
    box('#3D454C', [f.position[0] - nx * 0.105, 2.05, f.position[1] - nz * 0.105], [0.18, 0.04, 0.03], f.yaw);
  }
  box('#34404B', [loungeProps.tv[0], 1.25, loungeProps.tv[1] - 0.065], [1.6, 0.8, 0.05]);
  box('#81929C', [anchors.whiteboard[0] - 0.09, 1.18, anchors.whiteboard[1]], [0.025, 1.14, 2.22]);
  // Cooler and coat rack occupy the otherwise empty corners.
  box('#D8E5E1', [17, 0.57, 13.1], [0.65, 1.14, 0.65]);
  box('#34404B', [17, 0.7, 12.76], [0.4, 0.3, 0.04]);
  box('#AFCFE6', [17, 1.42, 13.1], [0.5, 0.55, 0.5]);
  for (const dx of [-0.12, 0.12]) box(dx < 0 ? '#C65742' : '#527C86', [17 + dx, 0.86, 12.72], [0.08, 0.07, 0.09]);
  box(palette.darkWood, [-17, 0.06, 13.2], [0.65, 0.12, 0.65]);
  box(palette.darkWood, [-17, 0.95, 13.2], [0.07, 1.8, 0.07]);
  box(palette.darkWood, [-17, 1.65, 13.2], [0.6, 0.07, 0.6]);
  for (const dx of [-0.25, 0.25]) {
    box(palette.darkWood, [-17 + dx, 1.74, 13.2], [0.06, 0.2, 0.07]);
    box(dx < 0 ? palette.sage : palette.rose, [-17 + dx, 1.25, 13.2], [0.24, 0.8, 0.15]);
  }
  return parts;
}
