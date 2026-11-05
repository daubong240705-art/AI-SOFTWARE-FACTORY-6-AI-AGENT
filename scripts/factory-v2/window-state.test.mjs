import test from "node:test";
import assert from "node:assert/strict";
import {
  clampBounds,
  createWindow,
  displayBounds,
  restoreLayout,
  serializeLayout,
} from "../../design/factory-v2/window-state.mjs";
const config = {
  minWidth: 360,
  minHeight: 320,
  defaultWidth: 440,
  defaultHeight: 560,
  inset: 8,
  cascade: 24,
  maxOpen: 10,
};
test("restoring from a large monitor keeps the complete frame inside a small workspace", () => {
  assert.deepEqual(
    clampBounds(
      { x: 1700, y: 900, width: 900, height: 800 },
      { width: 500, height: 400 },
      config,
    ),
    { x: 0, y: 0, width: 500, height: 400 },
  );
});
test("minimum dimensions never force overflow in a mobile or zero-sized workspace", () => {
  assert.deepEqual(
    clampBounds(
      { x: -20, y: 40, width: 100, height: 120 },
      { width: 300, height: 240 },
      config,
    ),
    { x: 0, y: 0, width: 300, height: 240 },
  );
  assert.deepEqual(clampBounds({}, { width: 0, height: 0 }, config), {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
});
test("keyboard resize and drag remain bounded on every edge", () => {
  const area = { width: 1366, height: 600 };
  for (const x of [-100, 0, 1500])
    for (const y of [-100, 0, 900])
      for (const width of [10, 440, 3000]) {
        const b = clampBounds({ x, y, width, height: 560 }, area, config);
        assert(
          b.x >= 0 &&
            b.y >= 0 &&
            b.x + b.width <= area.width &&
            b.y + b.height <= area.height,
        );
      }
});
test("maximizing and mobile presentation preserve floating geometry for restoration", () => {
  const area = { width: 900, height: 700 };
  const item = createWindow("lead", 0, area, config);
  const before = structuredClone(item);
  assert.deepEqual(
    displayBounds({ ...item, mode: "maximized" }, area, config),
    { x: 0, y: 0, ...area },
  );
  assert.deepEqual(
    displayBounds(item, { width: 300, height: 400 }, config, true),
    { x: 0, y: 0, width: 300, height: 400 },
  );
  assert.deepEqual(item, before);
});
test("layout persistence excludes transcript, drafts and arbitrary extra fields", () => {
  const item = {
    ...createWindow("lead", 0, { width: 900, height: 700 }, config),
    draft: "private",
    messages: ["private"],
    credential: "private",
  };
  const layout = serializeLayout([item], item.id);
  assert(!JSON.stringify(layout).includes("private"));
  assert.deepEqual(Object.keys(layout.windows[0]).sort(), [
    "agentId",
    "bounds",
    "id",
    "mode",
  ]);
});
test("a minimized active window cannot hide all other windows after mobile restoration", () => {
  const a = createWindow("lead", 0, { width: 900, height: 700 }, config),
    b = {
      ...createWindow("frontend", 1, { width: 900, height: 700 }, config),
      mode: "minimized",
    };
  assert.equal(
    restoreLayout(
      serializeLayout([a, b], b.id),
      ["lead", "frontend"],
      { width: 900, height: 700 },
      config,
    ).activeId,
    a.id,
  );
  assert.equal(
    restoreLayout(
      serializeLayout([{ ...a, mode: "minimized" }], a.id),
      ["lead"],
      { width: 900, height: 700 },
      config,
    ).activeId,
    null,
  );
});
test("corrupt, duplicate, unknown and oversized persisted windows are rejected", () => {
  const a = createWindow("lead", 0, { width: 900, height: 700 }, config);
  for (const raw of [
    null,
    { schemaVersion: 0, windows: [] },
    serializeLayout([a, a], a.id),
    serializeLayout([{ ...a, agentId: "unknown" }], a.id),
    serializeLayout([{ ...a, mode: "danger" }], a.id),
    serializeLayout([{ ...a, bounds: { ...a.bounds, x: NaN } }], a.id),
    serializeLayout(Array(11).fill(a), a.id),
  ]) {
    assert.throws(() =>
      restoreLayout(raw, ["lead"], { width: 900, height: 700 }, config),
    );
  }
});
test("closing all windows survives persistence without reopening a chat or dispatching", () => {
  assert.deepEqual(
    restoreLayout(
      serializeLayout([], null),
      ["lead"],
      { width: 900, height: 700 },
      config,
    ),
    { schemaVersion: 1, windows: [], activeId: null },
  );
});
