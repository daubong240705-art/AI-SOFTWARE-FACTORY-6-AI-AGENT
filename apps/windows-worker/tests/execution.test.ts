import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Event } from "@opencode-ai/sdk/v2/client";
import type { Run } from "../shared/runs";
import type { TeamTask } from "../shared/team";
import type { ExecutionFailure } from "../shared/execution";
import { defaultSettings } from "../shared/defaults";
import { normalizeRun } from "../shared/runs";
import { loadProfiles } from "../electron/team/profiles";
import {
  loadSkillCatalog,
  selectSkills,
  inferWorkType,
} from "../electron/team/skills";
import { newTask, coordinate } from "../electron/team/coordinator";
import { emptyMetrics, syncMetrics } from "../electron/runtime/metrics";
import {
  classifyFailure,
  failure,
  WorkerError,
} from "../electron/runtime/failure";
import { ExecutionStopped } from "../electron/runtime/stopped";
import { ModelProxy } from "../electron/gateway/model-proxy";
import { RequestBudget } from "../electron/gateway/request-budget";
import { Executions } from "../electron/runtime/executions";
import { OpenCodeRuntime } from "../electron/runtime/opencode";
import { RunController } from "../electron/controller/runs";
import { Store } from "../electron/storage/database";
import { ExecutionFacts } from "../src/features/ExecutionFacts";

