import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { Store } from "../electron/storage/database";
import { RunController } from "../electron/controller/runs";
import { defaultSettings } from "../shared/defaults";
import { normalizeRun, type Run } from "../shared/runs";
import { snapshot } from "../electron/workspace/snapshot";
import { sourceVersion } from "../electron/team/evidence";
import { reportDecisionSchema } from "../shared/reports";

async function setup(linked = true) {
  const directory = mkdtempSync(join(tmpdir(), "asf-reports-")),
    source = join(directory, "source"),
    data = join(directory, "data");
  mkdirSync(source);
  writeFileSync(join(source, "a.txt"), "original\n");
  const store = new Store(data),
    project = store.addProject(source);
  const item = store.board.create({
    projectId: project.id,
    title: "Báo cáo",
    body: "Yêu cầu",
    criteria: ["Đọc được kết quả"],
    priority: 0,
    suggestedRole: null,
    planningState: "backlog",
  });
  const context = store.board.workChat({
    projectId: project.id,
    itemId: item.id,
  });
  const settings = defaultSettings();
  settings.gatewayUrl = "https://unused.example/v1";
  settings.agents.forEach((a) => (a.model = "fixture"));
  store.save(settings, undefined);
  const run = normalizeRun({
    id: randomUUID(),
    projectId: project.id,
    projectName: project.name,
    workspace: source,
    conversationId: context.conversationId,
    prompt: "Thực hiện yêu cầu",
    role: "lead",
    model: "fixture",
    mode: "direct",
    state: "running",
    settings,
    createdAt: "2020-01-01T00:00:00.000Z",
    startedAt: null,
    endedAt: null,
    sessionId: null,
    summary: "Đã thực hiện",
    error: "",
    changes: [],
    commands: [],
    permissions: [],
    requests: 1,
    baselineComplete: true,
    toolsCompleted: 0,
    runtimeVersion: "fixture",
    inputTokens: 0,
    outputTokens: 0,
    tasks: [],
    profiles: [],
    currentTaskId: null,
    fixRound: 0,
    review: null,
    ...(linked
      ? {
          workContext: store.board.chatSnapshot(
            project.id,
            item.id,
            1,
            context.conversationId,
          ),
        }
      : {}),
  } as Run);
  store.createRun(run);
  if (linked)
    store.board.attachChat(randomUUID(), run.workContext!, {
      runId: run.id,
      followUpId: null,
    });
  const before = await snapshot(source, true);
  store.evidence.begin(run.id, source, before, {
    state: null,
    versions: {},
    blobs: new Map(),
  });
  writeFileSync(join(source, "a.txt"), "changed\n");
  const after = await snapshot(source, true);
  store.evidence.finish(run.id, after, {
    state: null,
    versions: {},
    blobs: new Map(),
  });
  run.changes = [{ path: "a.txt", kind: "modified" }];
  const ref = { projectId: project.id, runId: run.id },
    version = sourceVersion(after)!;
  const finish = () => {
    run.state = "completed";
    run.endedAt = "2020-01-01T00:01:00.000Z";
    store.updateRun(run);
  };
  const cleanup = () => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  };
  return {
    directory,
    source,
    data,
    store,
    project,
    item,
    context,
    run,
    ref,
    version,
    finish,
    cleanup,
  };
}

test("terminal report is immutable, exact revision/attempt survives restart, and direct completion stays unverified", async () => {
  const x = await setup();
  try {
    assert.throws(() => x.store.reports.capture(x.ref), /chưa có kết quả cuối/);
    x.finish();
    const report = x.store.reports.capture(x.ref);
    assert.equal(report.work?.revision, 1);
    assert.ok(report.work?.submissionId);
    assert.equal(report.verification, "unknown");
    assert.equal(report.criteria[0].result, "not-run");
    assert.equal(report.metrics.cost, null);
    assert.equal(report.metrics.inputTokens, null);
    x.run.summary = "Later overwrite";
    x.run.changes = [];
    x.store.updateRun(x.run);
    assert.deepEqual(x.store.reports.capture(x.ref), report);
    assert.equal(x.store.reports.snapshotRun(x.run.id).summary, "Đã thực hiện");
    const db = new Database(join(x.data, "worker.sqlite"));
    assert.throws(
      () => db.prepare("UPDATE reports SET value='{}'").run(),
      /immutable/,
    );
    db.close();
    const reopened = new Store(x.data);
    assert.deepEqual(reopened.reports.capture(x.ref), report);
    reopened.close();
    assert.throws(
      () => x.store.reports.capture({ ...x.ref, projectId: randomUUID() }),
      /không thuộc/,
    );
  } finally {
    x.cleanup();
  }
});

