import { test } from "node:test";
import assert from "node:assert/strict";
import { isolatedDispatch } from "../electron/team/dispatch";
import type { TeamTask } from "../shared/team";

const task = (id: string, scope: string, dependsOn: string[] = []): TeamTask =>
  ({
    id,
    allowedPaths: [scope],
    dependsOn,
    kind: "work",
    state: "queued",
  }) as TeamTask;

test("isolated dispatcher admits at most two independent disjoint roots", () => {
  const tasks = [
    task("t1", "src/api"),
    task("t2", "src/ui"),
    task("t3", "docs"),
  ];
  assert.deepEqual(
    isolatedDispatch(tasks, new Set()).map((t) => t.id),
    ["t1", "t2"],
  );
  tasks[0].state = "running";
  assert.deepEqual(
    isolatedDispatch(tasks, new Set(["t1"])).map((t) => t.id),
    ["t2"],
  );
  assert.deepEqual(isolatedDispatch(tasks, new Set(["t1", "t2"])), []);
  assert.deepEqual(isolatedDispatch(tasks, new Set(["missing"])), []);
});

test("dispatcher protects overlapping scopes and waits for integrated dependencies", () => {
  const tasks = [
    task("t1", "SRC"),
    task("t2", "src/ui"),
    task("t3", "tests", ["t1"]),
    task("t4", "docs"),
  ];
  assert.deepEqual(
    isolatedDispatch(tasks, new Set()).map((t) => t.id),
    ["t1", "t4"],
  );
  tasks[0].state = "completed";
  assert.deepEqual(
    isolatedDispatch(tasks, new Set()).map((t) => t.id),
    ["t2", "t4"],
  );
  assert.deepEqual(
    isolatedDispatch([task("t1", "."), task("t2", "docs")], new Set()).map(
      (t) => t.id,
    ),
    ["t1"],
  );
});

test("integrated dispatcher waits for all coding output before TEST, and admits dependent work only after integration", () => {
  const be = { ...task("t1", "api"), role: "be" } as TeamTask;
  const fe = { ...task("t2", "ui", ["t1"]), role: "fe" } as TeamTask;
  const testTask = { ...task("t3", "tests", ["t1"]), role: "test" } as TeamTask;
  be.state = "completed";
  assert.deepEqual(
    isolatedDispatch([be, fe, testTask], new Set(), new Set()),
    [],
  );
  assert.deepEqual(
    isolatedDispatch([be, fe, testTask], new Set(), new Set(["t1"])).map(
      (t) => t.id,
    ),
    ["t2"],
  );
  fe.state = "completed";
  assert.deepEqual(
    isolatedDispatch([be, fe, testTask], new Set(), new Set(["t1", "t2"])).map(
      (t) => t.id,
    ),
    ["t3"],
  );
});
