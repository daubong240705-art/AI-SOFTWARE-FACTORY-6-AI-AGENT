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
  const { environmentModel, furnitureFootprints, portalBooths, playerSpawnRing } = await import(zonesUrl);
  const model = environmentModel();
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