test("commands distinguish pass/fail/not-run/unknown and export includes provenance, pinned diff and missing artifacts honestly", async () => {
  const x = await setup();
  try {
    const output = "1 test passed\n",
      hash = createHash("sha256").update(output).digest("hex");
    x.store.evidence.saveCommand(x.run.id, "cmd-ok", output);
    x.run.commands = [
      {
        command: "npm test",
        callId: "one",
        artifactId: "cmd-ok",
        artifactHash: hash,
        status: "completed",
        exitCode: 0,
        output: "summary",
      },
      {
        command: "npm run build",
        callId: "two",
        status: "completed",
        exitCode: 1,
        output: "error",
      },
      {
        command: "npm run lint",
        callId: "three",
        artifactId: "cmd-missing",
        artifactHash: hash,
        status: "completed",
        exitCode: 0,
        output: "claim",
      },
      {
        command: "npm run later",
        callId: "four",
        status: "pending",
        exitCode: null,
        output: "",
      },
    ];
    x.finish();
    const report = x.store.reports.capture(x.ref);
    assert.deepEqual(
      report.commands.map((c) => c.result),
      ["pass", "fail", "unknown", "not-run"],
    );
    assert.equal(report.verification, "fail");
    writeFileSync(join(x.source, "a.txt"), "unrelated latest content");
    const diff = x.store.reports.fileDiff({ ...x.ref, path: "a.txt" });
    assert.match(diff.patch, /-original/);
    assert.match(diff.patch, /\+changed/);
    assert.doesNotMatch(diff.patch, /unrelated/);
    const pack = x.store.reports.export(x.ref);
    assert.equal(pack.attachments[0].status, "included");
    assert.equal(pack.attachments[2].status, "missing");
    assert.equal(pack.manifest.revision, 1);
    assert.equal(pack.manifest.sourceVersion, x.version);
    assert.match(pack.manifest.reportHash, /^[a-f0-9]{64}$/);
    assert.match(pack.files[0].patch, /\+changed/);
    const db = new Database(join(x.data, "worker.sqlite"));
    db.prepare("DELETE FROM command_artifacts WHERE run_id=?").run(x.run.id);
    db.prepare("DELETE FROM workspace_blobs").run();
    db.close();
    assert.equal(
      x.store.reports.export(x.ref).attachments[0].status,
      "missing",
    );
    assert.ok(x.store.reports.view(x.ref, x.version).artifactIssues.length);
    assert.ok(x.store.reports.fileDiff({ ...x.ref, path: "a.txt" }).reason);
    assert.throws(
      () => x.store.reports.fileDiff({ ...x.ref, path: "../secret" }),
      /không thuộc/,
    );
  } finally {
    x.cleanup();
  }
});

