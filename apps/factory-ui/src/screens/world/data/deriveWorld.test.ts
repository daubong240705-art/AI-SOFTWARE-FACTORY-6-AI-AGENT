import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { assignDesks } from './assignDesks';
import { createWorldPoller, type PollClock, type PollJob } from './poller';
function fakeClock() {
    const pending = new Map<number, {
        fn: () => void;
        ms: number;
    }>();
    let id = 0;
    const clock: PollClock = { set: (fn, ms) => { pending.set(++id, { fn, ms }); return id; }, clear: id => { pending.delete(id as number); }, random: () => 0.5 };
    return { pending, clock, fire() { const entry = pending.entries().next().value; assert.ok(entry); pending.delete(entry[0]); entry[1].fn(); } };
}
const flush = async () => { for (let i = 0; i < 10; i++)
    await Promise.resolve(); };
test('poller serializes invalidations, cancels on hidden/stop and does not repeat once-only reads', async () => {
    const timer = fakeClock();
    let hidden = false;
    let runs = 0;
    let finish = () => { };
    let signal: AbortSignal | undefined;
    const job: PollJob = { key: 'key', interval: 5000, run: s => { runs++; signal = s; return new Promise<void>(r => { finish = r; }); } };
    const poller = createWorldPoller({ clock: timer.clock, hidden: () => hidden, onError: () => assert.fail('unexpected error') });
    poller.sync([job]);
    poller.refresh('key');
    poller.refresh('key');
    assert.equal(runs, 1);
    finish();
    await flush();
    timer.fire();
    assert.equal(runs, 2);
    hidden = true;
    poller.visibility();
    assert.equal(signal?.aborted, true);
    finish();
    await flush();
    assert.equal(timer.pending.size, 0);
    hidden = false;
    poller.visibility();
    assert.equal(runs, 3);
    poller.stop();
    assert.equal(signal?.aborted, true);
    finish();
    await flush();
    assert.equal(timer.pending.size, 0);
    const once = createWorldPoller({ clock: timer.clock, hidden: () => false, onError: () => { } });
    once.sync([{ key: 'projects', interval: Infinity, run: async () => { } }]);
    await flush();
    assert.equal(timer.pending.size, 0);
    once.stop();
});
test('poller backs off failures to 60 seconds and recovers to its normal interval', async () => {
    const timer = fakeClock();
    let failed = true;
    let errors = 0;
    const poller = createWorldPoller({ clock: timer.clock, hidden: () => false, onError: () => { errors++; } });
    poller.sync([{ key: 'activity', interval: 5000, run: async () => { if (failed)
                throw new Error('safe test failure'); } }]);
    for (const delay of [10000, 20000, 40000, 60000]) {
        await flush();
        assert.equal([...timer.pending.values()][0]?.ms, delay);
        timer.fire();
    }
    failed = false;
    await flush();
    timer.fire();
    await flush();
    assert.equal([...timer.pending.values()][0]?.ms, 5000);
    assert.equal(errors, 5);
    poller.stop();
});

test('jitter includes both ends of the ten-percent range and every roster agent gets a slot', async () => {
  for (const [random, expected] of [[0, 54000], [1, 66000]] as const) {
    const timer = fakeClock(); timer.clock.random = () => random;
    const poller = createWorldPoller({clock: timer.clock, hidden: () => false, onError: () => {}});
    poller.sync([{key: 'teams', interval: 60000, run: async () => {}}]); await flush();
    assert.equal([...timer.pending.values()][0]?.ms, expected); poller.stop();
  }
  const pods = ['lead', 'a', 'b', 'c', 'd', 'east', 'annex'] as const;
  const assignments = assignDesks(pods.flatMap(podKey => Array.from({length: 6}, (_,i) => ({seatId: `${podKey}:${i}`, podKey}))));
  assert.equal(Object.values(assignments).filter(slot => !slot.overflow).length, 42);
  assert.equal(new Set(Object.values(assignments).map(slot => slot.slotIndex)).size, 42);
  assert.equal(assignments['lead:0']?.slotIndex, 0);
});

test('removing and re-adding a key waits for the aborted request to settle', async () => {
  const timer = fakeClock(); let runs = 0; let finish = () => {};
  const job: PollJob = {key: 'focus', interval: 15000, run: () => {runs++; return new Promise<void>(resolve => {finish = resolve;});}};
  const poller = createWorldPoller({clock: timer.clock, hidden: () => false, onError: () => {}});
  poller.sync([job]); poller.sync([]); poller.sync([job]); assert.equal(runs, 1);
  finish(); await flush(); timer.fire(); assert.equal(runs, 2);
  poller.stop(); finish(); await flush();
});

