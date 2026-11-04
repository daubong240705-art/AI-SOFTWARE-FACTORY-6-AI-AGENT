// Integration check in the real Electron main process; no window, gateway or model.
const { app, safeStorage } = require("electron");
const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync, readdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { randomUUID } = require("node:crypto");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const { RunController } = require("../electron/controller/runs.ts");
const directory = mkdtempSync(join(tmpdir(), "asf-ww1-electron-"));
app.setPath("userData", directory);
app.whenReady().then(async () => {
  let store;
  let exitCode = 0;
  try {
    assert.equal(
      safeStorage.isEncryptionAvailable(),
      true,
      "Windows secure storage must be available",
    );
    const secret = "synthetic-" + randomUUID();
    store = new Store(directory);
    store.save(defaultSettings(), safeStorage.encryptString(secret));
    store.close();
    store = new Store(directory);
    assert.equal(safeStorage.decryptString(store.encryptedKey()), secret);
    const settings = defaultSettings();
    settings.gatewayUrl = "https://unused.example/v1";
    settings.agents.find((agent) => agent.role === "be").model = "fixture";
    store.save(settings, safeStorage.encryptString(secret));
    const project = store.addProject(directory);
    const controller = new RunController(store, directory, () => undefined);
    const run = controller.start(
      project.id,
      "Update README documentation",
      "be",
    );
    await controller.stop(run.id);
    assert.equal(run.skillCatalog.version, 1);
    assert.equal(run.skillCatalog.skills.length, 4);
    assert.deepEqual(run.skillSelection.skills, []);
    store.close();
    store = new Store(directory);
    assert.deepEqual(store.run(run.id).skillCatalog, run.skillCatalog);
    assert.deepEqual(store.run(run.id).skillSelection, run.skillSelection);
    assert.equal(store.run(run.id).state, "cancelled");
    assert.equal(store.run(run.id).failure.code, "cancelled");
    assert.equal(store.run(run.id).metrics.requests, 0);
    assert.equal(store.run(run.id).metrics.inputTokens, null);
    for (const filename of readdirSync(directory).filter((name) =>
      name.startsWith("worker.sqlite"),
    )) {
      assert.equal(
        readFileSync(join(directory, filename)).includes(Buffer.from(secret)),
        false,
      );
    }
    store.close();
    store = undefined;
    console.log(
      "PASS: Electron SQLite persists skills, failure and metrics after cancel/reopen; Windows secure storage keeps ciphertext without plaintext key.",
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Native storage check failed",
    );
    exitCode = 1;
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
  app.exit(exitCode);
});
