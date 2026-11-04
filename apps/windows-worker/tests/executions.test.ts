import { test } from "node:test";
import assert from "node:assert/strict";
import { Executions } from "../electron/runtime/executions";

test("stop drains every lane, closes admission immediately and waits for containment", async () => {
  const executions = new Executions();
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const closed: string[] = [];
  for (const id of ["a", "b"]) {
    const lane = executions.open(id, id);
    lane.runtime = {
      close: async () => {
        closed.push(id);
        await barrier;
      },
    };
    lane.proxy = {
      close: async () => {
        closed.push(id + "-proxy");
      },
    };
  }
  const stopping = executions.stop();
  assert.throws(() => executions.open("late"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(closed.sort(), ["a", "a-proxy", "b", "b-proxy"]);
  assert.equal(executions.size, 2);
  release();
  await stopping;
  assert.equal(executions.size, 0);
});

test("containment failures retain only failed ownership, retry safely and deduplicate concurrent close", async () => {
  const executions = new Executions();
  const failed = executions.open("failed");
  const healthy = executions.open("healthy");
  let attempts = 0,
    proxies = 0,
    healthyCloses = 0;
  failed.runtime = {
    close: async () => {
      if (++attempts === 1) throw new Error("still running");
    },
  };
  failed.proxy = {
    close: async () => {
      proxies++;
    },
  };
  healthy.runtime = {
    close: async () => {
      healthyCloses++;
    },
  };
  assert.throws(() => executions.open("failed"));
  await assert.rejects(executions.stop());
  assert.equal(executions.size, 1);
  assert.equal(proxies, 1);
  assert.equal(healthyCloses, 1);
  const first = executions.close("failed");
  assert.equal(executions.close("failed"), first);
  await first;
  assert.equal(attempts, 2);
  await executions.stop();
  assert.equal(executions.size, 0);
});