test("acceptance is optional, versioned and bound to report/source/revision without changing evidence verification", async () => {
  const x = await setup();
  try {
    x.finish();
    assert.deepEqual(x.store.reports.policy(x.project.id, x.item.id), {
      required: false,
      version: 0,
    });
    assert.deepEqual(
      x.store.reports.setPolicy({
        projectId: x.project.id,
        itemId: x.item.id,
        version: 0,
        required: true,
      }),
      { required: true, version: 1 },
    );
    assert.throws(
      () =>
        x.store.reports.setPolicy({
          projectId: x.project.id,
          itemId: x.item.id,
          version: 0,
          required: false,
        }),
      /đã thay đổi/,
    );
    const input = {
      ...x.ref,
      requestId: randomUUID(),
      action: "accept" as const,
      comment: "",
    };
    assert.throws(
      () =>
        x.store.reports.decide(input, null, () => {
          throw Error("Unexpected launch");
        }),
      /đối chiếu/,
    );
    const view = x.store.reports.decide(input, x.version, () => {
      throw Error("Unexpected launch");
    });
    assert.equal(view.decision?.action, "accept");
    assert.equal(view.report.verification, "unknown");
    assert.equal(x.store.run(x.run.id).state, "completed");
    assert.equal(
      x.store.reports.decide(input, null, () => {
        throw Error("Unexpected launch");
      }).decision?.action,
      "accept",
    );
    const changed = x.store.reports.view(x.ref, "f".repeat(64));
    assert.equal(changed.freshness, "stale");
    assert.equal(changed.decision?.action, "accept");
    x.store.board.update({
      id: x.item.id,
      version: x.store.board.item(x.item.id).version,
      patch: { criteria: ["New criterion"] },
    });
    assert.equal(x.store.reports.view(x.ref, x.version).freshness, "stale");
    assert.equal(x.store.reports.view(x.ref, x.version).canDecide, false);
    assert.equal(
      x.store.reports.capture(x.ref).work?.criteria[0],
      "Đọc được kết quả",
    );
  } finally {
    x.cleanup();
  }
});

test("fix comment, queue and receipt commit atomically, deduplicate across restart and never resurrect removed continuation", async () => {
  const x = await setup();
  try {
    x.finish();
    const held = x.store.queue.add({
      projectId: x.project.id,
      conversationId: x.context.conversationId,
      prompt: "Block fixture",
      role: "lead",
      mode: "team",
      settings: x.run.settings,
      afterRunId: null,
      state: "held",
      reason: "Fixture",
    });
    const controller = new RunController(x.store, x.data, () => undefined);
    const input = {
      ...x.ref,
      requestId: randomUUID(),
      action: "request-fix" as const,
      comment: "Sửa lỗi hiển thị tiếng Việt",
    };
    const view = await controller.reportDecision(input);
    const receipt = view.decision!.receipt!;
    assert.ok(receipt.followUpId);
    assert.equal(receipt.runId, null);
    assert.equal(
      x.store.board.detail({ projectId: x.project.id, itemId: x.item.id })
        .comments.length,
      1,
    );
    const queue = x.store.queue.list();
    assert.equal(queue.length, 2);
    assert.match(
      queue.find((q) => q.id !== held.id)!.prompt,
      new RegExp(view.report.id),
    );
    const reopened = new Store(x.data),
      next = new RunController(reopened, x.data, () => undefined);
    assert.deepEqual(
      (await next.reportDecision(input)).decision!.receipt,
      receipt,
    );
    assert.equal(reopened.queue.list().length, 2);
    reopened.close();
    x.store.queue.remove(receipt.followUpId!);
    assert.equal(
      (await controller.reportDecision(input)).decision!.receipt!.state,
      "removed",
    );
    assert.equal(x.store.queue.list().length, 1);
    await assert.rejects(
      controller.reportDecision({ ...input, comment: "Changed payload" }),
      /đã có quyết định/,
    );
    assert.equal(
      x.store.board.detail({ projectId: x.project.id, itemId: x.item.id })
        .comments.length,
      1,
    );
  } finally {
    x.cleanup();
  }
});

