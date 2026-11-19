// CPU checks only: no browser, network, sockets or generated build files.
import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import assert from 'node:assert/strict';
registerHooks({
  resolve(specifier, context, next) {
    // Event trackers do not translate; keep their render-only i18n import inert in this CPU process.
    if (specifier === '@/i18n') return { url: 'data:text/javascript,export const i18n={t:k=>k};export const useT=()=>i18n.t;', shortCircuit: true };
    if (specifier.startsWith('.') && context.parentURL) {
      const base = new URL(specifier, context.parentURL);
      for (const suffix of ['.ts', '.tsx', '/index.ts']) if (existsSync(fileURLToPath(base) + suffix)) return { url: base.href + suffix, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!/\.tsx?$/.test(url)) return next(url, context);
    return { format: 'module', source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText, shortCircuit: true };
  },
});
const frames = [];
globalThis.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
const flush = () => { while (frames.length) frames.shift()(0); };
const noop = () => {};
const labels = [];
const ctx = new Proxy({ createLinearGradient: () => ({ addColorStop: noop }), createRadialGradient: () => ({ addColorStop: noop }), fillText: label => labels.push(label) }, { get: (o, key) => o[key] ?? noop, set: (o, key, value) => { o[key] = value; return true; } });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
const { makeFunProps } = await import('./FunProps.tsx');
const { deriveWorld } = await import('../../data/deriveWorld.ts');
const { auraFor } = await import('../effects/Aura.tsx');
const { Box3 } = await import('three');
const model = deriveWorld({ interactions: {}, tasks: {}, workflows: {}, reports: {}, releases: {} }).model;
model.agents = Array.from({ length: 10 }, (_, i) => ({ seatId: String(i), status: 'working' }));
const positions = { current: new Map() }, debug = { current: { agents: [] } };
for (const low of [false, true]) {
  const props = makeFunProps(low, noop);
  props.paint({ model, reports: {}, debug, positions, locale: 'en' }, new Date(2026, 10, 19, 23));
  flush();
  props.sample(10, true);
  assert.equal(props.group.getObjectByName('server-leds').count, 10);
  const fan = props.group.getObjectByName('standing-fan');
  assert(fan && fan.position.y < 1.5 && fan.position.x < -10, 'compact lounge fan');
  assert.equal(props.group.getObjectByName('aquarium-fish').count, low ? 3 : 5);
  let draws = 0;
  props.group.traverse(o => {
    if (!o.isMesh || o.count === 0) return;
    draws++;
    assert(!Array.from(o.geometry.attributes.position.array).some(x => !Number.isFinite(x)));
    if (o.isInstancedMesh) assert(!Array.from(o.instanceMatrix.array).some(x => !Number.isFinite(x)));
  });
  assert(draws <= 11, `prop draws ${draws}`);
  assert.equal(props.group.getObjectByName('ping-pong-ball').count, 0);
  debug.current.agents = ['left', 'right'].map(seatId => ({ seatId, activity: 'ping-pong', walking: false, status: 'idle' }));
  props.sample(11, true); assert.equal(props.group.getObjectByName('ping-pong-ball').count, 1);
  debug.current.agents[0].status = 'working';
  props.sample(12, true); assert.equal(props.group.getObjectByName('ping-pong-ball').count, 0);
  props.sample(0, false);
  const snapshot = [];
  props.group.traverse(o => { if (o.isInstancedMesh) snapshot.push(...o.instanceMatrix.array); });
  props.sample(999, false);
  const next = []; props.group.traverse(o => { if (o.isInstancedMesh) next.push(...o.instanceMatrix.array); });
  assert.deepEqual(next, snapshot, 'still prop instances do not move');
  assert(new Box3().setFromObject(props.group).max.y < 4);
  assert(labels.some(l => l.includes('—')), 'missing source data is unknown');
  console.log(`${low ? 'low' : 'high'} props: ${draws} draws (+1 paired ball); LED count, fish, work interruption, still frames, finite geometry PASS`);
  props.dispose(); debug.current.agents = [];
}
const idle = { status: 'idle', pose: 'resting', runs: [] };
assert.equal(auraFor(idle), 'chill');
assert.equal(auraFor({ ...idle, paused: true }), null);
assert.equal(auraFor({ ...idle, status: 'problem' }), 'storm');
assert.equal(auraFor({ ...idle, status: 'waiting' }), 'alarm');
assert.equal(auraFor({ ...idle, status: 'done' }), 'stars');
assert.equal(auraFor({ ...idle, status: 'working', runs: [{ startedAt: new Date(0).toISOString() }] }, 21 * 60000), 'super');
console.log('Aura state selection: PASS');

const { LabEventTracker } = await import('../lab/BugMonsters.tsx');
const bug = { id: 'b', projectId: 'p', criterion: 'test', evidence: null, state: 'open' };
const defeated = { type: 'bugDefeated', id: 'qa:passed', at: new Date().toISOString(), bug };
const tracker = new LabEventTracker();
tracker.observe([], [bug], 1, false); tracker.positions.set('b', { x: 12, z: -5 });
tracker.observe([defeated], [], 2, false);
assert.equal(tracker.struck, 2); assert.equal(tracker.exits.length, 1); assert.equal(tracker.defeated, 1);
tracker.observe([defeated], [], 2.1, false); assert.equal(tracker.exits.length, 1, 'acknowledgement cannot replay QA');
tracker.expire(4); assert.equal(tracker.exits.length, 0);
const quietTracker = new LabEventTracker(); quietTracker.observe([], [bug], 1, true);
quietTracker.positions.set('b', { x: 12, z: -5 }); quietTracker.observe([defeated], [], 2, true);
assert.equal(quietTracker.struck, 0); assert.equal(quietTracker.exits.length, 0); assert.equal(quietTracker.puffs.length, 0);
console.log('QA gong/bug exits: event-only, once, expires, still/off suppression PASS');

const { toyModels } = await import('../toys/models.ts');
for (const [name, geometry] of Object.entries(toyModels)) {
  assert.equal(geometry.groups.length, 0, `${name}: one merged draw`);
  for (const attribute of Object.values(geometry.attributes)) assert(Array.from(attribute.array).every(Number.isFinite));
}
const { sampleOiia, oiiaModel } = await import('./OiiaCat.tsx');
assert.equal(oiiaModel.groups.length, 0);
assert(Math.abs(sampleOiia(4).yaw - Math.PI * 32) < 1e-9, 'spin settles to its original facing');
assert.equal(sampleOiia(4).bow, 0); assert(sampleOiia(3.8).bow > 0.25);
const speedAt = t => (sampleOiia(t + 0.001).yaw - sampleOiia(t).yaw) / 0.001;
assert(speedAt(0.4) > speedAt(0.1)); assert(speedAt(3.5) < speedAt(3.1));
const { furnitureFootprints, oiiaSpot } = await import('../../layout/zones.ts');
const { layout } = await import('../../layout/waypoints.ts');
assert.deepEqual(furnitureFootprints.find(f => f.id === 'oiia-cat').position, oiiaSpot);
assert.equal(layout.blockedEdges, 0);
// +X is the office cat's nose; after the yaw correction it must align with hopAlong's +Z tangent.
const { Vector3 } = await import('three');
const props = makeFunProps(false, noop);
props.paint({ model, reports: {}, debug, positions, locale: 'en' }, new Date());
props.sample(10, true); props.sample(10.2, true);
const cat = props.group.getObjectByName('office-cat'), previous = cat.position.clone();
props.sample(10.4, true);
const travel = cat.position.clone().sub(previous); travel.y = 0; travel.normalize();
assert(new Vector3(1, 0, 0).applyEuler(cat.rotation).dot(travel) > 0.98, 'cat walks nose first');
assert.equal(cat.rotation.x, 0); assert.equal(cat.rotation.z, 0);
assert.notEqual(cat.getObjectByName('office-cat-tail').rotation.y, 0);
props.sample(0, false); assert.equal(cat.getObjectByName('office-cat-tail').rotation.y, 0);
props.dispose();
console.log('W-18: merged toys, spin acceleration/braking/bow, footprint, blockedEdges=0, cat facing/upright/walk cycle PASS');

// W-18b: geometry, shared particle capacity and reaction paint can be checked without a GPU.
const { detailedToys, lightToys, actionAge, createWhipMaterials } = await import('../toys/models.ts');
for (const name of Object.keys(detailedToys)) {
  const rich = detailedToys[name], light = lightToys[name];
  assert(light.solid.attributes.position.count < rich.solid.attributes.position.count, `${name}: low LOD is smaller`);
  for (const g of [rich.solid, rich.hull, light.solid]) {
    assert.equal(g.groups.length, 0);
    for (const attr of Object.values(g.attributes)) assert(Array.from(attr.array).every(Number.isFinite));
  }
  assert.equal(rich.solid.attributes.position.count, rich.hull.attributes.position.count, 'outline follows detail');
  rich.solid.computeBoundingBox();
}
assert(detailedToys.whip.solid.boundingBox.max.x - detailedToys.whip.solid.boundingBox.min.x > 2);
assert(detailedToys.hammer.solid.boundingBox.max.x - detailedToys.hammer.solid.boundingBox.min.x > 1);
assert(detailedToys.feather.solid.boundingBox.max.y - detailedToys.feather.solid.boundingBox.min.y > 1.4);
assert(detailedToys.taser.glow.attributes.position.count > 0, 'separate luminous prongs/battery');
assert.equal(actionAge(10000, 10680), actionAge(10000, 10749));
const leather = createWhipMaterials(), shader = { uniforms: {}, vertexShader: '#include <begin_vertex>' };
leather.solid.onBeforeCompile(shader);
assert(shader.vertexShader.includes('transformed.y += wave'));
assert.equal(shader.uniforms.uToyAge, leather.clock);
leather.solid.dispose(); leather.outline.dispose();
const { particleGeometry, lightParticleGeometry, lightningGeometry, particleMaterial, prepareParticleAtlas } = await import('../toys/particles.tsx');
prepareParticleAtlas(); assert(particleMaterial.uniforms.uAtlas.value.isCanvasTexture);
assert(particleGeometry.isInstancedBufferGeometry); assert.equal(particleGeometry.instanceCount, 64);
assert.equal(lightParticleGeometry.instanceCount, 12);
assert.equal(lightningGeometry.attributes.position.count, 7 * 7 * 6, 'seven branching zigzags, single glow/core draw');
const { makeReactionMarks, updateReactionMarks, disposeRigMarks, disposeReactionMarkAssets } = await import('../../characters/reactionMarks.ts');
const spec = { code: 'LEAD', colors: { body: '#FBDE72', belly: '#FBDE72', accent: '#FACF4F', inner: '#FAC078', dark: '#393F57', cheek: '#FAC078', outline: '#0E0E16' }, ears: 'none', face: { eyes: 'oval', cheeks: true }, accessories: ['crown', 'headset'] };
const marks = makeReactionMarks(spec);
const unpainted = makeReactionMarks({ ...spec, code: 'PM', face: { ...spec.face, cheeks: false } });
assert(unpainted.getObjectByName('blush').geometry.attributes.position.count > 0, 'every worker can blush, even without painted base cheeks');
for (const mark of [...marks.children, ...unpainted.children]) for (const attr of Object.values(mark.geometry.attributes)) assert(Array.from(attr.array).every(Number.isFinite));
updateReactionMarks(marks, { tool: 'taser', started: 10000 }, 11200, false);
const soot = marks.getObjectByName('soot'); assert.equal(soot.material.opacity, 1);
updateReactionMarks(marks, { tool: 'taser', started: 10000 }, 13700, false); assert(Math.abs(soot.material.opacity - 0.5) < 1e-9);
updateReactionMarks(marks, { tool: 'cookie', started: 10000 }, 11000, false); assert(marks.getObjectByName('crumbs').visible);
updateReactionMarks(marks, { tool: 'feather', started: 10000 }, 11000, false); assert(marks.getObjectByName('blush').visible);
updateReactionMarks(marks, { tool: 'taser', started: 10000 }, 11500, true); assert(!marks.visible, 'no face effects in still mode');
disposeRigMarks(marks); disposeRigMarks(unpainted); disposeReactionMarkAssets();
console.log('W-18b: tool size/LOD, braided shader, 70ms hold, GPU particle capacities, seven electric branches, face paint/five-second soot fade/still suppression PASS');

const { greeting } = await import('../walk/awareness.tsx');
assert(greeting(2.9, false, false, false).waves);
assert(!greeting(3.1, false, false, false).notices);
assert(greeting(2, true, false, false).nods && !greeting(2, true, false, false).waves);
assert(greeting(9, false, true, false).both, 'waiting workers call for help at any distance');
assert(!greeting(2, false, true, true).waves, 'sulking suppresses greetings until treated');
const { walkSceneryParts } = await import('../walk/sceneryModel.ts');
for (const p of walkSceneryParts()) assert([...p.position, ...p.scale, p.yaw].every(Number.isFinite));
const followingProps = makeFunProps(false, noop);
followingProps.paint({ model, reports: {}, debug, positions, locale: 'en' }, new Date());
const follower = followingProps.group.getObjectByName('office-cat');
follower.position.set(-8, 0.04, -1);
const random = Math.random;
try {
  Math.random = () => 0; // Force this occasional visit, independent of wall clock or luck.
  followingProps.sample(20, true, [-6, 0, -1]);
  const start = follower.position.clone();
  followingProps.sample(20.05, true, [-6, 0, -1]);
  assert(follower.position.x > start.x, 'office cat follows a nearby visitor');
  assert(follower.position.x - start.x <= 0.083, 'following speed remains bounded');
  const beforePause = follower.position.clone();
  followingProps.sample(20.1, true);
  assert(follower.position.equals(beforePause), 'visitor following stops when Walk mode pauses');
} finally { Math.random = random; followingProps.dispose(); }
console.log('W-20: greeting range, working nod, waiting arms, sulk suppression, finite scenery, occasional bounded cat follow/pause PASS');