test("runtime refuses length-limited responses even when partial text looks valid", async () => {
  const x = fixture();
  try {
    const runtime = new OpenCodeRuntime(
      "unused",
      x.directory,
      x.run,
      { url: "http://127.0.0.1:1", token: "fixture" },
      { event: () => {}, permission: () => {}, failure: () => {} },
      {
        prompt: "fixture",
        instructions: "fixture",
        allowedPaths: ["."],
        readOnly: true,
        allowShell: false,
      },
    );
    Object.assign(runtime, {
      session: "fixture",
      client: {
        session: {
          prompt: async () => ({
            data: {
              info: { finish: "length" },
              parts: [{ type: "text", text: "{}" }],
            },
          }),
          messages: async () => ({ data: [] }),
        },
      },
    });
    const result = await runtime.prompt();
    assert.equal(result.text, "{}");
    assert.equal(result.error?.code, "invalid-output");
    assert.match(result.error!.message, /8.192 token/);
    assert.match(result.error!.message, /Reasoning/);
  } finally {
    x.store.close();
    rmSync(x.directory, { recursive: true, force: true });
  }
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "asf-execution-"));
  const source = join(directory, "source");
  mkdirSync(source);
  const store = new Store(join(directory, "data"));
  const settings = defaultSettings();
  settings.gatewayUrl = "https://unused.example/v1";
  settings.agents.forEach((a) => {
    a.enabled = true;
    a.model = `model-${a.role}`;
  });
  const run: Run = {
    id: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    projectName: "metrics",
    workspace: source,
    prompt: "Analyze source",
    role: "lead",
    model: "model-lead",
    mode: "team",
    tasks: [],
    profiles: loadProfiles(),
    skillCatalog: loadSkillCatalog(),
    currentTaskId: null,
    fixRound: 0,
    review: null,
    state: "completed",
    createdAt: new Date().toISOString(),
    startedAt: null,
    endedAt: null,
    sessionId: null,
    summary: "",
    error: "",
    settings,
    changes: [],
    commands: [],
    permissions: [],
    requests: 0,
    baselineComplete: true,
    toolsCompleted: 0,
    runtimeVersion: "",
    inputTokens: 0,
    outputTokens: 0,
    metrics: emptyMetrics(),
  };
  store.createRun(run);
  const controller = new RunController(store, directory, () => undefined);
  const active = {
    run,
    secrets: [] as string[],
    seen: new Set<string>(),
    desired: undefined as "cancelled" | "failed" | undefined,
    failure: undefined as ExecutionFailure | undefined,
    runtime: undefined as unknown,
  };
  const internal = controller as unknown as {
    active: typeof active | undefined;
    onEvent(active: unknown, event: Event, reconciled?: boolean): Promise<void>;
    onPermission(
      active: unknown,
      permission: { id: string; permission: string; patterns: string[] },
    ): void;
    step(
      active: unknown,
      key: string | undefined,
      executable: string,
      task?: TeamTask,
      prompt?: string,
    ): Promise<string>;
  };
  internal.active = active;
  const cleanup = () => {
    store.close();
    assert.ok(directory.startsWith(join(tmpdir(), "asf-execution-")));
    rmSync(directory, { recursive: true, force: true });
  };
  return {
    directory,
    source,
    store,
    run,
    controller,
    active,
    internal,
    cleanup,
  };
}
function task(run: Run, id = "t1") {
  return newTask(run, {
    id,
    role: "be",
    title: "Implement",
    instructions: "Work",
    allowedPaths: ["."],
    acceptance: ["Done"],
    dependsOn: [],
    kind: "work",
  });
}
async function gateway(status: number) {
  let calls = 0;
  const server = createServer((req, res) => {
    calls++;
    req.resume();
    res.writeHead(status, { "content-type": "application/json" });
    res.end(
      JSON.stringify(
        status === 200
          ? { choices: [] }
          : { error: "provider-secret-never-persist" },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    calls: () => calls,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

test("failure taxonomy keeps primary typed causes and redacts credentials without assuming transient means auto-retry", () => {
  for (const [text, code] of [
    ["execution_request_limit_exceeded", "budget-exhausted"],
    ["Gateway HTTP 401", "provider-auth"],
    ["Gateway HTTP 429", "rate-limit"],
    ["Gateway HTTP 503", "transient"],
    ["permission rejected", "permission-denied"],
    ["Task ngoài phạm vi", "scope-violation"],
    ["Không thể xác minh toàn bộ source", "incomplete-snapshot"],
    ["JSON không hợp lệ", "invalid-output"],
    ["Có lệnh thất bại", "tool-test-failure"],
    ["Thiếu profile snapshot", "configuration"],
    ["Unknown failure", "runtime"],
  ])
    assert.equal(classifyFailure(text).code, code);
  const typed = classifyFailure(
    new WorkerError(failure("scope-violation", "value raw-credential")),
    ["raw-credential"],
  );
  assert.equal(typed.code, "scope-violation");
  assert.ok(!typed.message.includes("raw-credential"));
  assert.equal(typed.retry, "none");
  assert.equal(failure("transient", "network").retry, "manual");
});

test("proxy fails closed after 401/429/503 and model mismatch; repeated native requests never reach upstream", async () => {
  for (const [status, code] of [
    [401, "provider-auth"],
    [429, "rate-limit"],
    [503, "transient"],
  ] as const) {
    const upstream = await gateway(status);
    const errors: ExecutionFailure[] = [];
    let counted = 0;
    const settings = defaultSettings();
    settings.gatewayUrl = upstream.url;
    settings.maxRequests = 5;
    const proxy = new ModelProxy(
      settings,
      "synthetic-key",
      "chosen",
      (n) => {
        counted = n;
      },
      (e) => errors.push(e),
    );
    const url = await proxy.start();
    const request = (model = "chosen") =>
      fetch(url + "/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${proxy.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model, messages: [] }),
      });
    try {
      assert.equal((await request()).status, status);
      assert.equal((await request()).status, 409);
      assert.equal((await request()).status, 409);
      assert.equal(upstream.calls(), 1);
      assert.equal(counted, 1);
      assert.equal(errors.length, 1);
      assert.equal(errors[0].code, code);
      assert.ok(
        !JSON.stringify(errors).includes("provider-secret-never-persist"),
      );
    } finally {
      await proxy.close();
      await upstream.close();
    }
  }
  const upstream = await gateway(200);
  const settings = defaultSettings();
  settings.gatewayUrl = upstream.url;
  const errors: ExecutionFailure[] = [];
  const proxy = new ModelProxy(
    settings,
    undefined,
    "chosen",
    () => {},
    (e) => errors.push(e),
  );
  try {
    const url = await proxy.start();
    const request = (model: string) =>
      fetch(url + "/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${proxy.token}` },
        body: JSON.stringify({ model }),
      });
    assert.equal((await request("other")).status, 403);
    assert.equal((await request("chosen")).status, 409);
    assert.equal(upstream.calls(), 0);
    assert.equal(errors[0].code, "configuration");
  } finally {
    await proxy.close();
    await upstream.close();
  }
});

test("shared proxy budget cannot be exceeded by concurrent requests; failure does not create another budget", async () => {
  const upstream = await gateway(200);
  const settings = defaultSettings();
  settings.gatewayUrl = upstream.url;
  settings.maxRequests = 1;
  const failures: ExecutionFailure[] = [];
  const proxy = new ModelProxy(
    settings,
    undefined,
    "chosen",
    () => {},
    (e) => failures.push(e),
  );
  try {
    const url = await proxy.start();
    const statuses = await Promise.all(
      Array.from(
        { length: 4 },
        async () =>
          (
            await fetch(url + "/chat/completions", {
              method: "POST",
              headers: { Authorization: `Bearer ${proxy.token}` },
              body: JSON.stringify({ model: "chosen" }),
            })
          ).status,
      ),
    );
    assert.equal(upstream.calls(), 1);
    assert.equal(statuses.filter((s) => s === 200).length, 1);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].code, "budget-exhausted");
  } finally {
    await proxy.close();
    await upstream.close();
  }
});

test("separate proxies and replacement attempts share one irreversible run budget", async () => {
  const upstream = await gateway(200);
  const settings = defaultSettings();
  settings.gatewayUrl = upstream.url;
  settings.maxRequests = 10;
  const budget = new RequestBudget(2);
  const counts = [0, 0, 0];
  const proxies = counts.map(
    (_, i) =>
      new ModelProxy(
        settings,
        undefined,
        "chosen",
        (n) => {
          counts[i] = n;
        },
        undefined,
        budget,
      ),
  );
  try {
    const urls = await Promise.all(proxies.map((proxy) => proxy.start()));
    const send = async (i: number) => {
      const response = await fetch(urls[i] + "/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${proxies[i].token}` },
        body: JSON.stringify({ model: "chosen" }),
      });
      await response.text();
      return response.status;
    };
    assert.deepEqual(await Promise.all([send(0), send(1)]), [200, 200]);
    await Promise.all([proxies[0].close(), proxies[1].close()]);
    assert.equal(await send(2), 403);
    assert.equal(await send(2), 409);
    assert.equal(budget.requests, 2);
    assert.deepEqual(counts, [1, 1, 0]);
    assert.equal(upstream.calls(), 2);
    assert.equal(budget.reserve(), false);
  } finally {
    await Promise.all(proxies.map((proxy) => proxy.close()));
    await upstream.close();
  }
});

