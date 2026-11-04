import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  utimes,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import type { Event } from "@opencode-ai/sdk/v2/client";
import type { EvidenceRef } from "../shared/evidence";
import type { Run } from "../shared/runs";
import { defaultSettings } from "../shared/defaults";
import { reviewSchema, type EvidenceReview } from "../shared/team";
import { newTask, coordinate, TeamBlocked } from "../electron/team/coordinator";
import {
  commandArtifactId,
  sourceVersion,
  criteria,
  evidenceCatalog,
  verifyEvidence,
  readEvidence,
} from "../electron/team/evidence";
import { snapshot } from "../electron/workspace/snapshot";
import { Store } from "../electron/storage/database";
import { RunController } from "../electron/controller/runs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RunPanel } from "../src/features/RunPanel";

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "asf-completion-"));
  const root = join(directory, "source");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "a.ts"), "export const a = 1;\n");
  const store = new Store(join(directory, "data"));
  const settings = defaultSettings();
  settings.agents.forEach((a) => {
    a.enabled = true;
    a.model = "fixture";
  });
  const run: Run = {
    id: randomUUID(),
    projectId: randomUUID(),
    projectName: "fixture",
    workspace: root,
    prompt: "Update docs",
    role: "lead",
    model: "fixture",
    mode: "team",
    tasks: [],
    profiles: [],
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
  };
  store.createRun(run);
  const task = newTask(run, {
    id: "t1",
    originalTaskId: "t1",
    role: "be",
    title: "Docs",
    instructions: "Read source",
    allowedPaths: ["src"],
    acceptance: ["Source documented", "Source documented"],
    dependsOn: [],
    kind: "work",
  });
  task.sessionId = "session1";
  task.state = "completed";
  task.evidence = store.evidence.saveTaskSnapshot(await snapshot(root, true));
  run.tasks.push(task);
  const latest = new Map([["t1", task]]);
  const fileRef = evidenceCatalog(run, latest).refs[0];
  const version = sourceVersion(await snapshot(root))!;
  const callId = "same-call";
  const artifactId = commandArtifactId(run.id, task.id, task.sessionId, callId);
  const output = "1 test passed";
  run.commands.push({
    taskId: task.id,
    sessionId: task.sessionId,
    artifactId,
    artifactHash: createHash("sha256").update(output).digest("hex"),
    sourceVersion: version,
    callId,
    command: "npm test",
    status: "completed",
    exitCode: 0,
    output,
  });
  store.evidence.saveCommand(run.id, artifactId, output);
  const commandRef = evidenceCatalog(run, latest).refs.find(
    (r) => r.kind === "command",
  )!;
  function review(ref: EvidenceRef = fileRef): EvidenceReview {
    return {
      version: 2,
      status: "completed",
      summary: "Done",
      fixes: [],
      limitations: [],
      acceptance: criteria([task]).map((c) => ({
        criterionId: c.criterionId,
        criterion: c.criterion,
        status: "passed",
        evidence: "Lead checked source relevance",
        method: "source",
        refs: [structuredClone(ref)],
      })),
    };
  }
  const verify = async (r: EvidenceReview) =>
    verifyEvidence(
      r,
      run,
      [task],
      latest,
      await snapshot(root),
      store.evidence,
    );
  const cleanup = async () => {
    store.close();
    assert.ok(directory.startsWith(join(tmpdir(), "asf-completion-")));
    await rm(directory, { recursive: true, force: true });
  };
  return {
    directory,
    root,
    run,
    task,
    latest,
    fileRef,
    commandRef,
    store,
    review,
    verify,
    cleanup,
  };
}

