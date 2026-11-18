// CPU checks only: no browser, network, sockets or generated build files.
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
    return { format: 'module', source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText, shortCircuit: true };
  },
});
const noop = () => {};
const labels = [];
const ctx = new Proxy({ createLinearGradient: () => ({ addColorStop: noop }), fillText: label => labels.push(label) }, { get: (o, key) => o[key] ?? noop, set: (o, key, value) => { o[key] = value; return true; } });
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
  props.sample(10, true);
  assert.equal(props.group.getObjectByName('server-leds').count, 10);
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