test("racing requests across separate proxies cannot overspend a shared run ledger", async () => {
  const upstream = await gateway(200);
  const settings = defaultSettings();
  settings.gatewayUrl = upstream.url;
  const budget = new RequestBudget(3);
  const proxies = [0, 1].map(
    () =>
      new ModelProxy(
        settings,
        undefined,
        "chosen",
        () => {},
        undefined,
        budget,
      ),
  );
  try {
    const urls = await Promise.all(proxies.map((p) => p.start()));
    const responses = await Promise.all(
      Array.from({ length: 20 }, async (_, i) => {
        const j = i % 2;
        const response = await fetch(urls[j] + "/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${proxies[j].token}` },
          body: JSON.stringify({ model: "chosen" }),
        });
        await response.text();
        return response.status;
      }),
    );
    assert.equal(responses.filter((s) => s === 200).length, 3);
    assert.equal(upstream.calls(), 3);
    assert.equal(budget.requests, 3);
  } finally {
    await Promise.all(proxies.map((p) => p.close()));
    await upstream.close();
  }
});

test("usage is attributed once per task/session and remains unknown when no samples exist; old history is not backfilled", async () => {
  const x = fixture();
  try {
    const first = task(x.run);
    first.sessionId = "session1";
    first.metrics!.requests = 2;
    x.run.tasks.push(first);
    x.run.currentTaskId = first.id;
    x.run.sessionId = "session1";
    const event = (session: string): Event =>
      ({
        type: "message.part.updated",
        properties: {
          sessionID: session,
          part: {
            type: "step-finish",
            id: "shared-step",
            sessionID: session,
            tokens: { input: 10, output: 4 },
          },
        },
      }) as unknown as Event;
    await x.internal.onEvent(x.active, event("wrong-session"));
    assert.equal(x.run.metrics!.inputTokens, null);
    await x.internal.onEvent(x.active, event("session1"));
    await x.internal.onEvent(x.active, event("session1"), true);
    assert.equal(first.metrics!.usageSteps, 1);
    assert.equal(first.metrics!.inputTokens, 10);
    const second = task(x.run, "t1-fix-1");
    second.sessionId = "session2";
    second.round = 1;
    second.metrics!.requests = 1;
    x.run.tasks.push(second);
    x.run.currentTaskId = second.id;
    x.run.sessionId = "session2";
    await x.internal.onEvent(x.active, event("session2"));
    assert.equal(second.metrics!.inputTokens, 10);
    assert.equal(x.run.metrics!.inputTokens, 20);
    x.run.commands.push(
      {
        taskId: first.id,
        callId: "a",
        command: "test",
        status: "completed",
        output: "",
        exitCode: 1,
      },
      {
        taskId: second.id,
        callId: "b",
        command: "test",
        status: "completed",
        output: "",
        exitCode: 0,
      },
      {
        taskId: second.id,
        callId: "c",
        command: "test",
        status: "running",
        output: "",
        exitCode: null,
      },
    );
    first.startedAt = "2026-11-04T00:00:00Z";
    first.endedAt = "2026-11-04T00:00:03Z";
    syncMetrics(x.run, first);
    syncMetrics(x.run, second);
    syncMetrics(x.run);
    assert.equal(first.metrics!.durationMs, 3000);
    assert.deepEqual(second.metrics!.commands, {
      passed: 1,
      failed: 0,
      incomplete: 1,
    });
    assert.deepEqual(x.run.metrics!.commands, {
      passed: 1,
      failed: 1,
      incomplete: 1,
    });
    assert.equal(x.run.metrics!.cost, null);
    x.store.updateRun(x.run);
    assert.deepEqual(x.store.run(x.run.id).tasks[0].metrics, first.metrics);
    const old = normalizeRun({ ...x.run, metrics: undefined });
    assert.equal(old.metrics, undefined);
    assert.match(
      renderToStaticMarkup(
        createElement(ExecutionFacts, { metrics: undefined }),
      ),
      /lượt cũ/,
    );
    assert.match(
      renderToStaticMarkup(
        createElement(ExecutionFacts, { metrics: emptyMetrics() }),
      ),
      /Token: chưa có số liệu/,
    );
  } finally {
    x.cleanup();
  }
});