test("stable AC IDs distinguish duplicate text; missing, duplicate and invented IDs cannot complete", async () => {
  const x = await setup();
  try {
    const good = x.review();
    await x.verify(good);
    assert.equal(good.status, "completed");
    assert.equal(good.verification?.verified, true);
    assert.deepEqual(
      good.acceptance.map((a) => a.criterionId),
      ["t1:ac1", "t1:ac2"],
    );
    const missing = x.review();
    missing.acceptance.pop();
    await assert.rejects(x.verify(missing), /AC ID/);
    const duplicate = x.review();
    duplicate.acceptance[1].criterionId = "t1:ac1";
    await assert.rejects(x.verify(duplicate), /AC ID/);
    const invented = x.review();
    invented.acceptance[0].criterionId = "t2:ac1";
    await assert.rejects(x.verify(invented), /AC ID/);
    assert.equal(
      reviewSchema.safeParse({
        ...good,
        verification: { verified: true, issues: [] },
      }).success,
      false,
      "model cannot submit validator metadata",
    );
  } finally {
    await x.cleanup();
  }
});

test("fake, cross-run, wrong session, stale attempt and missing evidence become visible unverified results", async () => {
  const x = await setup();
  try {
    for (const changed of [
      { ...x.fileRef, runId: randomUUID() },
      { ...x.fileRef, sessionId: "other" },
      { ...x.fileRef, attemptId: "t1-fix-1" },
      { ...x.fileRef, taskId: "t2" },
      { ...x.fileRef, path: "../secret", hash: null },
      { ...x.fileRef, sourceVersion: "0".repeat(64) },
      { ...x.commandRef, artifactId: "cmd-v1-" + "0".repeat(64) },
    ] as EvidenceRef[]) {
      const r = x.review(changed);
      await x.verify(r);
      assert.equal(r.status, "blocked");
      assert.equal(r.acceptance[0].status, "unverified");
      assert.ok(r.verification?.issues.length);
    }
    const missing = x.review();
    missing.acceptance[0].refs = [];
    await x.verify(missing);
    assert.equal(missing.status, "blocked");
    const absentCall = "absent-artifact";
    const absentId = commandArtifactId(x.run.id, "t1", "session1", absentCall);
    x.run.commands.push({
      ...x.run.commands[0],
      callId: absentCall,
      artifactId: absentId,
    });
    const absent = x.review({
      ...x.commandRef,
      callId: absentCall,
      artifactId: absentId,
    } as EvidenceRef);
    await x.verify(absent);
    assert.equal(absent.status, "blocked");
    const stale = x.review(x.commandRef);
    x.latest.set("t1", { ...x.task, id: "t1-fix-1", sessionId: "new-session" });
    await x.verify(stale);
    assert.equal(stale.status, "blocked");
  } finally {
    await x.cleanup();
  }
});

test("integrated catalog omits stale commands while preserving valid per-file evidence", async () => {
  const x = await setup();
  try {
    const version = sourceVersion(await snapshot(x.root))!;
    assert.ok(
      evidenceCatalog(x.run, x.latest, version).refs.some(
        (r) => r.kind === "command",
      ),
    );
    await writeFile(join(x.root, "unrelated.txt"), "new integrated output");
    const catalog = evidenceCatalog(
      x.run,
      x.latest,
      sourceVersion(await snapshot(x.root))!,
    );
    assert.equal(
      catalog.refs.some((r) => r.kind === "command"),
      false,
    );
    assert.ok(catalog.omitted > 0);
    assert.ok(catalog.refs.some((r) => r.kind === "file"));
    const review = x.review();
    await x.verify(review);
    assert.equal(review.verification?.verified, true);
    const stale = x.review(x.commandRef);
    await x.verify(stale);
    assert.equal(stale.status, "blocked");
  } finally {
    await x.cleanup();
  }
});

