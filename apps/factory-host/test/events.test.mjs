import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { API_VERSION, classifyEvent, eventSchema, uuidV7Schema } from "@factory/contracts";
import { EventHub } from "../dist/events/index.js";
import { openStorage } from "../dist/storage/index.js";
import { createIdGenerator, systemClock } from "../dist/ids.js";

const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));
const clock = () => new Date("2026-11-07T10:00:00.000Z");
const id = createIdGenerator(clock);
const p = id();
const q = id();
const causationId = id();
const payload = { type: "entity.changed", entity: { kind: "project", id: p, revision: 1 } };
const input = (projectId = p) => ({ projectId, payload, causationId });
const project = (raw, projectId) => raw.prepare("INSERT INTO projects VALUES (?, 1, 'Demo', 'directory', '/srv/demo', 'active')").run(projectId);

function setup(t, file = ":memory:", options = {}) {
  const storage = openStorage(file);
  t.after(() => storage.close());
  storage.migrate({ migrationsDir, backupDir: null });
  const hub = new EventHub(storage.raw, { clock, ...options });
  return { storage, raw: storage.raw, hub };
}

function fixture(t) {
  const result = setup(t);
  for (const projectId of [p, q]) {
    project(result.raw, projectId);
    result.hub.ensureStream(projectId);
  }
  return result;
}

function filePath() {
  const dir = mkdtempSync(join(tmpdir(), "factory-events-"));
  // Register before opening storage; explicitly close connections before removing the directory.
  return { file: join(dir, "host.db"), clean: () => rmSync(dir, { recursive: true, force: true }) };
}

const appendMany = (hub, count, projectId = p) => hub.transaction(() => Array.from({ length: count }, () => hub.append(input(projectId))));
const zero = (hub, projectId = p) => ({ ...hub.currentCursor(projectId), sequence: "0" });
const events = (hub, projectId = p, after = zero(hub, projectId), limit = 500) => {
  const result = hub.readAfter(projectId, after, limit);
  assert.equal(result.kind, "events");
  return result;
};
const count = (raw, table) => raw.prepare(`SELECT count(*) AS count FROM ${table}`).get().count;
const seeded = (seed) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };

test("UUIDv7 IDs are canonical and strictly increasing for 5000 calls on a frozen clock", () => {
  const next = createIdGenerator(clock);
  let previous = "";
  for (let i = 0; i < 5000; i += 1) {
    const value = next();
    assert.equal(uuidV7Schema.parse(value), value);
    assert.ok(value > previous);
    previous = value;
  }
  assert.equal(Number.parseInt(previous.replaceAll("-", "").slice(0, 12), 16), clock().getTime() + 1);
  assert.ok(systemClock() instanceof Date);
});

test("UUIDv7 IDs stay increasing through a backwards and then recovering clock", () => {
  let time = clock().getTime();
  const next = createIdGenerator(() => new Date(time));
  let previous = "";
  for (let i = 0; i < 6000; i += 1) {
    time += i < 3000 ? -1 : 2;
    const value = next();
    uuidV7Schema.parse(value);
    assert.ok(value > previous);
    previous = value;
  }
});

test("ensureStream is idempotent and requires a project", (t) => {
  const { raw, hub } = setup(t);
  assert.equal(hub.currentCursor(p), null);
  assert.throws(() => hub.ensureStream(p), /FOREIGN KEY/);
  project(raw, p);
  const initial = hub.ensureStream(p);
  assert.equal(initial.sequence, "0");
  uuidV7Schema.parse(initial.epoch);
  assert.deepEqual(hub.ensureStream(p), initial);
  appendMany(hub, 1);
  assert.deepEqual(hub.ensureStream(p), { ...initial, sequence: "1" });
});

test("project sequences are contiguous and independent, with validated previousCursor chains", (t) => {
  const { hub } = fixture(t);
  const starts = new Map([[p, zero(hub)], [q, zero(hub, q)]]);
  hub.transaction(() => {
    for (let i = 0; i < 20; i += 1) {
      hub.append(input(p));
      if (i % 2 === 0) hub.append(input(q));
    }
  });
  for (const [projectId, expectedCount] of [[p, 20], [q, 10]]) {
    let cursor = starts.get(projectId);
    const all = events(hub, projectId).events;
    assert.equal(all.length, expectedCount);
    all.forEach((event, index) => {
      assert.deepEqual(eventSchema.parse(event), event);
      assert.equal(event.apiVersion, API_VERSION);
      assert.equal(event.occurredAt, clock().toISOString());
      assert.equal(event.cursor.sequence, String(index + 1));
      assert.deepEqual(event.previousCursor, cursor);
      assert.equal(classifyEvent(projectId, cursor, event), "apply");
      assert.equal(event.rootCausationId, causationId);
      cursor = event.cursor;
    });
  }
});