test("permission rejection and repeated Stop preserve the first cause and hold the queue without scheduling more sessions", async () => {
  const x = fixture();
  try {
    const work = task(x.run);
    x.run.tasks.push(work);
    x.run.currentTaskId = work.id;
    x.run.permissions = [
      { id: "perm", permission: "bash", patterns: ["test"] },
    ];
    let replies = 0,
      closes = 0;
    x.active.runtime = {
      reply: async () => {
        assert.equal(x.active.desired, "failed");
        assert.equal(x.active.failure?.code, "permission-denied");
        replies++;
      },
      close: async () => {
        closes++;
      },
    };
    await x.controller.reply(x.run.id, "perm", false);
    assert.equal(replies, 1);
    assert.ok(closes > 0);
    assert.equal(x.run.failure?.code, "permission-denied");
    assert.equal(x.run.state, "failed");
    assert.equal(x.controller.view().activeId, null);
    x.internal.active = x.active;
    await x.controller.stop(x.run.id);
    assert.equal(x.run.failure?.code, "permission-denied");
    assert.equal(x.run.state, "failed");
  } finally {
    x.cleanup();
  }
});

test("Full access fallback approves only permitted requests using the immutable run snapshot; manual mode still waits", async () => {
  const x = fixture();
  try {
    const work = task(x.run);
    x.run.tasks.push(work);
    x.run.currentTaskId = work.id;
    x.run.state = "running";
    x.run.settings.permissionMode = "full-access";
    let replies = 0;
    x.active.runtime = {
      reply: async (id: string, allow: boolean) => {
        assert.equal(id, "auto");
        assert.equal(allow, true);
        replies++;
      },
    };
    const changed = structuredClone(x.run.settings);
    changed.permissionMode = "ask";
    x.store.save(changed, undefined);
    x.internal.onPermission(x.active, {
      id: "auto",
      permission: "bash",
      patterns: ["npm test"],
    });
    await Promise.resolve();
    assert.equal(replies, 1);
    assert.equal(x.run.state, "running");
    assert.deepEqual(x.run.permissions, []);
    assert.ok(
      x.store
        .events(x.run.id)
        .some((event) => event.type === "PERMISSION_AUTO_APPROVED"),
    );
    x.internal.onPermission(x.active, {
      id: "auto",
      permission: "bash",
      patterns: ["npm test"],
    });
    assert.equal(replies, 1, "replayed permission event must not reply twice");
    x.run.settings.permissionMode = "ask";
    x.internal.onPermission(x.active, {
      id: "manual",
      permission: "bash",
      patterns: ["npm test"],
    });
    assert.equal(x.run.state, "blocked");
    assert.equal(x.run.permissions.length, 1);
    assert.equal(replies, 1);
    x.run.permissions = [];
    x.run.settings.permissionMode = "full-access";
    x.run.currentTaskId = null;
    x.run.role = "lead";
    x.internal.onPermission(x.active, {
      id: "denied-role",
      permission: "bash",
      patterns: ["npm test"],
    });
    assert.equal(replies, 1);
    assert.equal(x.run.permissions[0].id, "denied-role");
  } finally {
    x.cleanup();
  }
});