test("failed fix transaction rolls back comment, receipt and phantom runtime; immediate retry creates one run", async () => {
  const x = await setup();
  try {
    x.finish();
    const input = {
      ...x.ref,
      requestId: randomUUID(),
      action: "request-fix" as const,
      comment: "Fix",
    };
    const controller = new RunController(x.store, x.data, () => undefined);
    const db = new Database(join(x.data, "worker.sqlite"));
    db.exec(
      "CREATE TRIGGER reject_report_decision BEFORE INSERT ON report_decisions BEGIN SELECT RAISE(ABORT,'Fixture rollback'); END",
    );
    await assert.rejects(controller.reportDecision(input), /Fixture rollback/);
    assert.equal(
      x.store.board.detail({ projectId: x.project.id, itemId: x.item.id })
        .comments.length,
      0,
    );
    assert.equal(controller.view().activeId, null);
    assert.equal(x.store.runs().length, 1);
    db.exec("DROP TRIGGER reject_report_decision");
    db.close();
    const pending = controller.reportDecision(input);
    // Admission stays inside the existing Controller; stop immediately after receipt.
    const view = await pending;
    assert.ok(view.decision!.receipt!.runId);
    const runId = view.decision!.receipt!.runId!;
    await controller.stop(runId);
    assert.equal(x.store.runs().length, 2);
    assert.equal(
      (await controller.reportDecision(input)).decision!.receipt!.runId,
      runId,
    );
  } finally {
    x.cleanup();
  }
});

test("retention protects work reports; unlinked reports prune with runs without orphaning artifacts", async () => {
  const x = await setup(false);
  try {
    x.finish();
    // Keep a newer run so the old unlinked report is eligible.
    const newer = {
      ...x.run,
      id: randomUUID(),
      state: "cancelled" as const,
      createdAt: new Date().toISOString(),
    };
    x.store.createRun(newer);
    x.store.updateRun(newer);
    const ticket = x.store.retention(1, 1);
    assert.ok(ticket.runIds.includes(x.run.id));
    assert.equal(x.store.prune(ticket.token), 1);
    const db = new Database(join(x.data, "worker.sqlite"));
    assert.equal(
      (
        db
          .prepare("SELECT count(*) AS n FROM reports WHERE run_id=?")
          .get(x.run.id) as { n: number }
      ).n,
      0,
    );
    assert.deepEqual(db.pragma("foreign_key_check"), []);
    db.close();
  } finally {
    x.cleanup();
  }
  const y = await setup();
  try {
    y.finish();
    const newer = {
      ...y.run,
      id: randomUUID(),
      workContext: undefined,
      state: "cancelled" as const,
      createdAt: new Date().toISOString(),
    };
    y.store.createRun(newer);
    y.store.updateRun(newer);
    assert.ok(!y.store.retention(1, 1).runIds.includes(y.run.id));
    assert.ok(y.store.reports.protectedRunIds().includes(y.run.id));
  } finally {
    y.cleanup();
  }
});

test("schema10 backup preserves credentials and conversations; legacy history is only snapshotted on demand", async () => {
  const x = await setup();
  x.finish();
  const expected = x.store.reports.capture(x.ref);
  x.store.save(x.run.settings, Buffer.from([1, 7, 9]));
  x.store.close();
  const db = new Database(join(x.data, "worker.sqlite"));
  db.exec(
    "DROP TABLE chat_images; DROP TABLE inbox_seen; DROP TABLE report_decisions; DROP TABLE report_policies; DROP TABLE reports; PRAGMA user_version=10",
  );
  db.close();
  const reopened = new Store(x.data);
  try {
    const backup = join(x.data, "worker.schema10.pre-reports.backup.sqlite");
    assert.ok(existsSync(backup));
    const old = new Database(backup, { readonly: true });
    assert.equal(old.pragma("user_version", { simple: true }), 10);
    old.close();
    assert.deepEqual(reopened.encryptedKey(), Buffer.from([1, 7, 9]));
    assert.equal(reopened.reports.capture(x.ref).summary, expected.summary);
    assert.ok(
      reopened.conversations.get(x.context.conversationId).conversation,
    );
  } finally {
    reopened.close();
    rmSync(x.directory, { recursive: true, force: true });
  }
});

