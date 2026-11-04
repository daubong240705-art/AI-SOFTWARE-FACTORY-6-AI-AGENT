import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { Store } from "../electron/storage/database";
import { RunController } from "../electron/controller/runs";
import { defaultSettings } from "../shared/defaults";
import { ModelProxy } from "../electron/gateway/model-proxy";
import { redact } from "../electron/runtime/security";

test("controller locks before async startup and persists cancellation across reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "asf-ww2-controller-"));
  let store = new Store(directory);
  try {
    const settings = defaultSettings();
    settings.gatewayUrl = "https://unused.example/v1";
    settings.agents.find((a) => a.role === "be")!.model = "synthetic-model";
    store.save(settings, undefined);
    const project = store.addProject(directory);
    const controller = new RunController(store, directory, () => undefined);
    const run = controller.start(
      project.id,
      "Do not start runtime; cancelled immediately",
      "be",
    );
    assert.throws(
      () => controller.start(project.id, "Duplicate", "be"),
      /một yêu cầu/,
    );
    assert.throws(() => store.removeProject(project.id), /Dừng tác vụ/);
    await controller.stop(run.id);
    assert.equal(controller.view().activeId, null);
    assert.equal(controller.detail(run.id).run.state, "cancelled");
    store.close();
    store = new Store(directory);
    assert.equal(store.run(run.id).state, "cancelled");
    assert.ok(store.events(run.id).some((e) => e.type === "RUN_CANCELLED"));
    const pending = {
      ...store.run(run.id),
      id: crypto.randomUUID(),
      state: "running" as const,
      endedAt: null,
    };
    store.createRun(pending);
    new RunController(store, directory, () => undefined);
    assert.equal(store.run(pending.id).state, "interrupted");
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("proxy pins model, counts real requests, rejects redirects and never forwards execution token upstream", async () => {
  let calls = 0;
  let redirect = false;
  const upstream = createServer(async (req, res) => {
    calls++;
    assert.equal(req.headers.authorization, "Bearer synthetic-provider");
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(body.model, "chosen-model");
    assert.equal(body.max_tokens, 8192);
    if (redirect) {
      res.writeHead(307, { location: "http://127.0.0.1:1/steal" });
      res.end();
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ choices: [] }));
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  const settings = defaultSettings();
  settings.gatewayUrl = `http://127.0.0.1:${address.port}/v1`;
  settings.maxRequests = 2;
  const proxy = new ModelProxy(
    settings,
    "synthetic-provider",
    "chosen-model",
    () => {},
  );
  const url = await proxy.start();
  const request = (token = proxy.token, model = "chosen-model") =>
    fetch(url + "/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, max_tokens: 999999, messages: [] }),
    });
  try {
    assert.equal((await request("invalid")).status, 401);
    assert.equal((await request(proxy.token, "other-model")).status, 403);
    assert.equal(calls, 0);
    assert.equal((await request()).status, 200);
    redirect = true;
    assert.equal((await request()).status, 502);
    assert.equal((await request()).status, 403);
    assert.equal(calls, 2);
  } finally {
    await proxy.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});

test("redaction strips known secrets and common credential forms", () => {
  const text = redact(
    "actual-secret Authorization: Bearer abc-def api_key=testvalue",
    ["actual-secret"],
  );
  assert.ok(!text.includes("actual-secret"));
  assert.ok(!text.includes("abc-def"));
  assert.ok(!text.includes("testvalue"));
});