test('activity anchors remain reachable and every navigation edge avoids prop footprints', async () => {
  const { layout, navigationAnchors, pathBetween } = await import('../layout/waypoints');
  assert.equal(layout.blockedEdges, 0);
  for (const id of ['coffee', 'cat', 'plant-water', 'ping-left', 'ping-right', 'rest-1']) {
    assert.ok(navigationAnchors[id]);
    assert.ok(pathBetween('rules-2', id).length >= 2, `unreachable ${id}`);
  }
});
test('leisure reserves two real idle players together and real work interrupts both', async () => {
  const { WanderingDirector } = await import('../scene/wandering');
  const director = new WanderingDirector();
  const people = ['a', 'b'].map(seatId => ({ seatId, idle: true, desk: [0, 0] as const, home: seatId }));
  const spots = [{ id: 'ping-left', point: [-5.4, 2.2] as const }, { id: 'ping-right', point: [-1, 2.2] as const }];
  director.update(people, spots, 0, true, 3);
  let departures = director.update(people, spots, 60000, true, 3);
  for (let i = 1; !departures.length && i < 20; i++) departures = director.update(people, spots, 60000 + i, true, 3);
  assert.equal(departures.length, 2);
  assert.equal(director.reservedSpots().size, 2);
  director.arrive('a', 61000); director.arrive('b', 62000);
  assert.equal(director.activity('a'), 'ping-pong'); assert.equal(director.activity('b'), 'ping-pong');
  people[0]!.idle = false;
  const returns = director.update(people, spots, 63000, true, 3);
  assert.equal(returns.length, 2); assert.ok(returns.every(a => a.urgent));
  assert.equal(director.activity('a'), null); assert.equal(director.activity('b'), null);
  director.update(people, spots, 64000, false, 0);
  assert.equal(director.reservedSpots().size, 0);
});
test('toys stay local, enforce cooldown and concurrency, expire buffs, and roll counters at local midnight', async () => {
  const { ToyStore, localDay } = await import('../scene/toys/store');
  const now = +new Date(2026, 10, 19, 23, 59, 50), saved = new Map<string, string>();
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); } };
  const state = new ToyStore(storage);
  assert.equal(state.snapshot().sound, false);
  assert.equal(state.apply('a', 'coffee', false, now), true);
  assert.equal(state.apply('a', 'hammer', false, now + 999), false);
  assert.equal(state.apply('b', 'megaphone', false, now), true);
  assert.equal(state.apply('c', 'whip', false, now), true);
  assert.equal(state.apply('d', 'cookie', false, now + 1000), false);
  assert.equal(state.snapshot().active[0]!.until, now + 10000);
  state.refresh(now + 3000); assert.equal(state.snapshot().active.length, 2);
  assert.equal(state.apply('d', 'cookie', true, now + 3000), true);
  assert.equal(state.snapshot().active.find(e => e.worker === 'd')!.quiet, true);
  state.refresh(now + 10000); assert.equal(state.snapshot().active.length, 0);
  assert.equal(state.snapshot().day, localDay(new Date(now + 10000))); assert.deepEqual(state.snapshot().counts, {});
  state.mute(); assert.equal(new ToyStore(storage).snapshot().sound, true);
  const broken = new ToyStore({ getItem: () => '{broken', setItem: () => { throw Error('blocked'); } });
  assert.equal(broken.apply('a', 'whip', true, now), true);
});

test('toy modules have no runtime path to work commands or networking', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const folder = new URL('../scene/toys/', import.meta.url);
  for (const file of readdirSync(folder).filter(f => /\.tsx?$/.test(f))) {
    const source = readFileSync(new URL(file, folder), 'utf8');
    assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|WebSocket|sendBeacon)\b|@\/state|@\/api|\.dispatch\(|\.command\(/, file);
    for (const match of source.matchAll(/import\s+(?!type\b).*?from ['"]([^'"]+)['"]/g)) {
      assert.ok(/^(react|three|@react-three\/fiber|@\/i18n|@\/components\/ui\/button|\.\/|\.\.\/(Ticker|screenTexture|props\/geometry)|\.\.\/\.\.\/layout\/zones)/.test(match[1]!), `${file}: ${match[1]}`);
    }
  }
});

