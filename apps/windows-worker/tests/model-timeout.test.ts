import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { defaultSettings } from "../shared/defaults";
import { modelTimeoutMs } from "../shared/model-timeout";
import { ModelProxy } from "../electron/gateway/model-proxy";
import type { ExecutionFailure } from "../shared/execution";

test("model timeout follows run settings instead of the former 90 second ceiling", () => {
  assert.equal(modelTimeoutMs({ timeoutMinutes: 10 }), 600_000);
  assert.equal(modelTimeoutMs({ timeoutMinutes: 1 }), 60_000);
});

for (const streaming of [false, true]) {
  test(`silent ${streaming ? "stream" : "request"} reports timeout once and refuses automatic replay`, async () => {
    let calls = 0;
    const upstream = createServer((req, res) => {
      calls++;
      req.resume();
      if (streaming) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write('data: {"choices":[]}\n\n');
      }
      // Deliberately leave the response open to simulate a silent model.
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, "127.0.0.1", resolve),
    );
    const address = upstream.address();
    assert.ok(address && typeof address !== "string");
    const settings = defaultSettings();
    settings.gatewayUrl = `http://127.0.0.1:${address.port}/v1`;
    const errors: ExecutionFailure[] = [];
    let finished = 0;
    const proxy = new ModelProxy(
      settings,
      undefined,
      "slow-model",
      () => {},
      (error) => errors.push(error),
      undefined,
      () => finished++,
      60,
    );
    try {
      const url = await proxy.start();
      const send = () =>
        fetch(`${url}/chat/completions`, {
          method: "POST",
          headers: { authorization: `Bearer ${proxy.token}` },
          body: JSON.stringify({ model: "slow-model", stream: streaming }),
          signal: AbortSignal.timeout(5000),
        });
      const response = await send();
      await response.text();
      assert.equal(response.status, streaming ? 200 : 504);
      assert.equal((await send()).status, 409);
      assert.equal(calls, 1);
      assert.equal(errors.length, 1);
      assert.equal(errors[0].code, "transient");
      assert.match(errors[0].message, /không gửi dữ liệu.*slow-model/);
      assert.equal(errors[0].retry, "manual");
      await proxy.close();
      assert.equal(finished, 1);
    } finally {
      await proxy.close();
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
}

test("slow response inside the configured limit succeeds without replay", async () => {
  const upstream = createServer((req, res) => {
    req.resume();
    const timer = setTimeout(() => res.end('{"choices":[]}'), 150);
    res.on("close", () => clearTimeout(timer));
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  const settings = defaultSettings();
  settings.gatewayUrl = `http://127.0.0.1:${address.port}/v1`;
  const errors: ExecutionFailure[] = [];
  const proxy = new ModelProxy(
    settings,
    undefined,
    "slow-model",
    () => {},
    (e) => errors.push(e),
  );
  try {
    const url = await proxy.start();
    const response = await fetch(`${url}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${proxy.token}` },
      body: JSON.stringify({ model: "slow-model" }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '{"choices":[]}');
    assert.deepEqual(errors, []);
  } finally {
    await proxy.close();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});
