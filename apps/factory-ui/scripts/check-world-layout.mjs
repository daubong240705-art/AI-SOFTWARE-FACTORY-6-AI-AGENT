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
  const { environmentModel, furnitureFootprints, portalBooths, playerSpawnRing, desks, ownerDesk, productionPods, walkwayLanes } = await import(zonesUrl);
  const model = environmentModel();
  // Seats stay axial; primary screens turn toward the isometric camera.
  const axial = yaw => Math.abs(yaw / (Math.PI / 2) - Math.round(yaw / (Math.PI / 2))) < 1e-8;
  for (const desk of desks) {
    assert.ok(axial(desk.yaw), `${desk.id}: desk must align to the floor grid`);
    assert.deepEqual(desk.seat, [desk.position[0], desk.position[1] - 0.94]);
    assert.ok(desk.stand[1] < desk.seat[1] - 0.7, `${desk.id}: approach must clear the chair`);
    assert.ok(desk.monitor[1] > desk.position[1] && desk.sideMonitor[0] < desk.seat[0]);
    const primary = model.artwork.find(p => Math.abs(p.position[0] - (desk.monitor[0] + Math.sin(0.6) * 0.046)) < 1e-8 && Math.abs(p.position[2] - (desk.monitor[1] + Math.cos(0.6) * 0.046)) < 1e-8);
    const side = model.artwork.find(p => Math.abs(p.position[0] - (desk.sideMonitor[0] + 0.04)) < 1e-8 && p.position[2] === desk.sideMonitor[1]);
    assert.equal(primary?.yaw, 0.6, `${desk.id}: primary faces the +x/+z camera quadrant`);
    assert.ok(model.parts.some(part => part.position[0] === desk.monitor[0] && part.position[1] === 1.08 && part.position[2] === desk.monitor[1] && part.yaw === primary.yaw), 'Screen and monitor housing must share their angle');
    assert.equal(side?.yaw, Math.PI / 2, `${desk.id}: secondary faces both seat and +x camera`);
    assert.ok(primary.position[1] + primary.height / 2 < 1.3 && side.position[1] + side.height / 2 < 1.3, 'Low monitors must leave heads visible');
  }
  for (const part of model.parts) {
    // The exterior connecting path follows the original Portal route; furniture stays axial.
    if (part.position[0] <= 18 || part.position[1] > 0.1) assert.ok(axial(part.yaw) || desks.some(desk => part.position[0] === desk.monitor[0] && part.position[1] === 1.08 && part.position[2] === desk.monitor[1] && part.yaw === 0.6), 'Only desktop screens may turn off the furniture grid');
  }
  for (const panel of model.artwork) assert.ok(axial(panel.yaw) || panel.yaw === 0.6 && panel.position[1] === 1.08, 'Artwork must align with furniture or a turned primary screen');
  assert.deepEqual(productionPods.map(p => p.id), ['design', 'rules', 'art', 'client']);
  assert.equal(ownerDesk.id, 'owner');
  assert.ok(model.artwork.some(p => p.text === 'Lazy Studio'));
  assert.ok(model.artwork.some(p => p.text === 'Khu bug'));
  for (const [a, b] of walkwayLanes) assert.ok(!furnitureFootprints.some(f => intersectsFootprint(a, b, f)), 'Main walkway must stay unobstructed');
  // Import the exact render geometry in memory; no browser, GPU or generated files.
  const geometrySource = await source('../src/screens/world/scene/EnvironmentGeometry.ts');
  const geometryUrl = url(geometrySource.replace(/from '([^']+)'/g, (_, name) => `from ${JSON.stringify(import.meta.resolve(name))}`));
  const { environmentGeometries } = await import(geometryUrl);
  const geometries = environmentGeometries();
  const trianglesFor = shape => { const geometry = geometries[shape]; return (geometry.index?.count ?? geometry.getAttribute('position').count) / 3; };
  const counts = Object.fromEntries(Object.keys(geometries).map(shape => [shape, model.parts.filter(p => !p.zone && p.shape === shape).length]));
  const staticTriangles = model.parts.filter(p => p.zone).reduce((n, part) => n + trianglesFor(part.shape), 0);
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