test("Controller retains its run lock when any lane cannot stop, then retries containment", async () => {
  const x = fixture();
  try {
    const executions = new Executions();
    Object.assign(x.active, { executions });
    let attempts = 0,
      healthy = 0;
    executions.open("a").runtime = {
      close: async () => {
        if (++attempts === 1) throw new Error("Process still active");
      },
    };
    executions.open("b").runtime = {
      close: async () => {
        healthy++;
      },
    };
    await assert.rejects(x.controller.stop(x.run.id));
    assert.equal(x.controller.view().activeId, x.run.id);
    assert.equal(x.run.state, "cancelling");
    assert.equal(healthy, 1);
    await x.controller.stop(x.run.id);
    assert.equal(attempts, 2);
    assert.equal(x.controller.view().activeId, null);
    assert.equal(x.run.state, "cancelled");
  } finally {
    x.cleanup();
  }
});

test("closed proxy cannot start or reopen its listener", async () => {
  const settings = defaultSettings();
  settings.gatewayUrl = "http://127.0.0.1:1/v1";
  const proxy = new ModelProxy(settings, undefined, "chosen", () => {});
  await proxy.close();
  await assert.rejects(proxy.start(), /closed/);
  const starting = new ModelProxy(settings, undefined, "chosen", () => {});
  const result = starting.start();
  const assertion = assert.rejects(result, /closed/);
  await starting.close();
  await assertion;
  await starting.close();
});

test("permission tickets route colliding native IDs to their originating task runtime", async () => {
  const x = fixture();
  try {
    Object.assign(x.active, { executions: new Executions() });
    const first = task(x.run);
    const second = { ...task(x.run), id: "t2" };
    x.run.tasks.push(first, second);
    const replies: string[] = [];
    for (const work of [first, second]) {
      x.run.currentTaskId = work.id;
      x.active.runtime = {
        reply: async (id: string) => {
          replies.push(work.id + ":" + id);
        },
      };
      const permission = {
        id: "same-native-id",
        permission: "bash",
        patterns: ["npm test"],
      };
      x.internal.onPermission(x.active, permission);
      x.internal.onPermission(x.active, permission);
    }
    assert.equal(x.run.permissions.length, 2);
    const [a, b] = x.run.permissions.map((p) => p.id);
    assert.notEqual(a, b);
    await x.controller.reply(x.run.id, a, true);
    assert.deepEqual(replies, [first.id + ":same-native-id"]);
    assert.equal(first.state, "running");
    assert.equal(second.state, "blocked");
    await assert.rejects(x.controller.reply(x.run.id, a, true));
    await x.controller.reply(x.run.id, b, true);
    assert.deepEqual(replies, [
      first.id + ":same-native-id",
      "t2:same-native-id",
    ]);
    assert.equal(x.run.state, "running");
  } finally {
    x.cleanup();
  }
});