test("testing requires successful commands with stored output and unchanged source; semantic relevance stays with Lead", async () => {
  const x = await setup();
  try {
    x.task.acceptance = ["Kiểm thử thành công"];
    const fileOnly = x.review();
    await x.verify(fileOnly);
    assert.equal(fileOnly.status, "blocked");
    const command = x.run.commands[0];
    for (const [status, exitCode] of [
      ["error", 1],
      ["running", null],
      ["completed", null],
    ] as const) {
      command.status = status;
      command.exitCode = exitCode;
      const failed = x.review(x.commandRef);
      await x.verify(failed);
      assert.equal(failed.status, "blocked");
    }
    command.status = "completed";
    command.exitCode = 0;
    const good = x.review(x.commandRef);
    good.acceptance[0].method = "command";
    await x.verify(good);
    assert.equal(good.status, "completed");
    command.command = "echo unrelated";
    const unrelated = x.review(x.commandRef);
    await x.verify(unrelated);
    assert.equal(
      unrelated.verification?.verified,
      true,
      "integrity validation cannot prove command semantics; review prompt requires Lead to assess relevance",
    );
    const artifactId = command.artifactId!;
    x.store.evidence.saveCommand(x.run.id, artifactId, "tampered output");
    const tampered = x.review(x.commandRef);
    await x.verify(tampered);
    assert.equal(tampered.status, "blocked");
    x.store.evidence.saveCommand(x.run.id, artifactId, command.output);
    await writeFile(join(x.root, "src", "a.ts"), "new source");
    for (const ref of [x.fileRef, x.commandRef]) {
      const stale = x.review(ref);
      await x.verify(stale);
      assert.equal(stale.status, "blocked");
    }
  } finally {
    await x.cleanup();
  }
});

test("file and artifact viewers use immutable bytes after restart, including deleted files; schema6 history stays unverified", async () => {
  const x = await setup();
  try {
    const r = x.review();
    await x.verify(r);
    x.run.review = r;
    x.store.updateRun(x.run);
    const old = {
      ...x.run,
      id: randomUUID(),
      review: {
        status: "completed",
        summary: "old",
        fixes: [],
        limitations: [],
        acceptance: [
          { criterion: "Old AC", status: "passed", evidence: "old report" },
        ],
      },
    } as Run;
    x.store.createRun(old);
    await writeFile(join(x.root, "src", "a.ts"), "after run");
    const reopened = new Store(join(x.directory, "data"));
    try {
      assert.equal("version" in reopened.run(old.id).review!, false);
      const run = reopened.run(x.run.id);
      assert.match(
        readEvidence(run, x.fileRef, reopened.evidence),
        /export const a = 1/,
      );
      assert.equal(
        readEvidence(run, x.commandRef, reopened.evidence),
        "1 test passed",
      );
      assert.throws(
        () =>
          readEvidence(
            run,
            { ...x.fileRef, sessionId: "wrong" },
            reopened.evidence,
          ),
        /session/,
      );
      const artifact = { ...x.fileRef, kind: "artifact" } as EvidenceRef;
      assert.match(
        readEvidence(run, artifact, reopened.evidence),
        /export const a/,
      );
    } finally {
      reopened.close();
    }
    x.task.evidence!.files["src/deleted.ts"] = null;
    const deletion = {
      ...x.fileRef,
      path: "src/deleted.ts",
      hash: null,
    } as EvidenceRef;
    assert.match(readEvidence(x.run, deletion, x.store.evidence), /xóa/);
  } finally {
    await x.cleanup();
  }
});