test("decision schemas reject empty fixes and extra fields", () => {
  const ref = {
    projectId: randomUUID(),
    runId: randomUUID(),
    requestId: randomUUID(),
  };
  assert.equal(
    reportDecisionSchema.safeParse({
      ...ref,
      action: "request-fix",
      comment: " ",
    }).success,
    false,
  );
  assert.equal(
    reportDecisionSchema.safeParse({
      ...ref,
      action: "accept",
      comment: "",
      fullAccess: true,
    }).success,
    false,
  );
});

test("verified team evidence can pass; legacy and missing evidence never inherit that status", async () => {
  for (const variant of ["valid", "missing", "legacy", "stale"]) {
    const x = await setup();
    try {
      const captured = await snapshot(x.source, true);
      const evidence = x.store.evidence.saveTaskSnapshot(captured)!;
      x.run.mode = "team";
      x.run.tasks = [
        {
          id: "t1",
          role: "be",
          title: "Edit",
          kind: "work",
          round: 0,
          state: "completed",
          model: "fixture",
          sessionId: "session",
          evidence,
          instructions: "Edit",
          allowedPaths: ["."],
          acceptance: ["File updated"],
          dependsOn: [],
          startedAt: null,
          endedAt: x.run.endedAt,
          summary: "Done",
          error: "",
          changes: x.run.changes,
          commandIds: [],
        },
      ];
      const ref = {
        kind: "file" as const,
        runId: x.run.id,
        taskId: "t1",
        attemptId: "t1",
        sessionId: "session",
        sourceVersion: evidence.sourceVersion,
        path: "a.txt",
        hash: captured.files["a.txt"],
      };
      x.run.review = {
        version: 2,
        status: "completed",
        summary: "Review",
        acceptance: [
          {
            criterionId: "t1:ac1",
            criterion: "File updated",
            status: "passed",
            evidence: "Captured source",
            method: "source",
            refs: [ref],
          },
        ],
        fixes: [],
        limitations: [],
        verification: { verified: true, issues: [] },
      };
      if (variant === "legacy")
        x.run.review = {
          status: "completed",
          summary: "Legacy",
          acceptance: [
            { criterion: "File updated", status: "passed", evidence: "Claim" },
          ],
          fixes: [],
          limitations: [],
        };
      if (variant === "missing") {
        const db = new Database(join(x.data, "worker.sqlite"));
        db.prepare("DELETE FROM workspace_blobs").run();
        db.close();
      }
      if (variant === "stale") {
        writeFileSync(join(x.source, "a.txt"), "Changed after review");
        x.store.evidence.finish(x.run.id, await snapshot(x.source, true), {
          state: null,
          versions: {},
          blobs: new Map(),
        });
      }
      x.finish();
      assert.equal(
        x.store.reports.capture(x.ref).verification,
        variant === "valid" ? "pass" : "unknown",
      );
    } finally {
      x.cleanup();
    }
  }
});

test("export hash matches the sanitized report, and stale reports cannot be accepted or used for fixes", async () => {
  const x = await setup();
  try {
    x.run.summary = "Sensitive fixture-key";
    x.finish();
    const pack = x.store.reports.export(x.ref, ["fixture-key"]);
    assert.doesNotMatch(JSON.stringify(pack), /fixture-key/);
    assert.equal(
      pack.manifest.reportHash,
      createHash("sha256").update(JSON.stringify(pack.report)).digest("hex"),
    );
    const finalExport = JSON.parse(
      x.store.report(x.run.id, ["fixture-key"]),
    ).result;
    assert.equal(
      finalExport.manifest.reportHash,
      createHash("sha256")
        .update(JSON.stringify(finalExport.report))
        .digest("hex"),
    );
    const item = x.store.board.item(x.item.id);
    x.store.board.update({
      id: item.id,
      version: item.version,
      patch: { body: "New body" },
    });
    for (const action of ["accept", "request-fix"] as const)
      assert.throws(
        () =>
          x.store.reports.decide(
            { ...x.ref, requestId: randomUUID(), action, comment: "Fix" },
            x.version,
            () => {
              throw Error("Should not launch");
            },
          ),
        /Báo cáo cũ/,
      );
  } finally {
    x.cleanup();
  }
});
