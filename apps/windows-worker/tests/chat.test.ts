import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Store } from "../electron/storage/database";
import { RunController } from "../electron/controller/runs";
import { defaultSettings } from "../shared/defaults";
import type { Run } from "../shared/runs";
import { withWorkContext } from "../shared/work-context";
import type { ChatSend } from "../shared/chat";

function runFor(
  projectId: string,
  workspace: string,
  extra: Partial<Run> = {},
): Run {
  return {
    id: crypto.randomUUID(),
    projectId,
    projectName: "Chat",
    workspace,
    prompt: "Yêu cầu có dấu",
    role: "be",
    model: "model-be",
    mode: "direct",
    state: "completed",
    createdAt: "2026-11-04T01:00:00.000Z",
    startedAt: null,
    endedAt: "2026-11-04T01:01:00.000Z",
    sessionId: null,
    summary: "Kết quả **đạt**",
    error: "",
    settings: defaultSettings(),
    changes: [],
    commands: [],
    permissions: [],
    requests: 0,
    baselineComplete: true,
    toolsCompleted: 0,
    runtimeVersion: "",
    inputTokens: 0,
    outputTokens: 0,
    tasks: [],
    profiles: [],
    currentTaskId: null,
    fixRound: 0,
    review: null,
    ...extra,
  };
}
test("contextual chat validates revision/project, snapshots queue data, deduplicates across restart and links one work item", () => {
  const directory = mkdtempSync(join(tmpdir(), "asf-chat-context-"));
  let store = new Store(directory);
  let controller: RunController | undefined;
  try {
    const project = store.addProject(directory),
      settings = defaultSettings();
    settings.gatewayUrl = "https://unused.example/v1";
    settings.agents.forEach((a) => (a.model = "fixture"));
    store.save(settings, undefined);
    const item = store.board.create({
      projectId: project.id,
      title: "Work",
      body: "Original requirement",
      criteria: ["Acceptance"],
      priority: 0,
      suggestedRole: null,
      planningState: "backlog",
    });
    const context = store.board.workChat({
      projectId: project.id,
      itemId: item.id,
    });
    assert.equal(
      store.board.workChat({ projectId: project.id, itemId: item.id })
        .conversationId,
      context.conversationId,
    );
    store.queue.add({
      projectId: project.id,
      conversationId: context.conversationId,
      prompt: "Held",
      role: "lead",
      mode: "team",
      settings,
      afterRunId: null,
      state: "held",
      reason: "Manual",
    });
    controller = new RunController(store, directory, () => undefined);
    const request: ChatSend = {
      requestId: crypto.randomUUID(),
      projectId: project.id,
      conversationId: context.conversationId,
      prompt: "Thảo luận tiêu chí này",
      mode: "team",
      role: "lead",
      workContext: { itemId: item.id, revision: 1 },
    };
    const first = controller.sendChat(request);
    assert.equal(first.state, "queued");
    assert.deepEqual(controller.sendChat(request), first);
    assert.equal(
      store.board.detail({ projectId: project.id, itemId: item.id }).submissions
        .length,
      1,
    );
    assert.equal(store.queue.list().length, 2);
    assert.throws(
      () => controller!.sendChat({ ...request, prompt: "Changed" }),
      /nội dung khác/,
    );
    const current = store.board.item(item.id);
    store.board.update({
      id: item.id,
      version: current.version,
      patch: { body: "Changed requirement" },
    });
    assert.equal(
      store.queue.get(first.followUpId!).workContext!.body,
      "Original requirement",
    );
    assert.throws(
      () =>
        controller!.sendChat({ ...request, requestId: crypto.randomUUID() }),
      /phiên bản mới/,
    );
    assert.throws(
      () =>
        controller!.sendChat({
          ...request,
          requestId: crypto.randomUUID(),
          projectId: crypto.randomUUID(),
        }),
      /Không tìm thấy/,
    );
    assert.throws(
      () =>
        controller!.sendChat({
          ...request,
          requestId: crypto.randomUUID(),
          conversationId: store.conversations.create(project.id).id,
          workContext: { itemId: item.id, revision: 2 },
        }),
      /không thuộc/,
    );
    store.close();
    store = new Store(directory);
    controller = new RunController(store, directory, () => undefined);
    assert.deepEqual(controller.sendChat(request), first);
    const claimed = store.queue.claim(first.followUpId!, (q) => {
      const run = runFor(project.id, directory, {
        conversationId: q.conversationId,
        prompt: q.prompt,
        workContext: q.workContext,
      });
      store.createRun(run);
      return { id: run.id, value: run };
    });
    assert.equal(controller.sendChat(request).runId, claimed.id);
    assert.equal(
      store.board.contextForRun(project.id, claimed.id)!.itemId,
      item.id,
    );
    assert.equal(
      store.board.detail({ projectId: project.id, itemId: item.id })
        .submissions[0].currentRunId,
      claimed.id,
    );
    assert.ok(!store.retention(1, 0).runIds.includes(claimed.id));
    const snapshot = store.run(claimed.id).workContext!;
    const built = withWorkContext(
      { text: "history".repeat(4000), runIds: [claimed.id] },
      {
        ...snapshot,
        body: "x".repeat(12000),
        criteria: Array.from({ length: 30 }, () => "c".repeat(500)),
        notes: ["N".repeat(6000)],
      },
    );
    assert.ok(built.text.length <= 14000);
    assert.ok(built.text.includes("revision 1"));
    assert.ok(built.text.includes("Acceptance") === false);
    assert.deepEqual(built.runIds, [claimed.id]);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("chat send rollback cannot launch a phantom run; removed queue receipt cannot be resurrected", () => {
  const directory = mkdtempSync(join(tmpdir(), "asf-chat-atomic-"));
  const store = new Store(directory);
  let db: Database.Database | undefined;
  try {
    const project = store.addProject(directory),
      chat = store.conversations.create(project.id),
      settings = defaultSettings();
    settings.gatewayUrl = "https://unused.example/v1";
    settings.agents.forEach((a) => (a.model = "fixture"));
    store.save(settings, undefined);
    const controller = new RunController(store, directory, () => undefined),
      request: ChatSend = {
        requestId: crypto.randomUUID(),
        projectId: project.id,
        conversationId: chat.id,
        prompt: "Hello",
        mode: "team",
        role: "lead",
      };
    db = new Database(join(directory, "worker.sqlite"));
    db.exec(
      "CREATE TRIGGER fail_chat BEFORE INSERT ON chat_requests BEGIN SELECT RAISE(ABORT, 'synthetic chat failure'); END;",
    );
    assert.throws(() => controller.sendChat(request), /synthetic chat failure/);
    assert.equal(controller.view().activeId, null);
    assert.equal(store.runs().length, 0);
    assert.equal(store.conversations.get(chat.id).messages.length, 0);
    db.exec("DROP TRIGGER fail_chat");
    store.queue.add({
      projectId: project.id,
      conversationId: chat.id,
      prompt: "Held",
      role: "lead",
      mode: "team",
      settings,
      afterRunId: null,
      state: "held",
      reason: "Manual",
    });
    const receipt = controller.sendChat(request);
    assert.equal(store.queue.get(receipt.followUpId!).immutable, true);
    assert.throws(
      () => store.queue.edit(receipt.followUpId!, "edit"),
      /Tin nhắn đã lưu/,
    );
    store.queue.remove(receipt.followUpId!);
    assert.equal(controller.sendChat(request).state, "removed");
    assert.equal(store.queue.list().length, 1);
  } finally {
    db?.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("schema8 chat migration backs up existing drafts and work revisions before upgrade", () => {
  const directory = mkdtempSync(join(tmpdir(), "asf-chat-schema8-"));
  let store = new Store(directory);
  try {
    const project = store.addProject(directory),
      chat = store.conversations.create(project.id);
    store.conversations.draft(chat.id, "Nháp giữ nguyên");
    store.close();
    const db = new Database(join(directory, "worker.sqlite"));
    db.exec(
      "DROP TABLE schedule_deliveries; DROP TABLE schedules; DROP TABLE schedule_control; DROP TABLE chat_images; DROP TABLE inbox_seen; DROP TABLE report_decisions; DROP TABLE report_policies; DROP TABLE reports; DROP TABLE question_sets; DROP TABLE chat_requests;PRAGMA user_version=8",
    );
    db.close();
    store = new Store(directory);
    assert.equal(
      store.conversations.get(chat.id).conversation.draft,
      "Nháp giữ nguyên",
    );
    const backup = new Database(
      join(directory, "worker.schema8.pre-chat-host.backup.sqlite"),
      { readonly: true },
    );
    assert.equal(backup.pragma("user_version", { simple: true }), 8);
    backup.close();
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("conversation keeps multi-turn messages and independent drafts after reopen, rename and project removal", () => {
  const directory = mkdtempSync(join(tmpdir(), "asf-chat-store-"));
  let store: Store | undefined;
  try {
    store = new Store(directory);
    const project = store.addProject(directory);
    const first = store.conversations.create(project.id);
    const second = store.conversations.create(project.id);
    store.conversations.draft(first.id, "Nháp thứ nhất");
    store.conversations.draft(second.id, "Nháp thứ hai");
    const run = runFor(project.id, directory, {
      conversationId: first.id,
      prompt: "Nháp thứ nhất",
    });
    store.createRun(run);
    assert.equal(store.conversations.get(first.id).conversation.draft, "");
    const next = runFor(project.id, directory, {
      conversationId: first.id,
      prompt: "Tiếp tục phần vừa làm",
      error: "Thiếu thông tin",
      state: "needs_input",
    });
    store.createRun(next);
    const otherProject = store.addProject(join(directory, "other"));
    const wrong = runFor(otherProject.id, directory, {
      conversationId: first.id,
    });
    assert.throws(() => store!.createRun(wrong), /dự án khác/);
    assert.throws(() => store!.run(wrong.id), /Không tìm thấy/);
    store.conversations.rename(first.id, "Phiên 100%_đúng");
    assert.equal(store.conversations.list({ search: "%_" }).length, 1);
    assert.equal(
      store.conversations.list({ search: "PHIEN 100%_dung" }).length,
      1,
    );
    store.close();
    store = new Store(directory);
    const detail = store.conversations.get(first.id);
    assert.equal(detail.messages.length, 4);
    assert.equal(detail.messages[3].state, "needs_input");
    assert.ok(detail.messages[3].content.includes("Thiếu thông tin"));
    assert.equal(
      store.conversations.get(second.id).conversation.draft,
      "Nháp thứ hai",
    );
    assert.equal(
      store.conversations.context(first.id, project.id).runIds.length,
      2,
    );
    assert.ok(
      store.conversations
        .context(first.id, project.id)
        .text.includes("Tiếp tục"),
    );
    store.removeProject(project.id);
    assert.equal(store.conversations.get(first.id).messages.length, 4);
    assert.equal(
      store.conversations.get(second.id).conversation.draft,
      "Nháp thứ hai",
    );
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("schema3 migration preserves all 65 historical runs, old drafts, timestamps and encrypted settings", () => {
  const directory = mkdtempSync(join(tmpdir(), "asf-chat-migration-"));
  let store: Store | undefined;
  try {
    store = new Store(directory);
    const project = store.addProject(directory);
    store.saveDraft(project.id, "Bản nháp cũ");
    store.save(defaultSettings(), Buffer.from([1, 2, 3]));
    store.close();
    store = undefined;
    const db = new Database(join(directory, "worker.sqlite"));
    db.exec(
      "DROP TABLE schedule_deliveries; DROP TABLE schedules; DROP TABLE schedule_control; DROP TABLE chat_images; DROP TABLE inbox_seen; DROP TABLE report_decisions; DROP TABLE report_policies; DROP TABLE reports; DROP TABLE question_sets; DROP TABLE chat_requests; DROP TABLE work_comments; DROP TABLE work_attempts; DROP TABLE work_submissions; DROP TABLE work_revisions; DROP TABLE work_counters; DROP TABLE board_links; DROP TABLE board_items; DROP TABLE command_artifacts; DROP TABLE file_recoveries; DROP TABLE workspace_evidence; DROP TABLE workspace_blobs; DROP TABLE follow_ups; DROP TABLE messages; DROP TABLE conversations; PRAGMA user_version=3",
    );
    for (let i = 0; i < 65; i++) {
      const run = runFor(project.id, directory, { prompt: `Lượt cũ ${i}` });
      db.prepare("INSERT INTO runs VALUES (?,?,?,?,?)").run(
        run.id,
        project.id,
        run.state,
        run.createdAt,
        JSON.stringify(run),
      );
    }
    db.close();
    store = new Store(directory);
    assert.ok(existsSync(join(directory, "worker.schema3.backup.sqlite")));
    const list = store.conversations.list({ projectId: project.id });
    assert.equal(list.length, 66);
    const old = list.find((c) => c.title === "Lượt cũ 64")!;
    const detail = store.conversations.get(old.id);
    assert.equal(detail.messages.length, 2);
    assert.equal(detail.messages[0].createdAt, "2026-11-04T01:00:00.000Z");
    assert.equal(store.run(detail.messages[0].runId).conversationId, old.id);
    assert.deepEqual(store.encryptedKey(), Buffer.from([1, 2, 3]));
    const draft = list.find((c) => c.title === "Bản nháp đã lưu")!;
    assert.equal(
      store.conversations.get(draft.id).conversation.draft,
      "Bản nháp cũ",
    );
    store.close();
    store = new Store(directory);
    assert.equal(store.conversations.list().length, 66);
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("long conversations page messages without losing order; context stays bounded and isolated", () => {
  const directory = mkdtempSync(join(tmpdir(), "asf-chat-pages-"));
  const store = new Store(directory);
  try {
    const project = store.addProject(directory);
    const conversation = store.conversations.create(project.id);
    for (let i = 0; i < 40; i++)
      store.createRun(
        runFor(project.id, directory, {
          conversationId: conversation.id,
          prompt: `Turn ${i}`,
          summary: "x".repeat(5000),
        }),
      );
    const last = store.conversations.get(conversation.id);
    assert.equal(last.messages.length, 60);
    assert.equal(last.hasEarlier, true);
    const earlier = store.conversations.get(
      conversation.id,
      last.messages[0].sequence,
    );
    assert.equal(earlier.messages.length, 20);
    assert.equal(earlier.hasEarlier, false);
    assert.equal(
      new Set([...earlier.messages, ...last.messages].map((m) => m.id)).size,
      80,
    );
    assert.ok(earlier.messages.at(-1)!.sequence < last.messages[0].sequence);
    const context = store.conversations.context(conversation.id, project.id);
    assert.equal(context.runIds.length, 4);
    assert.ok(context.text.length < 14500);
    assert.ok(context.text.includes("Turn 39"));
    assert.ok(!context.text.includes("Turn 0"));
    assert.throws(
      () => store.conversations.context(conversation.id, "different-project"),
      /dự án khác/,
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("controller attaches cancelled attempt and snapshots previous context without replaying it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "asf-chat-controller-"));
  const store = new Store(directory);
  try {
    const project = store.addProject(directory);
    const chat = store.conversations.create(project.id);
    store.createRun(
      runFor(project.id, directory, {
        conversationId: chat.id,
        summary: "Previous feature complete",
      }),
    );
    const settings = defaultSettings();
    settings.gatewayUrl = "https://unused.example/v1";
    settings.agents.find((a) => a.role === "be")!.model = "model-be";
    store.save(settings, undefined);
    const controller = new RunController(store, directory, () => undefined);
    const run = controller.start(
      project.id,
      "Next change",
      "be",
      "direct",
      chat.id,
    );
    await controller.stop(run.id);
    const result = store.run(run.id);
    assert.ok(result.context?.text.includes("Previous feature complete"));
    assert.equal(result.context?.runIds.length, 1);
    assert.deepEqual(
      result.profiles.map((profile) => profile.role),
      ["be"],
    );
    assert.ok(result.profiles[0].instructions.includes("# BE"));
    assert.equal(result.state, "cancelled");
    const detail = store.conversations.get(chat.id);
    assert.equal(detail.messages.length, 4);
    assert.equal(detail.messages[3].state, "cancelled");
    assert.equal(
      controller.view().runs.find((r) => r.id === run.id)?.conversationId,
      chat.id,
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
