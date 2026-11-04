import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Store } from "../electron/storage/database";
import { RunController } from "../electron/controller/runs";
import { defaultSettings } from "../shared/defaults";
import { normalizeRun, type Run } from "../shared/runs";
import {
  inspectWorkspace,
  fingerprint,
} from "../electron/workspace/checkpoint";
import { snapshot } from "../electron/workspace/snapshot";
import { git, captureGit, hashBytes } from "../electron/workspace/git-evidence";

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "asf-lifecycle-"));
  const source = join(directory, "source");
  await mkdir(source);
  const data = join(directory, "data");
  const store = new Store(data);
  const settings = defaultSettings();
  settings.gatewayUrl = "https://unused.example/v1";
  settings.agents.forEach((a) => {
    a.model = "fixture";
  });
  store.save(settings, undefined);
  const project = store.addProject(source);
  function run(patch: Partial<Run> = {}): Run {
    const value = normalizeRun({
      id: randomUUID(),
      projectId: project.id,
      projectName: "Fixture",
      workspace: source,
      prompt: "Evaluate",
      role: "be",
      model: "fixture",
      mode: "direct",
      state: "failed",
      settings,
      createdAt: "2020-01-01T00:00:00.000Z",
      startedAt: null,
      endedAt: null,
      sessionId: null,
      summary: "Previous result",
      error: "Interrupted test",
      changes: [],
      commands: [],
      permissions: [],
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      toolsCompleted: 0,
      baselineComplete: true,
      runtimeVersion: "1.19.5",
      tasks: [],
      profiles: [],
      currentTaskId: null,
      fixRound: 0,
      review: null,
      ...patch,
    });
    store.createRun(value);
    return value;
  }
  return {
    directory,
    data,
    source,
    store,
    settings,
    project,
    run,
    async cleanup() {
      store.close();
      assert.ok(directory.startsWith(join(tmpdir(), "asf-lifecycle-")));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("recovery compares source, HEAD and index independently without changing Git", async () => {
  const s = await setup();
  try {
    const run = s.run();
    await git(s.source, ["init"]);
    await git(s.source, ["config", "user.name", "Fixture"]);
    await git(s.source, ["config", "user.email", "fixture@example.invalid"]);
    await writeFile(join(s.source, "source.txt"), "one");
    await git(s.source, ["add", "."]);
    await git(s.source, ["commit", "-m", "fixture"]);
    const original = await inspectWorkspace(run);
    assert.equal(original.complete, true);
    assert.ok(original.head);
    assert.equal(
      fingerprint(original),
      fingerprint(await inspectWorkspace(run)),
    );
    await writeFile(join(s.source, "source.txt"), "two");
    const edited = await inspectWorkspace(run);
    assert.notEqual(edited.source, original.source);
    assert.equal(edited.index, original.index);
    await git(s.source, ["add", "."]);
    const staged = await inspectWorkspace(run);
    assert.equal(staged.source, edited.source);
    assert.notEqual(staged.index, edited.index);
    await git(s.source, ["commit", "-m", "stage"]);
    const committed = await inspectWorkspace(run);
    assert.notEqual(committed.head, staged.head);
    assert.equal(
      (await git(s.source, ["status", "--porcelain"])).toString(),
      "",
    );
  } finally {
    await s.cleanup();
  }
});

test("recovery rejects changed/consumed tokens, serializes inspection and starts a distinct attempt with context", async () => {
  const s = await setup();
  const controller = new RunController(s.store, s.data, () => undefined);
  try {
    const previous = s.run({ state: "interrupted" });
    await writeFile(join(s.source, "README.md"), "one");
    const inspecting = controller.recovery(previous.id);
    assert.throws(() => controller.start(s.project.id, "Busy", "be"));
    const preview = await inspecting;
    assert.equal(preview.complete, true);
    await writeFile(join(s.source, "README.md"), "two");
    await assert.rejects(
      controller.continueRecovery(preview.token),
      /Source\/Git/,
    );
    await assert.rejects(controller.continueRecovery(preview.token), /hết hạn/);
    assert.equal(controller.view().activeId, null);
    const fresh = await controller.recovery(previous.id);
    const next = await controller.continueRecovery(fresh.token);
    await controller.stop(next.id);
    const recovered = s.store.run(next.id);
    assert.notEqual(recovered.id, previous.id);
    assert.equal(recovered.recoveryOf, previous.id);
    assert.equal(recovered.retryOf, previous.id);
    assert.match(recovered.context!.text, /Previous result/);
    assert.match(recovered.context!.text, /không replay/);
    assert.equal(recovered.requests, 0);
    assert.equal(s.store.run(previous.id).state, "interrupted");
    await assert.rejects(controller.continueRecovery(fresh.token), /hết hạn/);
  } finally {
    await controller.shutdown();
    await s.cleanup();
  }
});

test("incomplete snapshots identify the path and prevent recovery", async () => {
  const s = await setup();
  const controller = new RunController(s.store, s.data, () => undefined);
  try {
    await writeFile(join(s.source, "large.bin"), Buffer.alloc(1024 * 1024 + 1));
    const source = await snapshot(s.source);
    assert.equal(source.complete, false);
    assert.equal(source.problems?.[0].path, "large.bin");
    const preview = await controller.recovery(s.run().id);
    assert.equal(preview.complete, false);
    await assert.rejects(
      controller.continueRecovery(preview.token),
      /snapshot/,
    );
  } finally {
    await controller.shutdown();
    await s.cleanup();
  }
});

test(
  "Windows file locks produce incomplete snapshot diagnostics and preserve source",
  { skip: process.platform !== "win32", timeout: 15000 },
  async () => {
    const s = await setup();
    let child: ReturnType<typeof spawn> | undefined;
    try {
      const path = join(s.source, "locked.txt");
      await writeFile(path, "preserve locked content");
      const script = `$f=[IO.File]::Open('${path.replaceAll("'", "''")}',[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);try{[Console]::WriteLine('locked');[Console]::In.ReadLine()|Out-Null}finally{$f.Dispose()}`;
      child = spawn(
        join(
          process.env.SystemRoot ?? "C:\\Windows",
          "System32/WindowsPowerShell/v1.0/powershell.exe",
        ),
        [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(script, "utf16le").toString("base64"),
        ],
        { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
      );
      await new Promise<void>((ok, bad) => {
        child!.stdout!.once("data", () => ok());
        child!.once("exit", () => bad(new Error("Lock process exited")));
      });
      const locked = await snapshot(s.source);
      assert.equal(locked.complete, false);
      assert.equal(locked.problems?.[0].path, "locked.txt");
      const closed = once(child, "close");
      child.stdin!.end();
      await closed;
      const unlocked = await snapshot(s.source);
      assert.equal(unlocked.complete, true);
      assert.equal(
        unlocked.files["locked.txt"],
        hashBytes(Buffer.from("preserve locked content")),
      );
    } finally {
      child?.kill();
      await s.cleanup();
    }
  },
);

test("reopening preserves checkpoints and clears permissions; abandoning recovery keeps source and evidence", async () => {
  const s = await setup();
  try {
    await writeFile(join(s.source, "source.txt"), "keep edits");
    const previous = s.run({
      state: "running",
      permissions: [
        { id: "stale", permission: "bash", patterns: ["npm test"] },
      ],
    });
    previous.checkpoints = [await inspectWorkspace(previous)];
    s.store.updateRun(previous);
    const controller = new RunController(s.store, s.data, () => undefined);
    const reopened = s.store.run(previous.id);
    assert.equal(reopened.state, "interrupted");
    assert.deepEqual(reopened.permissions, []);
    assert.equal(reopened.checkpoints?.length, 1);
    await controller.stop(previous.id);
    assert.equal(s.store.run(previous.id).state, "cancelled");
    assert.equal(s.store.run(previous.id).summary, "Previous result");
    assert.equal(
      (await snapshot(s.source)).files["source.txt"],
      hashBytes(Buffer.from("keep edits")),
    );
    await controller.shutdown();
  } finally {
    await s.cleanup();
  }
});

test("export redacts nested text and every event while keeping JSON valid and excluding credentials/instructions", async () => {
  const s = await setup();
  try {
    const secret = 'fixture-"quoted-\\-key';
    const run = s.run({
      prompt: `apiKey=${secret}`,
      summary: `Bearer secret-token ${secret}`,
      context: { text: "PRIVATE_CONTEXT", runIds: [] },
    });
    s.store.save(s.settings, Buffer.from("PRIVATE_CREDENTIAL"));
    for (let i = 0; i < 350; i++)
      s.store.event(run.id, "SAMPLE", `password=foo ${secret}`);
    const report = s.store.report(run.id, [secret]);
    const json = JSON.parse(report);
    assert.equal(
      json.events.filter((event: { type: string }) => event.type === "SAMPLE")
        .length,
      350,
    );
    assert.equal(json.run.id, run.id);
    assert.match(report, /REDACTED/);
    assert.doesNotMatch(
      report,
      /PRIVATE_CONTEXT|PRIVATE_CREDENTIAL|secret-token|password=foo/,
    );
    assert.equal(JSON.stringify(json).includes(secret), false);
    assert.equal(json.run.settings, undefined);
    assert.equal(json.run.profiles, undefined);
  } finally {
    await s.cleanup();
  }
});

test("retention protects active/interrupted/queued and transitive recovery references, GC preserves shared blobs", async () => {
  const s = await setup();
  try {
    await writeFile(join(s.source, "shared.txt"), "shared content");
    const base = s.run();
    const child = s.run({ recoveryOf: base.id });
    const latest = s.run({
      createdAt: new Date().toISOString(),
      context: { text: "", runIds: [child.id] },
    });
    const interrupted = s.run({ state: "interrupted" });
    const active = s.run({ state: "running" });
    const queued = s.run();
    const conversation = s.store.conversations.create(s.project.id);
    s.store.queue.add({
      projectId: s.project.id,
      conversationId: conversation.id,
      prompt: "Next",
      role: "be",
      mode: "direct",
      settings: s.settings,
      state: "held",
      reason: "wait",
      afterRunId: queued.id,
    });
    const removed = s.run();
    const snap = await snapshot(s.source, true),
      g = await captureGit(s.source, true);
    s.store.evidence.begin(latest.id, s.source, snap, g);
    s.store.evidence.begin(removed.id, s.source, snap, g);
    await writeFile(join(s.source, "unused.txt"), "unused content");
    s.store.evidence.finish(removed.id, await snapshot(s.source, true), g);
    const preview = s.store.retention(30, 1);
    assert.deepEqual(preview.runIds, [removed.id]);
    assert.equal(s.store.prune(preview.token), 1);
    assert.throws(() => s.store.run(removed.id));
    for (const r of [base, child, latest, interrupted, active, queued])
      assert.equal(s.store.run(r.id).id, r.id);
    assert.equal(
      s.store.evidence
        .bytes({
          hash: hashBytes(Buffer.from("shared content")),
          size: 14,
          mode: 0,
        })!
        .toString(),
      "shared content",
    );
    assert.throws(() =>
      s.store.evidence.bytes({
        hash: hashBytes(Buffer.from("unused content")),
        size: 14,
        mode: 0,
      }),
    );
    assert.throws(() => s.store.prune(preview.token), /hết hạn/);
  } finally {
    await s.cleanup();
  }
});

test("retention refuses a preview when a new reference or active state appears", async () => {
  const s = await setup();
  try {
    const old = s.run();
    const survivor = s.run({ createdAt: new Date().toISOString() });
    const preview = s.store.retention(30, 1);
    survivor.retryOf = old.id;
    s.store.updateRun(survivor);
    assert.throws(() => s.store.prune(preview.token), /tham chiếu/);
    survivor.retryOf = undefined;
    s.store.updateRun(survivor);
    const next = s.store.retention(30, 1);
    old.state = "running";
    s.store.updateRun(old);
    assert.throws(() => s.store.prune(next.token), /hoạt động/);
    assert.equal(s.store.run(old.id).state, "running");
  } finally {
    await s.cleanup();
  }
});
