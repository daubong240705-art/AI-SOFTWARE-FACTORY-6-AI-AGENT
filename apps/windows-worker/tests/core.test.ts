import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import {
  defaultSettings,
  settingsSchema,
  saveSettingsSchema,
} from "../shared/contracts";
import { Store } from "../electron/storage/database";
import { fetchModels } from "../electron/gateway/client";

test("IPC settings reject duplicate roles, disabled Lead, credentials in URL and excess fix rounds", () => {
  assert.equal(settingsSchema.safeParse(defaultSettings()).success, true);
  for (const mutate of [
    (s: ReturnType<typeof defaultSettings>) => {
      s.agents[1].role = "lead";
    },
    (s: ReturnType<typeof defaultSettings>) => {
      s.agents[0].enabled = false;
    },
    (s: ReturnType<typeof defaultSettings>) => {
      s.gatewayUrl = "https://key:secret@router/v1";
    },
    (s: ReturnType<typeof defaultSettings>) => {
      s.gatewayUrl = "https://router/v1?api_key=secret";
    },
    (s: ReturnType<typeof defaultSettings>) => {
      s.maxFixRounds = 3;
    },
  ]) {
    const settings = defaultSettings();
    mutate(settings);
    assert.equal(settingsSchema.safeParse(settings).success, false);
  }
  assert.equal(
    saveSettingsSchema.safeParse({
      settings: defaultSettings(),
      keyAction: "replace",
      apiKey: "bad\r\nheader",
    }).success,
    false,
  );
});

test("SQLite reopens settings, encrypted bytes, catalog and project draft; removing project leaves source alone", () => {
  const directory = mkdtempSync(join(tmpdir(), "asf-ww1-storage-"));
  const source = mkdtempSync(join(tmpdir(), "asf-ww1-source-"));
  let store: Store | undefined;
  try {
    store = new Store(directory);
    const settings = defaultSettings();
    settings.gatewayUrl = "https://router.example/v1";
    settings.agents[0].model = "real-model-id";
    const encrypted = Buffer.from([0, 9, 15, 255]);
    store.save(settings, encrypted);
    store.setModels(["real-model-id"]);
    const project = store.addProject(source);
    store.saveDraft(project.id, "Yêu cầu có dấu");
    assert.equal(store.addProject(source).id, project.id);
    store.close();
    store = new Store(directory);
    assert.deepEqual(store.settings(), settings);
    assert.deepEqual(store.encryptedKey(), encrypted);
    assert.deepEqual(store.models(), ["real-model-id"]);
    assert.equal(store.project(project.id).draft, "Yêu cầu có dấu");
    settings.gatewayUrl = "https://other.example/v1";
    store.save(settings, undefined);
    assert.deepEqual(store.models(), []);
    store.removeProject(project.id);
    assert.equal(store.projects().length, 0);
    assert.equal(existsSync(source), true);
    assert.ok(readFileSync(join(directory, "worker.sqlite")).length);
    store.save(settings, null);
    assert.equal(store.encryptedKey(), undefined);
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
    rmSync(source, { recursive: true, force: true });
  }
});

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}/v1`;
}
test("gateway loads exact model IDs and rejects redirects without forwarding credentials", async () => {
  let mode: "catalog" | "redirect" | "invalid" | "auth" = "catalog";
  let redirected = false;
  const server = createServer((req, res) => {
    if (req.url !== "/v1/models") {
      redirected = true;
      res.end();
      return;
    }
    assert.equal(req.headers.authorization, "Bearer synthetic-only");
    if (mode === "redirect") {
      res.writeHead(302, { Location: "/stolen" });
      res.end();
      return;
    }
    if (mode === "auth") {
      res.writeHead(401);
      res.end("synthetic-only");
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      mode === "invalid"
        ? "invalid"
        : JSON.stringify({
            data: [
              { id: "provider/model-b" },
              { id: "provider/model-a" },
              { id: "provider/model-a" },
            ],
          }),
    );
  });
  const settings = defaultSettings();
  settings.gatewayUrl = await listen(server);
  try {
    assert.deepEqual(await fetchModels(settings, "synthetic-only"), [
      "provider/model-a",
      "provider/model-b",
    ]);
    mode = "redirect";
    await assert.rejects(fetchModels(settings, "synthetic-only"), /HTTP 302/);
    assert.equal(redirected, false);
    mode = "invalid";
    await assert.rejects(fetchModels(settings, "synthetic-only"), /định dạng/);
    mode = "auth";
    await assert.rejects(
      fetchModels(settings, "synthetic-only"),
      (error) =>
        error instanceof Error && !error.message.includes("synthetic-only"),
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
