import assert from "node:assert/strict";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "../src/config/index.js";
import { startHost } from "../src/host.js";
import { extensionPackDirs } from "../src/org/extensions.js";
import { loadPack } from "../src/org/pack.js";
import { loadPackRegistry } from "../src/org/registry.js";
import { runDoctor } from "../src/system/doctor.js";
import { fixedClock, idFactory, MIGRATIONS_DIR, tempDir } from "./helpers.js";

const extensionsDir = fileURLToPath(new URL("../../test/fixtures/extensions/", import.meta.url));
const packsDir = fileURLToPath(new URL("../../../../packs/", import.meta.url));

test("only enabled extensions expose their packs and Workflow v2 templates", async (context) => {
  const { dir, cleanup } = tempDir();
  let close: (() => Promise<void>) | undefined;
  context.after(async () => { try { await close?.(); } finally { cleanup(); } });
  const newId = idFactory();
  const host = await startHost({ stateDir: dir, port: 8787, migrationsDir: MIGRATIONS_DIR, listen: false, openLogin: true, dispatch: null,
    extensionsDir, extensionKeys: ["sample"], packsDir, clock: fixedClock(), onBootstrapToken() {} });
  close = () => host.close();
  const origin = host.origins[0]!;
  const base = { host: new URL(origin).host };
  const session = await host.app.inject({ url: "/auth/session", headers: base });
  const cookie = session.cookies[0]!;
  const headers = { ...base, cookie: `${cookie.name}=${cookie.value}`, origin, "x-csrf-token": session.json().csrfToken };
  const listed = await host.app.inject({ url: "/packs", headers });
  assert.equal(listed.statusCode, 200);
  assert.ok(listed.json().packs.some(({ key }: { key: string }) => key === "web-games"));
  const detail = await host.app.inject({ url: "/packs/web-games", headers });
  assert.deepEqual(detail.json().workflows, [{ key: "fixture", revision: 1, title: "Native v2 fixture" }]);
  const projectId = newId();
  const command = async (type: string, payload: unknown) => {
    const response = await host.app.inject({ method: "POST", url: "/commands", headers,
      payload: { apiVersion: 1, commandId: newId(), projectId, type, payload } });
    assert.equal(response.statusCode, 200, response.body);
  };
  await command("projects.create", { name: "Extension fixture", teamTemplate: "web-games", workspace: { kind: "directory", root: join(dir, "project") } });
  const flowId = newId();
  await command("flows.import-v1", { packKey: "web-games", definitionKey: "fixture", flowId });
  const flow = await host.app.inject({ url: `/projects/${projectId}/flows/${flowId}`, headers });
  assert.equal(flow.json().draft.title, "Native v2 fixture");
  assert.ok(host.storage.raw.prepare("SELECT 1 FROM agent_templates WHERE source_pack_key='web-games'").get());
});

test("extension pack errors are isolated; core packs cannot silently restore retired keys", async (context) => {
  const { dir, cleanup } = tempDir();
  context.after(cleanup);
  const core = join(dir, "core"), extensions = join(dir, "extensions"), sample = join(extensions, "sample");
  mkdirSync(core);
  cpSync(extensionsDir, extensions, { recursive: true });
  cpSync(join(sample, "packs/example"), join(core, "web-games"), { recursive: true });
  assert.deepEqual(loadPackRegistry(core), []);
  writeFileSync(join(sample, "extension.json"), JSON.stringify({ key: "sample", name: "Fixture", description: "Fixture", version: "1.0.0",
    packs: ["packs/example", "packs/missing", "packs/invalid"] }));
  mkdirSync(join(sample, "packs/invalid"));
  const issues: string[] = [];
  const report = (message: string) => { issues.push(message); };
  const extraDirs = extensionPackDirs(extensions, ["sample", "absent"], report);
  assert.deepEqual(loadPackRegistry(core, { extraDirs, onError: report }).map(({ key }) => key), ["web-games"]);
  assert.equal(issues.length, 3);
  const config = resolveConfig({ FACTORY_EXTENSIONS: "sample" }, { FACTORY_EXTENSIONS: "unused", FACTORY_EXTENSIONS_DIR: extensions }, join(dir, "factory.env"));
  assert.equal(config.issues.length, 0);
  const doctor = await runDoctor({ config: config.env, stateDir: dir, port: 8787, running: true,
    exec: async () => ({ code: 0, stdout: "v22.23.4", stderr: "" }) });
  assert.equal(doctor.checks.find(({ id }) => id === "D-EXT")?.status, "fail");
  writeFileSync(join(sample, "packs/example/flows/wrong.json"), JSON.stringify({ schema: 2, key: "fixture", title: "Wrong",
    nodes: [{ id: "start", title: "Start", type: "trigger", trigger: { kind: "manual" } }], edges: [] }));
  assert.throws(() => loadPack(join(sample, "packs/example")), /Invalid pack content/);
});