test("append outside a transaction throws without writing", (t) => {
  const { raw, hub } = fixture(t);
  assert.throws(() => hub.append(input()), /active transaction/);
  assert.equal(count(raw, "event_log"), 0);
  assert.equal(count(raw, "outbox"), 0);
  assert.equal(hub.currentCursor(p).sequence, "0");
});

test("append without a stream throws a clear error", (t) => {
  const { raw, hub } = setup(t);
  project(raw, p);
  assert.throws(() => hub.transaction(() => hub.append(input())), /no event stream/);
  assert.equal(count(raw, "event_log"), 0);
});

test("invalid events write nothing even when their exception is caught inside a transaction", (t) => {
  const { raw, hub } = fixture(t);
  hub.transaction(() => {
    assert.throws(() => hub.append({ ...input(), payload: { type: "unknown" } }));
    assert.throws(() => hub.append({ ...input(), causationId: "invalid" }));
    assert.equal(count(raw, "event_log"), 0);
    assert.equal(count(raw, "outbox"), 0);
    assert.equal(hub.currentCursor(p).sequence, "0");
  });
  const rootCausationId = id();
  const event = hub.transaction(() => hub.append({ ...input(), rootCausationId }));
  assert.equal(event.rootCausationId, rootCausationId);
});

test("a throwing transaction rolls back sequence, events, outbox and notifications", (t) => {
  const { raw, hub } = fixture(t);
  appendMany(hub, 1);
  const before = hub.currentCursor(p);
  const seen = [];
  hub.subscribe(p, (cursor) => seen.push(cursor));
  assert.throws(() => hub.transaction(() => {
    hub.append(input());
    hub.transaction(() => hub.append(input()));
    throw new Error("abort");
  }), /abort/);
  assert.deepEqual(hub.currentCursor(p), before);
  assert.equal(count(raw, "event_log"), 1);
  assert.equal(count(raw, "outbox"), 1);
  assert.deepEqual(seen, []);
  appendMany(hub, 1);
  assert.deepEqual(seen, [{ ...before, sequence: "2" }]);
});

test("notifications happen after the outer commit, once per project, despite a throwing listener", (t) => {
  const { raw, hub } = fixture(t);
  const seen = [];
  hub.subscribe(p, () => { throw new Error("observer failed"); });
  for (const projectId of [p, q]) hub.subscribe(projectId, (cursor) => {
    assert.equal(raw.inTransaction, false);
    seen.push([projectId, cursor]);
  });
  const result = hub.transaction(() => {
    hub.append(input());
    hub.transaction(() => { hub.append(input()); hub.append(input(q)); });
    assert.deepEqual(seen, []);
    hub.append(input(q));
    return 42;
  });
  assert.equal(result, 42);
  assert.deepEqual(seen, [[p, hub.currentCursor(p)], [q, hub.currentCursor(q)]]);
  const stop = hub.subscribe(p, () => seen.push("removed"));
  stop();
  stop();
  appendMany(hub, 1);
  assert.equal(seen.includes("removed"), false);
});

test("project and stream creation roll back together", (t) => {
  const { raw, hub } = setup(t);
  assert.throws(() => hub.transaction(() => {
    project(raw, p);
    hub.ensureStream(p);
    hub.append(input());
    throw new Error("abort creation");
  }), /abort creation/);
  assert.equal(count(raw, "projects"), 0);
  assert.equal(hub.currentCursor(p), null);
  assert.equal(count(raw, "event_log"), 0);
  assert.equal(count(raw, "outbox"), 0);
});

test("readAfter zero returns all events; pages of three resume without gaps or duplicates", (t) => {
  const { hub } = fixture(t);
  const expected = appendMany(hub, 23);
  assert.deepEqual(events(hub).events, expected);
  const received = [];
  let cursor = zero(hub);
  for (;;) {
    const page = events(hub, p, cursor, 3);
    assert.ok(page.events.length <= 3);
    received.push(...page.events);
    if (page.events.length) cursor = page.events.at(-1).cursor;
    if (!page.hasMore) break;
  }
  assert.deepEqual(received, expected);
  assert.equal(new Set(received.map((event) => event.eventId)).size, expected.length);
  assert.deepEqual(events(hub, p, cursor), { kind: "events", events: [], hasMore: false });
});