test('toy reactions are additive, finite, spring back, and expire without changing work pose', async () => {
  const { reactToToy } = await import('../characters/reaction');
  const base = { y: 0, sx: 1, sy: 1, sz: 1, rx: 0.12, ry: 0, rz: 0, closed: false, effect: null, effectY: 0, sparkle: 1 };
  const { tools, ToyStore } = await import('../scene/toys/store');
  for (const tool of tools) {
    const reaction = { tool, started: 10000 };
    for (let age = 0; age < 3100; age += 17) {
      const result = reactToToy(base, reaction, 10000 + age);
      assert(Object.values(result.frame).filter(v => typeof v === 'number').every(Number.isFinite));
      assert(result.frame.sx > 0 && result.frame.sy > 0 && result.frame.sz > 0);
    }
    assert.deepEqual(reactToToy(base, reaction, 13100).frame, base);
  }
  assert.equal(base.sy, 1);
  assert(reactToToy(base, { tool: 'hammer', started: 10000 }, 10750).frame.sy < 0.25);
  assert(reactToToy(base, { tool: 'hammer', started: 10000 }, 11250).frame.y > 0.3);
  assert(reactToToy(base, { tool: 'whip', started: 10000 }, 10850).x > 0.2);
  assert(reactToToy(base, { tool: 'taser', started: 10000 }, 10800).ears > 0.9);
  assert.equal(reactToToy(base, undefined, 10800).flash, false);
  const store = new ToyStore(); store.spin(); store.spin();
  assert.equal(store.snapshot().oiiaSpins, 2); assert.equal(store.snapshot().active.length, 0);
});


test('W-18b combos expire, six hits sulk locally, treats bypass cooldown, and moods are not persisted', async () => {
  const { ToyStore } = await import('../scene/toys/store');
  const now = +new Date(2026, 10, 19, 12), saved = new Map<string, string>();
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); } };
  for (const treat of ['coffee', 'cookie'] as const) {
    const state = new ToyStore(storage);
    for (let i = 0; i < 6; i++) assert.equal(state.apply('a', 'whip', false, now + i * 1100), true);
    assert.equal(state.snapshot().combo[0]!.count, 6);
    assert.equal(state.snapshot().sulking[0]!.until, now + 15500);
    assert.equal(state.apply('a', 'hammer', false, now + 6600), false, 'sulking ignores rough toys');
    assert.equal(state.apply('a', treat, false, now + 5600), true, 'treat cheers immediately during cooldown');
    assert.equal(state.snapshot().sulking.length, 0);
    assert.equal(state.snapshot().active[0]!.cheered, true);
    assert.equal(state.snapshot().combo[0]!.count, 1);
    state.refresh(now + 9600); assert.equal(state.snapshot().combo.length, 0);
    assert.equal(state.apply('b', 'taser', false, now + 9600), true);
    assert.equal(state.snapshot().active.find(e => e.worker === 'b')!.until, now + 15800);
    const restored = new ToyStore(storage);
    assert.equal(restored.snapshot().sulking.length, 0); assert.equal(restored.snapshot().combo.length, 0);
  }
  const state = new ToyStore();
  for(let i=0;i<6;i++) state.apply('a','feather',true,now+i*1100);
  state.refresh(now+15500);assert.equal(state.snapshot().sulking.length,0);
  assert.equal(state.apply('a','whip',false,now+15500),true);
  assert.equal(state.snapshot().combo[0]!.count,1);
  state.spin(true,true,now); assert.equal(state.snapshot().oiiaMegaSpins,1); assert.equal(state.snapshot().catSpin.audience,true);
  state.clear(); assert.equal(state.snapshot().sulking.length,0); assert.equal(state.snapshot().catSpin.started,0);
});

test('W-18b impact hold lasts 70ms, combos intensify knockback, and sulking restores facing', async () => {
  const { reactToToy } = await import('../characters/reaction');
  const base = { y: 0, sx: 1, sy: 1, sz: 1, rx: 0, ry: 0, rz: 0, closed: false, effect: null, effectY: 0, sparkle: 1 };
  const reaction = { tool: 'whip' as const, started: 10000, combo: 3, sulkUntil: 21000 };
  assert.deepEqual(reactToToy(base,reaction,10680),reactToToy(base,reaction,10749));
  assert(reactToToy(base,reaction,10850).x > reactToToy(base,{...reaction,combo:1},10850).x);
  assert.equal(reactToToy(base,reaction,13000).frame.ry,Math.PI);
  assert.equal(reactToToy(base,reaction,21000).frame.ry,0);
});
