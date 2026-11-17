// Offline CPU verification; run from apps/factory-ui: node src/screens/world/characters/verify.mjs
// Transpile the TS modules in memory. Only Vite's URL glob and unused 2D artwork rendering are omitted.
import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import assert from 'node:assert/strict';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL) {
      const base = new URL(specifier, context.parentURL);
      for (const suffix of ['.ts', '.tsx', '/index.ts']) if (existsSync(fileURLToPath(base) + suffix)) return { url: base.href + suffix, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!/\.tsx?$/.test(url)) return next(url, context);
    let source = readFileSync(fileURLToPath(url), 'utf8');
    if (url.endsWith('/OriginalMascot.tsx')) source = source.slice(0, source.indexOf('const url =')).replace(/const urls = .*\n/, '');
    if (url.endsWith('/skins.ts')) source = source.match(/export function seatHash[^\n]+/)[0];
    return { format: 'module', source: ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText, shortCircuit: true };
  },
});
// No browser, WebGL, image rasterization, or network is used. This stub only permits atlas resource construction.
const drawnLabels = [];
globalThis.document = { createElement(name) {
  assert.equal(name, 'canvas');
  return { width: 0, height: 0, getContext() { return { clearRect() {}, beginPath() {}, roundRect() {}, fill() {}, stroke() {}, fillText(label) { drawnLabels.push(label); } }; } };
} };
const local = name => import(new URL(`./${name}.ts`, import.meta.url));
const { characterSpecs, characterCodes, specForSeat } = await local('specs');
const { artCode } = await import(new URL('../../../components/mascot/OriginalMascot.tsx', import.meta.url));
const { seatHash } = await import(new URL('../../../components/mascot/skins.ts', import.meta.url));
const { buildCharacter, characterStats, disposeCharacterCache, retainCharacterAssets } = await local('build');
const { characterPoses, samplePose, blendPose, hopAlong, phaseForSeat } = await local('poses');
const { poseLabels } = await local('../copy');
const { glyphGeometry, glyphMesh } = await local('resources');
const { Box3 } = await import('three');
const fixtures = { Lead: 'LEAD', 'Game Designer': 'BA', 'Rules Engineer': 'BE', 'UI Artist': 'FE', 'Client Engineer': 'DEVOPS', 'QA Engineer': 'TEST', 'Product Strategist': 'PM', 'Gameplay Engineer': 'MINT', 'Network Engineer': 'PLUM' };
for (const [seat, code] of Object.entries(fixtures)) assert.equal(specForSeat(seat).code, code);
for (const seat of [...Object.keys(fixtures), 'Unknown', 'unicode 🦊']) assert.equal(specForSeat(seat).code, artCode(seat, seatHash(seat)));
assert.equal(specForSeat('Unmapped', true).code, 'LEAD');
assert.equal(new Set(characterCodes.map(code => Math.round(phaseForSeat(code) * 100))).size, 9, 'Short seat names have distinct animation phases');
const materials = new Set(); let highMax = 0; let lowMax = 0; let trianglesMax = 0;
function assertFrameClose(actual, expected) {
  for (const key of Object.keys(actual)) {
    if (typeof actual[key] === 'number') assert(Math.abs(actual[key] - expected[key]) < 1e-12, key);
    else assert.equal(actual[key], expected[key]);
  }
}
for (const code of characterCodes) {
  let previous;
  for (const quality of ['high', 'low']) {
    const group = buildCharacter(characterSpecs[code], quality);
    if (previous) assert.equal(group.getObjectByName('solid').geometry, previous.getObjectByName('solid').geometry);
    previous = group;
    // Measure the body/ears/accessories; invisible effect billboards intentionally sit above the silhouette.
    const bounds = new Box3().setFromObject(group.getObjectByName('solid'), true);
    assert(bounds.max.y < 1.18 && bounds.min.y > 0, `${code} height/ground: ${bounds.min.y}..${bounds.max.y}`);
    assert(Boolean(group.getObjectByName('outline')) === (quality === 'high'));
    for (const pose of characterPoses) {
      assert(poseLabels[pose].vi && poseLabels[pose].en);
      const frame = samplePose(pose, 2, phaseForSeat(code));
      group.getObjectByName('eyes-open').visible = !frame.closed; group.getObjectByName('eyes-closed').visible = frame.closed;
      const effects = group.getObjectByName('effects'); effects.visible = frame.effect !== null;
      effects.children.forEach(mark => { mark.visible = mark.name === frame.effect || (frame.effect === '✦' && mark.name === 'sparkle-2'); });
      let calls = 0; let triangles = 0;
      group.traverseVisible(object => {
        if (!object.isMesh && !object.isSprite) return;
        calls++; materials.add(object.material);
        const geometry = object.geometry; assert(geometry);
        triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3;
        assert.equal(geometry.groups.length, 0, 'Merged geometry has no material groups/extra draws');
        for (const attribute of Object.values(geometry.attributes)) assert(Array.from(attribute.array).every(Number.isFinite));
        if (object.material.vertexColors) assert(geometry.attributes.color);
      });
      if (quality === 'high') highMax = Math.max(highMax, calls); else lowMax = Math.max(lowMax, calls);
      trianglesMax = Math.max(trianglesMax, triangles);
      assert(calls <= (quality === 'high' ? 8 : 4), `${code}/${pose}/${quality}: ${calls} calls`);
      const stillA = samplePose(pose, 0, 2, true); const stillB = samplePose(pose, 999, 90, true); assert.deepEqual(stillA, stillB);
      for (let t = 0; t < 60; t += 0.137) {
        const sampled = samplePose(pose, t, phaseForSeat(code));
        for (const value of Object.values(sampled)) if (typeof value === 'number') assert(Number.isFinite(value));
        assert(sampled.sx > 0 && sampled.sy > 0 && sampled.sz > 0);
      }
      assertFrameClose(blendPose(frame, stillA, 1), stillA);
      assertFrameClose(blendPose(frame, stillA, 0), frame);
    }
  }
}
// Every label is in the one canvas atlas; all UVs stay within its intended tile.
for (const label of [...characterCodes, ...Object.values(poseLabels).flatMap(value => [value.vi, value.en])]) {
  assert(drawnLabels.includes(label));
  const geometry = glyphGeometry(label); assert.equal(glyphGeometry(label), geometry);
  assert(Array.from(geometry.attributes.uv.array).every(value => value >= 0 && value <= 1));
  materials.add(glyphMesh(label, 1, 1).material);
}
assert.equal(materials.size, 4); assert.equal(characterStats().built, 9);
const path = hopAlong([[0, 0], [1, 0], [1, 1]], 1);
assert.equal(path.duration, 2); assert.deepEqual(path.sample(2).position, [1, 0, 1]); assert(path.sample(2).done);
assert(path.sample(0.25).position[1] > 0); assert.deepEqual(path.sample(0.5), path.sample(0.5));
assert.deepEqual(hopAlong([], 1).sample(2).position, [0, 0, 0]);
assert.deepEqual(hopAlong([[2, 3], [2, 3]], 1).sample(0).position, [2, 0, 3]);
assert.deepEqual(hopAlong([{ x: 2, y: 3, z: 4 }], 1).sample(0).position, [2, 3, 4]);
assert.throws(() => hopAlong([[0, 0]], 0)); assert.throws(() => hopAlong([[NaN, 0]], 1));
assert(samplePose('attention', 0.4, 0).y > 0); assert(samplePose('attention', 0.8, 0).sy < 1);
assert(samplePose('success', 0.3, 0).y > 0); assert(samplePose('success', 1.0, 0).y > 0); assert.equal(samplePose('success', 2, 0).y, 0);
assert(samplePose('resting', 3, 0).closed);
console.log(JSON.stringify({ specs: characterCodes.length, poses: characterPoses.length, highMax, lowMax, sharedMaterials: materials.size, trianglesMax, stats: characterStats() }));
// A cancelled final release must preserve assets (StrictMode replay), then the last release disposes them.
const releaseA = retainCharacterAssets(() => {}); releaseA();
const releaseB = retainCharacterAssets(() => {});
await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(characterStats().built, 9);
releaseB(); await new Promise(resolve => setTimeout(resolve, 5));
assert.equal(characterStats().built, 0); assert.equal(characterStats().sharedMaterials, 0);
disposeCharacterCache();
console.log('Geometry, mapping, poses, still frames, vi/en labels, paths and disposal: PASS (canvas stub; no WebGL/browser).');