test("seeded disconnect and resume points lose or repeat no events while more are appended", (t) => {
  const { hub } = fixture(t);
  const random = seeded(0x5eed);
  const expected = [];
  const received = [];
  let cursor = zero(hub);
  for (let round = 0; round < 100; round += 1) {
    expected.push(...appendMany(hub, 1 + Math.floor(random() * 8)));
    const page = events(hub, p, cursor, 1 + Math.floor(random() * 9));
    // Only persist a prefix before disconnecting; the remainder must be replayed on resume.
    const consumed = page.events.slice(0, Math.floor(random() * (page.events.length + 1)));
    for (const event of consumed) {
      assert.deepEqual(event.previousCursor, cursor);
      cursor = event.cursor;
      received.push(event);
    }
  }
  for (;;) {
    const page = events(hub, p, cursor, 3);
    received.push(...page.events);
    if (page.events.length) cursor = page.events.at(-1).cursor;
    if (!page.hasMore) break;
  }
  assert.deepEqual(received, expected);
});

test("missing streams and changed epochs require a snapshot with epoch-changed", (t) => {
  const { hub } = fixture(t);
  const expected = { kind: "snapshot-required", reason: "epoch-changed" };
  assert.deepEqual(hub.readAfter(id(), zero(hub)), expected);
  assert.deepEqual(hub.readAfter(p, { epoch: id(), sequence: "0" }), expected);
});

test("a future sequence requires a snapshot with gap, including beyond JS safe integers", (t) => {
  const { hub } = fixture(t);
  appendMany(hub, 2);
  for (const sequence of ["3", "9007199254740993", "9223372036854775807"])
    assert.deepEqual(hub.readAfter(p, { ...zero(hub), sequence }), { kind: "snapshot-required", reason: "gap" });
});

test("readAfter never returns another project's events even when epochs match", (t) => {
  const { raw, hub } = fixture(t);
  raw.prepare("UPDATE project_streams SET epoch = ? WHERE project_id = ?").run(hub.currentCursor(p).epoch, q);
  appendMany(hub, 8);
  appendMany(hub, 9, q);
  assert.equal(events(hub).events.length, 8);
  assert.equal(events(hub, q).events.length, 9);
  assert.ok(events(hub).events.every((event) => event.projectId === p));
  assert.ok(events(hub, q).events.every((event) => event.projectId === q));
});

test("prune keeps newest N and sequence, removes outbox rows, and reports expired boundaries", (t) => {
  const { raw, hub } = fixture(t);
  const all = appendMany(hub, 10);
  appendMany(hub, 2, q);
  const last = hub.currentCursor(p);
  assert.equal(hub.prune(p, 3), 7);
  assert.deepEqual(hub.currentCursor(p), last);
  assert.equal(count(raw, "event_log"), 5);
  assert.equal(count(raw, "outbox"), 5);
  assert.deepEqual(hub.readAfter(p, all[5].cursor), { kind: "snapshot-required", reason: "expired" });
  assert.deepEqual(events(hub, p, all[6].cursor).events, all.slice(7));
  assert.deepEqual(events(hub, p, all[7].cursor).events, all.slice(8));
  assert.equal(appendMany(hub, 1)[0].cursor.sequence, "11");
  assert.equal(hub.prune(p, 20), 0);
  assert.equal(hub.prune(p, 1), 3);
  assert.throws(() => hub.prune(p, 0), /keepLast/);
  assert.throws(() => hub.prune(p, 1.5), /keepLast/);
});