test("controller keeps colliding call IDs separate across tasks/sessions, rejects late source attribution and changed source", async () => {
  const x = await setup();
  try {
    const controller = new RunController(x.store, x.directory, () => undefined);
    const active = {
      run: x.run,
      secrets: [],
      seen: new Set<string>(),
      sourceObservation: {
        version: sourceVersion(await snapshot(x.root))!,
        at: Date.now(),
      },
    };
    const invoke = controller as unknown as {
      onEvent(
        active: unknown,
        event: Event,
        reconciled?: boolean,
      ): Promise<void>;
    };
    x.run.commands = [];
    const start = Date.now() + 1000;
    const event = (session: string): Event =>
      ({
        type: "message.part.updated",
        properties: {
          part: {
            type: "tool",
            id: "part1",
            sessionID: session,
            callID: "shared",
            tool: "bash",
            state: {
              status: "completed",
              input: { command: "npm test" },
              output: session,
              time: { start, end: start + 10 },
              metadata: { exit: 0 },
            },
          },
        },
      }) as unknown as Event;
    x.run.currentTaskId = "t1";
    await invoke.onEvent(active, event("session1"));
    x.run.currentTaskId = "t1-fix-1";
    await invoke.onEvent(active, event("session2"));
    assert.equal(x.run.commands.length, 2);
    assert.notEqual(x.run.commands[0].artifactId, x.run.commands[1].artifactId);
    assert.equal(
      x.store.evidence.command(x.run.id, x.run.commands[0].artifactId!),
      "session1",
    );
    assert.equal(
      x.store.evidence.command(x.run.id, x.run.commands[1].artifactId!),
      "session2",
    );
    assert.ok(x.run.commands[0].sourceVersion);
    x.run.currentTaskId = "t2";
    await invoke.onEvent(active, event("session3"), true);
    assert.equal(x.run.commands[2].sourceVersion, undefined);
    await utimes(
      join(x.root, "src", "a.ts"),
      new Date(start + 2000),
      new Date(start + 2000),
    );
    await invoke.onEvent(active, event("session4"));
    assert.equal(x.run.commands[3].sourceVersion, undefined);
    await unlink(join(x.root, "src", "a.ts"));
    await invoke.onEvent(active, event("session5"));
    assert.equal(
      x.run.commands[4].sourceVersion,
      undefined,
      "deleting a file after the pre-command observation cannot be attributed to the tested source",
    );
  } finally {
    await x.cleanup();
  }
});

test("coordinator persists and blocks a completed model claim without evidence, with no formatting retry", async () => {
  const x = await setup();
  try {
    x.run.tasks = [];
    x.run.commands = [];
    let calls = 0;
    await assert.rejects(
      coordinate(
        x.run,
        async (task) => {
          calls++;
          task.sessionId = `session-${task.id}`;
          if (task.kind === "plan")
            return JSON.stringify({
              blockedReason: null,
              testingReason: "Docs only",
              tasks: [
                {
                  id: "t1",
                  role: "be",
                  title: "Docs",
                  instructions: "Read",
                  allowedPaths: ["src"],
                  acceptance: ["Documented"],
                  dependsOn: [],
                },
              ],
            });
          if (task.kind === "review")
            return JSON.stringify({
              version: 2,
              status: "completed",
              summary: "Done",
              fixes: [],
              limitations: [],
              acceptance: [
                {
                  criterionId: "t1:ac1",
                  criterion: "Documented",
                  status: "passed",
                  evidence: "Model says so",
                  method: "source",
                  refs: [],
                },
              ],
            });
          return "Done";
        },
        () => {},
        () => {},
        x.store.evidence,
      ),
      TeamBlocked,
    );
    assert.equal(calls, 3);
    assert.equal(x.run.review?.status, "blocked");
    assert.equal(x.run.review?.acceptance[0].status, "unverified");
  } finally {
    await x.cleanup();
  }
});

test("result UI renders scoped file/command evidence actions and identifies unverified legacy history", async () => {
  const x = await setup();
  try {
    const r = x.review();
    r.acceptance[1].refs = [x.commandRef];
    x.run.review = r;
    const render = () =>
      renderToStaticMarkup(
        createElement(RunPanel, {
          detail: { run: x.run, events: [] },
          tab: "result",
          onPermission: () => {},
          busy: false,
        }),
      );
    const html = render();
    assert.match(html, /<button[^>]*>src\/a.ts<\/button>/);
    assert.match(html, /Lệnh · t1/);
    assert.doesNotMatch(html, /báo cáo cũ/);
    x.run.review = {
      status: "completed",
      summary: "old",
      fixes: [],
      limitations: [],
      acceptance: [
        { criterion: "Old AC", status: "passed", evidence: "old report" },
      ],
    };
    const legacy = render();
    assert.match(legacy, /bằng chứng chưa được xác minh/);
    assert.match(legacy, /Đạt · báo cáo cũ/);
  } finally {
    await x.cleanup();
  }
});
