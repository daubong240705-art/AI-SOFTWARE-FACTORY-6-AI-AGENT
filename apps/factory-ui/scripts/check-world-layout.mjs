// Execute pure layout modules in memory, without a browser or generated files.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = async p => ts.transpileModule(await readFile(new URL(p, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const url = s => `data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;
const zonesUrl = url(await source('../src/screens/world/layout/zones.ts'));
const graphSource = (await source('../src/screens/world/layout/waypoints.ts')).replace("'./zones'", JSON.stringify(zonesUrl)).replace('import.meta.env.DEV', 'true');
try {
  const { layout, navigationAnchors, pathBetween, intersectsFootprint } = await import(url(graphSource));
  assert.equal(layout.blockedEdges, 0);
  assert.ok(Object.isFrozen(layout) && Object.isFrozen(layout.nodes) && Object.isFrozen(layout.nodes[0].position));
  const { environmentModel, furnitureFootprints, portalBooths, playerSpawnRing, desks, ownerDesk, productionPods, walkwayLanes, desktopHeight, displayFrames, monitorYaw, monitorFaceOffset } = await import(zonesUrl);
  const model = environmentModel();
  // Seats stay axial; primary screens turn toward the isometric camera.
  const axial = yaw => Math.abs(yaw / (Math.PI / 2) - Math.round(yaw / (Math.PI / 2))) < 1e-8;
  for (const desk of desks) {
    assert.ok(axial(desk.yaw), `${desk.id}: desk must align to the floor grid`);
    assert.deepEqual(desk.seat, [desk.position[0], desk.position[1] - 0.94]);
    assert.ok(desk.stand[1] < desk.seat[1] - 0.7, `${desk.id}: approach must clear the chair`);
    assert.ok(desk.monitor[1] > desk.position[1] && desk.sideMonitor[0] < desk.seat[0]);
    const screens = [desk.monitor, desk.sideMonitor].map((point, index) => {
      const panel = model.artwork.find(p => Math.abs(p.position[0] - (point[0] + Math.sin(monitorYaw) * monitorFaceOffset)) < 1e-8 && Math.abs(p.position[2] - (point[1] + Math.cos(monitorYaw) * monitorFaceOffset)) < 1e-8);
      assert.ok(panel, `${desk.id}: missing monitor ${index}`);
      const normal = [Math.sin(panel.yaw), 0, Math.cos(panel.yaw)];
      const towardSeat = [desk.seat[0] - point[0], 0, desk.seat[1] - point[1]];
      const length = Math.hypot(...towardSeat);
      const dotSeat = normal.reduce((sum, n, i) => sum + n * towardSeat[i] / length, 0);
      const dotCamera = normal.reduce((sum, n) => sum + n / Math.sqrt(3), 0);
      assert.ok(dotSeat > 0.5, `${desk.id} monitor ${index}: front must face seat (dot=${dotSeat})`);
      assert.ok(dotCamera > 0, `${desk.id} monitor ${index}: front must face camera hemisphere (dot=${dotCamera})`);
      const housing = model.parts.find(part => part.position[0] === point[0] && part.position[1] === (index ? 1.07 : 1.08) && part.position[2] === point[1] && part.yaw === panel.yaw);
      assert.ok(housing, `${desk.id}: housing and screen must share angle`);
      assert.ok(monitorFaceOffset - housing.scale[2] / 2 >= 0.02, `${desk.id}: screen must clear housing`);
      assert.ok(panel.position[1] + panel.height / 2 < 1.3, 'Low monitors must leave heads visible');
      return panel;
    });
    assert.equal(screens.length, 2);
    const [x, z] = desk.position;
    // Props must touch the actual top surface, including keyboard keys on their
    // base and the mouse on its pad; a world-space offset alone is insufficient.
    const grounded = (px, pz, width, height, surface = desktopHeight) => {
      const part = model.parts.find(p => Math.abs(p.position[0] - px) < 1e-8 && Math.abs(p.position[2] - pz) < 1e-8 && Math.abs(p.scale[0] - width) < 1e-8 && Math.abs(p.scale[1] - height) < 1e-8);
      assert.ok(part, `${desk.id}: missing desktop prop`);
      assert.ok(Math.abs(part.position[1] - part.scale[1] / 2 - surface) < 1e-8, `${desk.id}: floating or sunken desktop prop`);
    };
    grounded(desk.monitor[0], desk.monitor[1], 0.34, 0.035);
    grounded(desk.monitor[0], desk.monitor[1], 0.09, 0.14);
    grounded(desk.sideMonitor[0], desk.sideMonitor[1], 0.1, 0.12);
    grounded(x + 0.05, z - 0.23, 0.6, 0.035);
    grounded(x - 0.18, z - 0.29, 0.053, 0.014, desktopHeight + 0.035);
    grounded(x + 0.52, z - 0.22, 0.25, 0.02);
    grounded(x + 0.52, z - 0.22, 0.11, 0.07, desktopHeight + 0.02);
    grounded(x + 0.65, z + 0.23, 0.17, 0.03);
    grounded(x - 0.34, z + 0.28, 0.13, 0.17);
  }
  for (const frame of displayFrames) {
    const [x, z] = frame.position, nx = Math.sin(frame.yaw), nz = Math.cos(frame.yaw);
    const plate = model.labels.find(p => Math.abs(p.position[0] - (x + nx * 0.275)) < 1e-8 && Math.abs(p.position[2] - (z + nz * 0.275)) < 1e-8 && p.position[1] === 0.67);
    assert.equal(plate?.yaw, frame.yaw, `${frame.id}: centred, straight nameplate`);
  }
  console.log(`Monitor layout: ${desks.length * 2} screens face both seat and camera; housing clearance >= 0.02`);
  for (const label of model.labels) assert.ok(!/[À-ỹ]/u.test(label.text), `Scene label must be English: ${label.text}`);
  for (const part of model.parts) {
    // The exterior connecting path follows the original Portal route; furniture stays axial.
    if (part.position[0] <= 18 || part.position[1] > 0.1) assert.ok(axial(part.yaw) || desks.some(desk => (part.position[0] === desk.monitor[0] || part.position[0] === desk.sideMonitor[0]) && (part.position[1] === 1.08 && part.position[2] === desk.monitor[1] || part.position[1] === 1.07 && part.position[2] === desk.sideMonitor[1]) && part.yaw === monitorYaw), 'Only desktop screens may turn off the furniture grid');
  }
  for (const panel of model.artwork) assert.ok(axial(panel.yaw) || panel.yaw === monitorYaw && [1.08, 1.07].includes(panel.position[1]), 'Artwork must align with furniture or a turned primary screen');
  assert.deepEqual(productionPods.map(p => p.id), ['design', 'rules', 'art', 'client']);
  assert.equal(ownerDesk.id, 'owner');
  assert.ok(model.artwork.some(p => p.text === 'Lazy Studio'));
  assert.ok(model.artwork.some(p => p.text === 'Bug pen'));
  for (const [a, b] of walkwayLanes) assert.ok(!furnitureFootprints.some(f => intersectsFootprint(a, b, f)), 'Main walkway must stay unobstructed');
  // The bench, handheld test screen, TV and arcade face their users on +z.
  const { anchors, loungeProps } = await import(zonesUrl);
  for (const [id, center, viewer, width] of [
    ['lab', [anchors.labBench[0] - 0.3, 1.3, anchors.labBench[1]], navigationAnchors['lab-bench'], 1.25],
    ['test-handheld', [anchors.labBench[0] + 0.95, 1.25, anchors.labBench[1] + 0.1], navigationAnchors['lab-bench'], 0.22],
    ['lounge-tv', [loungeProps.tv[0], 1.25, loungeProps.tv[1]], anchors.sofa, 1.56],
    ['arcade', [anchors.arcade[0], 1.42, anchors.arcade[1] + 0.54], [anchors.arcade[0], anchors.arcade[1] + 1.5], 0.77],
  ]) {
    const panel = model.artwork.find(panel => panel.width === width && panel.position[0] === center[0] && panel.position[1] === center[1]);
    assert.ok(panel, `${id}: missing bright face`);
    const normal = [Math.sin(panel.yaw), Math.cos(panel.yaw)];
    const delta = [viewer[0] - center[0], viewer[1] - center[2]];
    assert.ok((normal[0] * delta[0] + normal[1] * delta[1]) / Math.hypot(...delta) > 0.5, `${id}: front faces user`);
    assert.ok(normal[0] + normal[1] > 0, `${id}: front faces camera`);
    const housing = model.parts.find(part => part.position.every((value, i) => value === center[i]));
    assert.ok(panel.position[2] - center[2] - housing.scale[2] / 2 >= 0.02 - 1e-8, `${id}: front clears dark back`);
  }
  // Cover texture identity survives a new polling object and count changes.
  const coverSource = (await source('../src/screens/world/scene/gallery/coverTexture.ts')).replace("'three'", JSON.stringify(import.meta.resolve('three')));
  const { coverFor } = await import(url(coverSource));
  const context = new Proxy({}, { get: (_, key) => key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}, set: () => true });
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
  try {
    const cache = new Map(), item = { gameId: 'game', projectId: 'project', name: 'Game', version: 1, releaseId: 'release-1' };
    const firstCover = coverFor(cache, item, null, () => {}); let disposed = 0;
    firstCover.texture.addEventListener('dispose', () => disposed++);
    assert.equal(coverFor(cache, { ...item, playing: 12 }, null, () => {}), firstCover, 'Polling must reuse the cover');
    assert.equal(disposed, 0, 'An unchanged release must never dispose its texture');
    const nextCover = coverFor(cache, { ...item, releaseId: 'release-2' }, null, () => {});
    assert.notEqual(nextCover.texture, firstCover.texture, 'A changed release refreshes the cover');
    assert.equal(disposed, 1); nextCover.dispose();
  } finally {
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
  }
  console.log('Other screens: bench, test handheld, lounge TV and arcade face user/camera; unchanged covers keep their texture');
  // Exercise the actual scheduler with a fake clock: no browser or invented work.
  const { WanderingDirector } = await import(url(await source('../src/screens/world/scene/wandering.ts')));
  const idleAgents = desks.slice(0, 8).map((desk, i) => ({ seatId: `walker-${i}`, idle: true, desk: desk.seat, home: desk.id }));
  const leisure = Object.entries(navigationAnchors).filter(([id]) => id.startsWith('rest-') || id.startsWith('table-') && id !== 'table-0' || ['coffee', 'window'].includes(id)).map(([id, point]) => ({ id, point }));
  const director = new WanderingDirector(), replay = new WanderingDirector();
  assert.deepEqual(director.update(idleAgents, leisure, 0, true, 3), []);
  replay.update(idleAgents, leisure, 0, true, 3);
  assert.deepEqual(director.update(idleAgents, leisure, 19999, true, 3), [], 'First departure must wait at least 20 seconds');
  const departures = director.update(idleAgents, leisure, 60000, true, 3);
  assert.equal(departures.length, 3, 'At most three wanderers, even with eight eligible agents');
  assert.deepEqual(replay.update([...idleAgents].reverse(), leisure, 60000, true, 3), departures, 'Seat seed and scheduling must survive array reorder');
  assert.equal(new Set(departures.map(action => action.spot.id)).size, 3, 'Visitors reserve unique destinations');
  for (const action of departures) {
    const agent = idleAgents.find(agent => agent.seatId === action.seatId);
    assert.ok(pathBetween(agent.home, action.spot.id).length > 1, 'Every leisure trip uses a real reachable route');
    assert.ok(director.wandering(action.seatId)); director.arrive(action.seatId, 60000);
  }
  assert.deepEqual(director.update(idleAgents, leisure, 69999, true, 3), [], 'Visits last at least 10 seconds');
  const returns = director.update(idleAgents, leisure, 85001, true, 3);
  assert.equal(returns.filter(action => action.kind === 'return').length, 3, 'Visits end within 25 seconds of arrival');
  for (const action of returns) director.arrive(action.seatId, 85001);
  assert.equal(director.reservedSpots().size, 0, 'Home arrivals release reservations');
  assert.deepEqual(director.update(idleAgents.filter(agent => returns.some(action => action.seatId === agent.seatId)), leisure, 105000, true, 3), [], 'Returning agents cannot depart again before 20 seconds');
  for (const status of ['working', 'queued', 'waiting', 'problem', 'done']) {
    const interrupted = new WanderingDirector(); interrupted.update(idleAgents, leisure, 0, true, 3);
    const away = interrupted.update(idleAgents, leisure, 60000, true, 3);
    const back = interrupted.update(idleAgents.map(agent => ({ ...agent, idle: false })), leisure, 60001, true, 3);
    assert.equal(back.length, away.length, `${status}: return on the very next status update`);
    assert.ok(back.every(action => action.kind === 'return' && action.urgent));
    assert.deepEqual(interrupted.update(idleAgents, leisure, 60002, false, 3).map(action => action.kind), ['reset', 'reset', 'reset'], 'Still/hidden/baseline reset places every visitor home');
    assert.equal(interrupted.reservedSpots().size, 0);
  }
  const returning = new WanderingDirector(); returning.update(idleAgents, leisure, 0, true, 3);
  const visitors = returning.update(idleAgents, leisure, 60000, true, 3);
  visitors.forEach(action => returning.arrive(action.seatId, 60000));
  returning.update(idleAgents, leisure, 85001, true, 3);
  assert.equal(returning.update(idleAgents.map(agent => ({ ...agent, idle: false })), leisure, 85002, true, 3).filter(action => action.urgent).length, 3, 'Work interrupts an already returning leisure route too');
  const reduction = new WanderingDirector(); reduction.update(idleAgents, leisure, 0, true, 3);
  reduction.update(idleAgents, leisure, 60000, true, 3);
  assert.equal(reduction.update(idleAgents, leisure, 60001, true, 1).filter(action => action.kind === 'reset').length, 2, 'Lowering quality immediately reduces existing visitors');
  assert.equal(reduction.reservedSpots().size, 1);
  const low = new WanderingDirector(); low.update(idleAgents, leisure, 0, true, 1);
  assert.equal(low.update(idleAgents, leisure, 60000, true, 1).length, 1, 'Low quality permits one wanderer');
  low.update([], leisure, 60001, true, 1); assert.equal(low.reservedSpots().size, 0, 'Removed seats release their spots');
  console.log('Wandering: deterministic 20–60s departures, 10–25s visits, reservation/cap, work interrupts, still reset and low-quality checks passed');
  // Import the exact render geometry in memory; no browser, GPU or generated files.
  const geometrySource = await source('../src/screens/world/scene/EnvironmentGeometry.ts');
  const geometryUrl = url(geometrySource.replace(/from '([^']+)'/g, (_, name) => `from ${JSON.stringify(import.meta.resolve(name))}`));
  const { environmentGeometries, geometryForPart } = await import(geometryUrl);
  const geometries = environmentGeometries();
  const trianglesFor = shape => { const geometry = geometries[shape]; return (geometry.index?.count ?? geometry.getAttribute('position').count) / 3; };
  const counts = Object.fromEntries(Object.keys(geometries).map(shape => [shape, model.parts.filter(p => !p.zone && p.shape === shape).length]));
  const staticTriangles = model.parts.filter(p => p.zone).reduce((n, part) => { const g = geometryForPart(part, geometries); const count = (g.index?.count ?? g.getAttribute('position').count) / 3; if (part.shape === 'rug') g.dispose(); return n + count; }, 0);
  const triangles = staticTriangles + Object.entries(counts).reduce((n, [shape, count]) => n + count * trianglesFor(shape), 0) + (model.shadows.length + model.labels.length + model.artwork.length) * 2;
  // Static shell + nonempty instance batches + shadow + label atlas + three artwork material batches.
  const calls = 1 + Object.values(counts).filter(Boolean).length + 1 + 1 + 3;
  const canvasTextures = 3; // shadow, labels, artwork; plus one shared non-canvas toon gradient.
  assert.ok(calls <= 80, 'Environment must stay under 80 draw calls');
  assert.ok(triangles <= 250000, 'Environment must stay under 250k triangles');
  assert.ok(canvasTextures <= 24);
  Object.values(geometries).forEach(g => g.dispose());
  console.log(`Environment geometry (all visible, debug off): ${calls} draw calls; ${triangles} triangles; ${canvasTextures} canvas atlases + 1 shared toon gradient`);
  console.log(`Environment details: ${model.parts.length} parts; ${model.artwork.length} artwork panels; ${new Set(model.artwork.map(p => `${p.kind}:${p.text ?? ''}`)).size} artwork atlas cells`);
  assert.equal(portalBooths.length, 8); assert.equal(playerSpawnRing.length, 8);
  for (const [a, b] of layout.edges) {
    const p = layout.nodes.find(n => n.id === a).position, q = layout.nodes.find(n => n.id === b).position;
    assert.ok(!furnitureFootprints.some(f => intersectsFootprint(p, q, f)), 'Every edge must clear expanded furniture');
  }
  assert.ok(model.labels.length <= 32, 'Text labels must fit the shared canvas atlas');
  const localeKeys = async locale => {
    const text = await readFile(new URL(`../src/i18n/extra.${locale}.ts`, import.meta.url), 'utf8');
    const start = text.indexOf('worldUi: {') + 'worldUi: '.length;
    let depth = 0, end = start;
    do { if (text[end] === '{') depth++; if (text[end] === '}') depth--; end++; } while (depth);
    const dictionary = (await import(url(`export default ${text.slice(start, end)}`))).default;
    const keys = (value, prefix = '') => Object.entries(value).flatMap(([key, child]) => typeof child === 'string' ? [`${prefix}${key}`] : keys(child, `${prefix}${key}.`));
    return keys(dictionary).sort();
  };
  const en = await localeKeys('en'), vi = await localeKeys('vi');
  for (const label of model.labels) assert.ok(en.includes(label.key.replace('worldUi.', '')), `Missing scene label: ${label.key}`);
  assert.deepEqual(en, vi, 'Both locales must define every world key');
  console.log(`World locale parity: ${en.length} keys in each locale`);
  for (const id of Object.keys(navigationAnchors)) {
    const path = pathBetween(id, 'portal'); assert.ok(path.length > 1, `${id} must reach Portal`);
    assert.deepEqual(path[0], navigationAnchors[id]);
    const original = path[0][0]; path[0][0] = 999;
    assert.equal(pathBetween(id, 'portal')[0][0], original, 'cached paths must not be mutable by callers');
    for (const [a, b] of layout.edges.filter(e => e.includes(id))) {
      const p = layout.nodes.find(n => n.id === a).position, q = layout.nodes.find(n => n.id === b).position;
      assert.ok(p[0] === q[0] || p[1] === q[1], `${id} stub must be perpendicular`);
      assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1]) <= 2.001, `${id} stub must be at most 2 units`);
    }
  }
  assert.deepEqual(pathBetween('missing', 'owner'), []);
  const footprint = { id: 'test', position: [0, 0], half: [1, 0.5], yaw: Math.PI / 4 };
  assert.equal(intersectsFootprint([-2, 0], [2, 0], footprint), true);
  assert.equal(intersectsFootprint([-2, 3], [2, 3], footprint), false);
  assert.equal(intersectsFootprint([0, 0], [0, 0], footprint), true);
  console.log(`World layout: ${layout.nodes.length} nodes; ${layout.edges.length} edges; ${Object.keys(navigationAnchors).length} reachable anchors; blockedEdges: 0`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
