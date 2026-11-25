// Reads the renderer's layout and prints every wall/screen quad, including its
// support plane and dimensions. Intentional layers within one fixture are
// checked separately for depth clearance; different fixtures need free space.
import '../../verify-loader.mjs';
import assert from 'node:assert/strict';
const { environmentModel, monitorFaceOffset, monitorFeedbackOffset, progressFillOffset, monitorYaw, desks, anchors } = await import('../../layout/zones.ts');
const { chairmanSurfaces } = await import('../../layout/chairman.ts');
const { propWallPanels } = await import('../../layout/wallPanels.ts');
const { southWindows, eastWindows, walkWindow } = await import('./wallLayout.ts');
const { artwork, labels, parts } = environmentModel();
const quads = [], footprints = [];
function panel(id, mount, position, width, height, yaw = 0, polygonOffset = false) {
  const nx = Math.sin(yaw), nz = Math.cos(yaw);
  const p = { id, mount, position, width, height, yaw, polygonOffset, normal: [nx, nz], plane: nx * position[0] + nz * position[2], along: nz * position[0] - nx * position[2] };
  quads.push(p); return p;
}
// Every non-floor label and art panel, including monitor faces.
artwork.forEach((p, i) => panel(`art:${p.kind}:${p.text ?? i}`, p.mount ?? `art:${i}`, p.position, p.width, p.height, p.yaw));
labels.filter(p => !p.floor).forEach((p, i) => panel(`label:${p.text}:${i}`, p.mount ?? `label:${i}`, p.position, p.width, p.height, p.yaw, true));
propWallPanels.forEach(p => panel(p.id, p.mount, p.position, p.width, p.height, p.yaw));
chairmanSurfaces.forEach(p => panel(`${p.id}:face`, p.id, p.position, p.width, p.height, p.yaw));
for (let column = 0; column < 5; column++) {
  const x = anchors.taskBoard[0] - 4.3 + column * 2.15;
  panel(`task-header:${column}`, 'task-board', [x, 1.96, anchors.taskBoard[1] + .29], 1.92, .21, 0, true);
  for (let row = 0; row < 3; row++) panel(`task-card:${column}:${row}`, 'task-board', [x, 1.68 - row * .245, anchors.taskBoard[1] + .345], 1.8, .22, 0, true);
}
// Backing rectangles reserve their full physical area, not only the inked face.
for (const [i, p] of parts.entries()) {
  if (!p.mount || p.scale[0] < .4 || p.scale[1] < .2 || p.scale[2] > .2) continue;
  footprints.push(panel(`backing:${p.mount}:${i}`, p.mount, p.position, p.scale[0], p.scale[1], p.yaw, true));
}
for (const [wall, ranges] of [['south', southWindows], ['east', eastWindows]]) {
  ranges.forEach(([a, b], i) => footprints.push(panel(`walk-window:${wall}:${i}`, `walk-window:${wall}:${i}`, wall === 'south' ? [(a+b)/2, walkWindow.centerY, 14] : [18, walkWindow.centerY, (a+b)/2], b-a-.3, walkWindow.height, wall === 'south' ? Math.PI : -Math.PI/2)));
}
for (const x of [-8, 8]) footprints.push(panel(`door:${x}`, `door:${x}`, [x, 1.23, 14], 2.32, 2.46, Math.PI));
footprints.push(panel('door:east', 'door:east', [18, 1.23, -1], 2.32, 2.46, -Math.PI/2));
function conflict(a, b, gap = .04) {
  const dot = a.normal[0]*b.normal[0] + a.normal[1]*b.normal[1];
  if (Math.abs(dot) < .999) return false;
  // All layers attached to one support wall are compared, even when their
  // offsets differ. This catches windows masked by a board 15cm in front.
  if (Math.abs(a.plane - Math.sign(dot)*b.plane) > (a.mount.startsWith('art:') || b.mount.startsWith('art:') || a.mount.startsWith('monitor:') || b.mount.startsWith('monitor:') ? .02 : .45)) return false;
  const along = Math.sign(dot)*b.along;
  return Math.abs(a.along-along) < (a.width+b.width)/2 + gap && Math.abs(a.position[1]-b.position[1]) < (a.height+b.height)/2 + gap;
}
// Depth checks for intentional desktop layers; progress fill is 3cm forward.
assert(monitorFaceOffset - .085/2 >= .03);
for (const d of desks) for (const [i, p] of [d.monitor,d.sideMonitor].entries()) {
  panel(`feedback:${d.id}:${i}`, `monitor:${d.id}:${i}`, [p[0]+Math.sin(monitorYaw)*(monitorFaceOffset+monitorFeedbackOffset), i?1.07:1.08,p[1]+Math.cos(monitorYaw)*(monitorFaceOffset+monitorFeedbackOffset)], i?.56:.7,i?.28:.32,monitorYaw);
}
for (const d of desks) {
  panel(`progress-track:${d.id}`, `progress:${d.id}`, [d.position[0],1.65,d.position[1]],1.3,.1,Math.PI/4);
  panel(`progress-fill:${d.id}`, `progress:${d.id}`, [d.position[0]+Math.sin(Math.PI/4)*progressFillOffset,1.65,d.position[1]+Math.cos(Math.PI/4)*progressFillOffset],1.24,.065,Math.PI/4);
}
assert(monitorFeedbackOffset >= .02 && progressFillOffset >= .02, 'feedback-to-art and progress-fill-to-track offset >=2cm');
const failures = [];
for (let i = 0; i < quads.length; i++) {
  const a = quads[i];
  console.log(`${a.id} pos=(${a.position.join(',')}) plane=(${a.normal.map(n=>n.toFixed(2)).join(',')}; ${a.plane.toFixed(3)}) size=${a.width}×${a.height}`);
  for (let j = i+1; j < quads.length; j++) {
    const b = quads[j];
    if (a.mount === b.mount) {
      // Nested frame/backing solids are one fixture. Visible ink layers must
      // either clear each other by 2cm or use the renderer's polygon offset.
      if (!a.id.startsWith('backing:') && !b.id.startsWith('backing:') && conflict(a,b,0) && Math.abs(a.plane-b.plane)<.02 && !a.polygonOffset && !b.polygonOffset) failures.push(`${a.id} z-fights ${b.id}`);
      continue;
    }
    if (conflict(a,b)) failures.push(`${a.id} overlaps/touches ${b.id}`);
  }
}
assert.equal(failures.length, 0, [...new Set(failures)].join('\n'));
console.log(`Wall/screen audit PASS (${quads.length} quads, full fixture extents, >=4cm fixture gaps; desktop offsets >=2cm)`);