test("failed Full access approval stops the run; a stopped execution cannot approve later requests", async () => {
  const x = fixture();
  try {
    const work = task(x.run);
    x.run.tasks.push(work);
    x.run.currentTaskId = work.id;
    x.run.settings.permissionMode = "full-access";
    let replies = 0;
    x.active.runtime = {
      reply: async () => {
        replies++;
        throw new Error("Approval connection closed");
      },
      close: async () => {},
    };
    x.internal.onPermission(x.active, {
      id: "failed",
      permission: "bash",
      patterns: ["npm test"],
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(x.run.state, "failed");
    assert.equal(x.run.failure?.code, "runtime");
    assert.equal(x.controller.view().activeId, null);
    x.internal.onPermission(x.active, {
      id: "late",
      permission: "bash",
      patterns: ["npm test"],
    });
    assert.equal(replies, 1);
  } finally {
    x.cleanup();
  }
});

test("real proxy + Controller step stops on provider auth, counts exactly one request and never falls back model", async () => {
  const x = fixture();
  const upstream = await gateway(401);
  const original = {
    start: OpenCodeRuntime.prototype.start,
    prompt: OpenCodeRuntime.prototype.prompt,
    close: OpenCodeRuntime.prototype.close,
  };
  let starts = 0;
  try {
    x.run.settings.gatewayUrl = upstream.url;
    x.run.mode = "direct";
    x.run.role = "be";
    x.run.model = "model-be";
    x.run.skillSelection = selectSkills(
      x.run.skillCatalog!,
      "be",
      inferWorkType("be", x.run.prompt),
    );
    OpenCodeRuntime.prototype.start = async function () {
      starts++;
      return "fake-session";
    };
    OpenCodeRuntime.prototype.close = async function () {};
    OpenCodeRuntime.prototype.prompt = async function () {
      const runtime = this as unknown as {
        proxy: { url: string; token: string };
      };
      try {
        await fetch(runtime.proxy.url + "/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${runtime.proxy.token}` },
          body: JSON.stringify({ model: "model-be" }),
        });
      } catch {
        /* stop can close the local response */
      }
      return { text: "Cannot complete", error: null };
    };
    await assert.rejects(
      x.internal.step(x.active, undefined, "unused"),
      ExecutionStopped,
    );
    assert.equal(starts, 1);
    assert.equal(upstream.calls(), 1);
    assert.equal(x.run.requests, 1);
    assert.equal(x.run.metrics!.requests, 1);
    assert.equal(x.run.failure?.code, "provider-auth");
    assert.equal(x.run.model, "model-be");
    assert.equal(x.run.metrics!.inputTokens, null);
    assert.ok(
      !JSON.stringify(x.store.run(x.run.id)).includes(
        "provider-secret-never-persist",
      ),
    );
  } finally {
    Object.assign(OpenCodeRuntime.prototype, original);
    await upstream.close();
    x.cleanup();
  }
});

test("safety/cancellation failures do not enter schema repair or dispatch another task", async () => {
  const x = fixture();
  try {
    let calls = 0;
    await assert.rejects(
      coordinate(
        x.run,
        async () => {
          calls++;
          throw new WorkerError(
            failure("budget-exhausted", "No requests left"),
          );
        },
        () => {},
        () => {},
      ),
      WorkerError,
    );
    assert.equal(calls, 1);
    assert.equal(x.run.tasks[0].failure?.code, "budget-exhausted");
    assert.equal(x.run.tasks[0].metrics?.inputTokens, null);
    const wrongModel = task(x.run);
    wrongModel.model = "silent-fallback";
    await assert.rejects(
      x.internal.step(x.active, undefined, "unused", wrongModel),
      (error: unknown) =>
        error instanceof WorkerError && error.failure.code === "configuration",
    );
  } finally {
    x.cleanup();
  }
});

test("unconfirmed close keeps the run lock, retrying Stop preserves the primary deadline cause", async () => {
  const x = fixture();
  try {
    let canClose = false;
    x.active.runtime = {
      close: async () => {
        if (!canClose) throw new Error("Owned process still running");
      },
    };
    await assert.rejects(
      x.controller.stop(
        x.run.id,
        "failed",
        "Deadline",
        failure("deadline-exceeded", "Deadline"),
      ),
      /still running/,
    );
    assert.equal(x.controller.isBusy(), true);
    assert.equal(x.run.state, "cancelling");
    canClose = true;
    await x.controller.stop(x.run.id);
    assert.equal(x.controller.isBusy(), false);
    assert.equal(x.run.failure?.code, "deadline-exceeded");
    assert.equal(x.run.state, "failed");
  } finally {
    x.cleanup();
  }
});

test("restart marks existing running attempts interrupted without replay or inventing completed duration", () => {
  const x = fixture();
  try {
    x.run.state = "running";
    x.run.startedAt = new Date().toISOString();
    const work = task(x.run);
    work.state = "running";
    work.startedAt = x.run.startedAt;
    x.run.tasks.push(work);
    x.store.updateRun(x.run);
    new RunController(x.store, x.directory, () => undefined);
    const reopened = x.store.run(x.run.id);
    assert.equal(reopened.state, "interrupted");
    assert.equal(reopened.failure?.code, "interrupted");
    assert.equal(reopened.tasks[0].failure?.code, "interrupted");
    assert.equal(reopened.metrics?.durationMs, null);
    assert.equal(reopened.metrics?.inputTokens, null);
    assert.equal(reopened.tasks[0].metrics?.durationMs, null);
    assert.equal(reopened.requests, 0);
  } finally {
    x.cleanup();
  }
});