test("outbox is exactly one per event; claims increment attempts and delivery is idempotent", (t) => {
  let time = clock().getTime();
  const { raw, hub } = setup(t, ":memory:", { clock: () => new Date(time) });
  for (const projectId of [p, q]) { project(raw, projectId); hub.ensureStream(projectId); }
  const a = appendMany(hub, 3);
  const b = appendMany(hub, 2, q);
  assert.equal(count(raw, "outbox"), 5);
  assert.ok(raw.prepare("SELECT * FROM outbox").all().every((row) => row.attempts === 0 && row.delivered_at === null));
  const ordered = [...a, ...b].sort((x, y) => x.projectId.localeCompare(y.projectId) || Number(BigInt(x.cursor.sequence) - BigInt(y.cursor.sequence)));
  assert.deepEqual(hub.claimUndelivered(2), ordered.slice(0, 2));
  assert.deepEqual(hub.claimUndelivered(2), ordered.slice(0, 2));
  assert.equal(raw.prepare("SELECT attempts FROM outbox WHERE event_id = ?").get(ordered[0].eventId).attempts, 2);
  const delivered = ordered.slice(0, 2).map((event) => event.eventId);
  hub.markDelivered(delivered);
  const at = new Date(time).toISOString();
  time += 1000;
  hub.markDelivered([...delivered, id()]);
  assert.equal(raw.prepare("SELECT delivered_at FROM outbox WHERE event_id = ?").get(delivered[0]).delivered_at, at);
  assert.deepEqual(hub.claimUndelivered(), ordered.slice(2));
  hub.markDelivered(ordered.map((event) => event.eventId));
  assert.deepEqual(hub.claimUndelivered(), []);
  hub.markDelivered([]);
});

test("sequences beyond Number.MAX_SAFE_INTEGER stay exact during append, paging and prune", (t) => {
  const { raw, hub } = fixture(t);
  const base = 9007199254740992n;
  raw.prepare("UPDATE project_streams SET last_sequence = ? WHERE project_id = ?").run(base, p);
  const start = hub.currentCursor(p);
  assert.equal(start.sequence, String(base));
  const all = appendMany(hub, 4);
  assert.deepEqual(all.map((event) => event.cursor.sequence), [1n, 2n, 3n, 4n].map((n) => String(base + n)));
  const first = events(hub, p, start, 3);
  assert.equal(first.hasMore, true);
  assert.deepEqual(first.events, all.slice(0, 3));
  assert.deepEqual(events(hub, p, first.events.at(-1).cursor).events, all.slice(3));
  assert.equal(hub.prune(p, 2), 2);
  assert.deepEqual(hub.readAfter(p, start), { kind: "snapshot-required", reason: "expired" });
  assert.deepEqual(events(hub, p, all[1].cursor).events, all.slice(2));
});

test("read limits clamp to 1..500 and hasMore is exact", (t) => {
  const { hub } = fixture(t);
  appendMany(hub, 501);
  assert.equal(events(hub, p, zero(hub), 0).events.length, 1);
  assert.equal(events(hub, p, zero(hub), -10).events.length, 1);
  assert.equal(events(hub, p, zero(hub), 1000).events.length, 500);
  assert.equal(events(hub, p, zero(hub), 1000).hasMore, true);
  const last = events(hub, p, { ...zero(hub), sequence: "498" }, 3);
  assert.equal(last.events.length, 3);
  assert.equal(last.hasMore, false);
});

test("epoch and events survive closing and reopening a file database", (t) => {
  const { file, clean } = filePath();
  const first = setup(t, file);
  try {
    project(first.raw, p);
    const initial = first.hub.ensureStream(p);
    const all = appendMany(first.hub, 3);
    first.storage.close();
    const second = setup(t, file);
    try {
      assert.deepEqual(second.hub.ensureStream(p), { ...initial, sequence: "3" });
      assert.deepEqual(events(second.hub, p, initial).events, all);
      assert.equal(appendMany(second.hub, 1)[0].cursor.sequence, "4");
    } finally { second.storage.close(); }
  } finally { first.storage.close(); clean(); }
});

test("two connections appending alternately keep a shared stream contiguous and unique", (t) => {
  const { file, clean } = filePath();
  const first = setup(t, file);
  let second;
  try {
    project(first.raw, p);
    const initial = first.hub.ensureStream(p);
    second = setup(t, file);
    const all = [];
    for (let i = 0; i < 50; i += 1) all.push(...appendMany(i % 2 ? second.hub : first.hub, 1));
    assert.deepEqual(all.map((event) => event.cursor.sequence), Array.from({ length: 50 }, (_, i) => String(i + 1)));
    assert.equal(new Set(all.map((event) => event.eventId)).size, 50);
    assert.deepEqual(first.hub.currentCursor(p), second.hub.currentCursor(p));
    assert.deepEqual(events(second.hub, p, initial).events, all);
  } finally { second?.storage.close(); first.storage.close(); clean(); }
});
