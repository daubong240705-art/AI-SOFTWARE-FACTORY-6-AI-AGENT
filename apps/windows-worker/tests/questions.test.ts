import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Store } from "../electron/storage/database";
import { RunController } from "../electron/controller/runs";
import { coordinate, TeamBlocked } from "../electron/team/coordinator";
import { loadProfiles } from "../electron/team/profiles";
import { loadSkillCatalog } from "../electron/team/skills";
import { failure } from "../electron/runtime/failure";
import { defaultSettings } from "../shared/defaults";
import { normalizeRun, type Run } from "../shared/runs";
import { leadDecisionSchema } from "../shared/team";
import {
  questionDecisionSchema,
  type QuestionDecision,
  type QuestionSet,
} from "../shared/questions";
import { attentionItems } from "../shared/overview";

const decision: QuestionDecision = {
  version: 1,
  kind: "questions",
  summary: "Chọn phạm vi trước khi làm",
  questions: [
    {
      id: "q1",
      title: "Phạm vi nào?",
      required: true,
      options: [
        {
          id: "o1",
          label: "Nhỏ",
          description: "Chức năng chính",
          recommended: true,
        },
        {
          id: "o2",
          label: "Đầy đủ",
          description: "Thêm báo cáo",
          recommended: false,
        },
      ],
    },
    { id: "q2", title: "Ghi chú thêm?", required: false, options: [] },
  ],
};
function fixture(
  projectId: string,
  conversationId: string,
  workspace: string,
  patch: Partial<Run> = {},
): Run {
  const settings = defaultSettings();
  settings.gatewayUrl = "https://unused.example/v1";
  settings.agents.forEach((agent) => (agent.model = "fixture"));
  return normalizeRun({
    id: crypto.randomUUID(),
    projectId,
    conversationId,
    workspace,
    projectName: "Questions",
    prompt: "Thực hiện tính năng mới",
    role: "lead",
    model: "fixture",
    mode: "team",
    state: "running",
    settings,
    createdAt: new Date().toISOString(),
    startedAt: null,
    endedAt: null,
    sessionId: null,
    summary: "",
    error: "",
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
    profiles: loadProfiles(),
    currentTaskId: null,
    fixRound: 0,
    review: null,
    skillCatalog: loadSkillCatalog(),
    ...patch,
  } as Run);
}
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "asf-questions-"));
  const source = join(directory, "source");
  mkdirSync(source);
  const store = new Store(join(directory, "data"));
  const project = store.addProject(source),
    conversation = store.conversations.create(project.id);
  const run = fixture(project.id, conversation.id, source);
  store.save(run.settings, undefined);
  store.createRun(run);
  return { directory, source, store, project, conversation, run };
}
function publish(store: Store, run: Run) {
  run.questionRequest = decision;
  run.summary = decision.summary;
  run.state = "needs_input";
  run.failure = failure("needs-context", decision.summary);
  run.endedAt = new Date().toISOString();
  store.updateRun(run);
  return store.questions
    .list(run.conversationId!)
    .find((set) => set.sourceRunId === run.id)!;
}
function request(set: QuestionSet) {
  return {
    projectId: set.projectId,
    conversationId: set.conversationId,
    setId: set.id,
    version: set.recordVersion,
    answers: [
      { questionId: "q1", optionId: null, text: "Phạm vi do tôi mô tả" },
    ],
  };
}

test("versioned Lead questions preserve legacy decisions, reject malformed options and never schedule work", async () => {
  assert.equal(leadDecisionSchema.safeParse({ reply: "Chào" }).success, true);
  assert.equal(
    leadDecisionSchema.safeParse({
      blockedReason: "Missing",
      testingReason: "",
      tasks: [],
    }).success,
    true,
  );
  assert.equal(
    leadDecisionSchema.safeParse({ ...decision, tasks: [] }).success,
    false,
  );
  assert.equal(
    questionDecisionSchema.safeParse({
      ...decision,
      questions: [decision.questions[0], decision.questions[0]],
    }).success,
    false,
  );
  assert.equal(
    questionDecisionSchema.safeParse({
      ...decision,
      questions: [
        {
          ...decision.questions[0],
          options: [
            decision.questions[0].options[0],
            decision.questions[0].options[0],
          ],
        },
      ],
    }).success,
    false,
  );
  const { directory, store, run } = setup();
  try {
    let calls = 0;
    await assert.rejects(
      coordinate(
        run,
        async (_task, prompt) => {
          calls++;
          assert.match(prompt, /Protocol câu hỏi nghiệp vụ v1/);
          return JSON.stringify(decision);
        },
        () => {},
        () => {},
      ),
      TeamBlocked,
    );
    assert.equal(calls, 1);
    assert.ok(run.tasks.every((task) => task.kind === "plan"));
    assert.deepEqual(run.questionRequest, decision);
    assert.equal(
      store.questions.list(run.conversationId!).length,
      0,
      "Not published until terminal commit",
    );
    const set = publish(store, run);
    store.updateRun(run);
    assert.equal(store.questions.list(run.conversationId!).length, 1);
    assert.equal(set.state, "pending");
    assert.deepEqual(set.answers, []);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("draft versions and free text survive restart; required answers and scoped identities are enforced", () => {
  const s = setup();
  let store = s.store;
  try {
    const set = publish(store, s.run),
      input = request(set);
    assert.throws(
      () => store.questions.get({ ...input, projectId: crypto.randomUUID() }),
      /không thuộc/,
    );
    assert.throws(
      () =>
        store.questions.submit({ ...input, answers: [] }, () => {
          throw Error("must not launch");
        }),
      /Cần trả lời/,
    );
    assert.throws(
      () =>
        store.questions.draft({
          ...input,
          answers: [{ questionId: "q1", optionId: "o4", text: "" }],
        }),
      /không thuộc/,
    );
    const saved = store.questions.draft(input);
    assert.equal(saved.recordVersion, 2);
    assert.throws(() => store.questions.draft(input), /đã thay đổi/);
    store.close();
    store = new Store(join(s.directory, "data"));
    assert.equal(
      store.questions.get(input).answers[0].text,
      input.answers[0].text,
    );
    assert.equal(store.questions.get(input).state, "pending");
    assert.ok(!store.retention(1, 0).runIds.includes(s.run.id));
    assert.throws(() => store.removeProject(s.project.id), /lịch sử câu hỏi/);
  } finally {
    store.close();
    rmSync(s.directory, { recursive: true, force: true });
  }
});

test("answer plus immediate run is atomic, retries survive restart and cannot resurrect removed queued continuation", async () => {
  const s = setup();
  let store = s.store;
  const db = new Database(join(s.directory, "data", "worker.sqlite"));
  let controller = new RunController(
    store,
    join(s.directory, "data"),
    () => undefined,
  );
  try {
    const set = publish(store, s.run),
      input = request(set);
    db.exec(
      "CREATE TRIGGER fail_answer BEFORE UPDATE ON question_sets WHEN NEW.state='answered' BEGIN SELECT RAISE(ABORT,'synthetic answer failure'); END;",
    );
    assert.throws(() => controller.answerQuestions(input), /synthetic answer/);
    assert.equal(controller.view().activeId, null);
    assert.equal(store.runs().length, 1);
    assert.equal(store.questions.get(input).state, "pending");
    await Promise.resolve();
    assert.equal(controller.view().activeId, null);
    db.exec("DROP TRIGGER fail_answer");
    store.queue.add({
      projectId: s.project.id,
      conversationId: s.conversation.id,
      prompt: "Held",
      role: "lead",
      mode: "team",
      settings: s.run.settings,
      afterRunId: null,
      state: "held",
      reason: "Manual",
    });
    const first = controller.answerQuestions(input);
    assert.equal(first.state, "answered");
    assert.ok(first.receipt?.followUpId);
    assert.deepEqual(controller.answerQuestions(input), first);
    assert.equal(store.queue.list().length, 2);
    assert.throws(
      () =>
        controller.answerQuestions({
          ...input,
          answers: [{ questionId: "q1", optionId: "o1", text: "Changed" }],
        }),
      /câu trả lời khác/,
    );
    const queue = store.queue.get(first.receipt!.followUpId!);
    assert.match(queue.prompt, /Phạm vi do tôi mô tả/);
    assert.doesNotMatch(queue.prompt, /Trả lời: Nhỏ/);
    assert.equal(queue.immutable, true);
    store.close();
    store = new Store(join(s.directory, "data"));
    controller = new RunController(
      store,
      join(s.directory, "data"),
      () => undefined,
    );
    assert.equal(
      controller.answerQuestions(input).receipt?.followUpId,
      queue.id,
    );
    store.queue.remove(queue.id);
    assert.equal(controller.answerQuestions(input).receipt?.state, "removed");
    assert.equal(store.queue.list().length, 1);
  } finally {
    db.close();
    store.close();
    rmSync(s.directory, { recursive: true, force: true });
  }
});

test("work revision invalidates old questions; answered queued snapshots retain original revision and claim once", () => {
  const s = setup();
  try {
    s.run.state = "completed";
    s.store.updateRun(s.run);
    const item = s.store.board.create({
      projectId: s.project.id,
      title: "Work",
      body: "Requirement",
      criteria: ["AC"],
      priority: 0,
      suggestedRole: null,
      planningState: "ready",
    });
    const context = s.store.board.workChat({
      projectId: s.project.id,
      itemId: item.id,
    });
    const run = fixture(s.project.id, context.conversationId, s.source);
    s.store.createRun(run);
    const latestItem = s.store.board.item(item.id);
    // Standard Board submit uses a historical submission reference, without run.workContext.
    s.store.board.attachChat(
      crypto.randomUUID(),
      s.store.board.chatSnapshot(
        s.project.id,
        item.id,
        1,
        context.conversationId,
      ),
      { runId: run.id, followUpId: null },
    );
    const set = publish(s.store, run);
    assert.equal(set.workItemId, item.id);
    assert.equal(set.revision, 1);
    s.store.board.update({
      id: item.id,
      version: s.store.board.item(item.id).version,
      patch: { body: "Revision two" },
    });
    assert.equal(s.store.questions.get(request(set)).state, "superseded");
    assert.throws(
      () =>
        new RunController(
          s.store,
          s.directory,
          () => undefined,
        ).answerQuestions(request(set)),
      /thay thế/,
    );
    const run2 = fixture(s.project.id, context.conversationId, s.source, {
      workContext: s.store.board.chatSnapshot(
        s.project.id,
        item.id,
        2,
        context.conversationId,
      ),
    });
    s.store.createRun(run2);
    const next = publish(s.store, run2);
    s.store.queue.add({
      projectId: s.project.id,
      conversationId: context.conversationId,
      prompt: "Held",
      role: "lead",
      mode: "team",
      settings: run.settings,
      afterRunId: null,
      state: "held",
      reason: "Manual",
    });
    const controller = new RunController(s.store, s.directory, () => undefined),
      accepted = controller.answerQuestions(request(next));
    s.store.board.update({
      id: item.id,
      version: s.store.board.item(item.id).version,
      patch: { body: "Revision three" },
    });
    const queued = s.store.queue.get(accepted.receipt!.followUpId!);
    assert.equal(queued.workContext?.revision, 2);
    const child = s.store.queue.claim(queued.id, (q) => {
      const r = fixture(s.project.id, context.conversationId, s.source, {
        workContext: q.workContext,
      });
      s.store.createRun(r);
      return { id: r.id, value: r };
    });
    assert.equal(
      controller.answerQuestions(request(next)).receipt?.runId,
      child.id,
    );
    assert.equal(
      s.store.board.contextForRun(s.project.id, child.id)?.itemId,
      item.id,
    );
    assert.equal(latestItem.revision, 1);
  } finally {
    s.store.close();
    rmSync(s.directory, { recursive: true, force: true });
  }
});

test("new user run supersedes pending set; inbox resolves answered questions without stale needs_input", () => {
  const s = setup();
  try {
    const set = publish(s.store, s.run),
      controller = new RunController(s.store, s.directory, () => undefined);
    const before = controller.monitor({
      projectId: s.project.id,
      overview: true,
    });
    assert.equal(before.unchanged, false);
    if (before.unchanged) throw Error("snapshot expected");
    const items = attentionItems(before.snapshot.overview!);
    assert.equal(items.length, 1);
    assert.equal(items[0].label, "Cần trả lời");
    const next = fixture(s.project.id, s.conversation.id, s.source, {
      state: "completed",
    });
    s.store.createRun(next);
    assert.equal(s.store.questions.get(request(set)).state, "superseded");
    const after = controller.monitor({
      projectId: s.project.id,
      overview: true,
    });
    if (after.unchanged) throw Error("snapshot expected");
    assert.equal(attentionItems(after.snapshot.overview!).length, 0);
  } finally {
    s.store.close();
    rmSync(s.directory, { recursive: true, force: true });
  }
});

test("schema9 migration backs up populated history and credentials without replay", () => {
  const s = setup();
  s.store.save(s.run.settings, Buffer.from([3, 5, 8, 13]));
  s.store.conversations.draft(s.conversation.id, "Nháp tiếng Việt");
  s.run.state = "completed";
  s.store.updateRun(s.run);
  s.store.close();
  let store: Store | undefined;
  try {
    const db = new Database(join(s.directory, "data", "worker.sqlite"));
    db.exec(
      "DROP TABLE schedule_deliveries; DROP TABLE schedules; DROP TABLE schedule_control; DROP TABLE chat_images; DROP TABLE inbox_seen; DROP TABLE report_decisions; DROP TABLE report_policies; DROP TABLE reports; DROP TABLE question_sets;PRAGMA user_version=9",
    );
    db.close();
    store = new Store(join(s.directory, "data"));
    assert.equal(
      store.conversations.get(s.conversation.id).conversation.draft,
      "Nháp tiếng Việt",
    );
    assert.equal(store.run(s.run.id).state, "completed");
    assert.deepEqual(store.encryptedKey(), Buffer.from([3, 5, 8, 13]));
    const backup = new Database(
      join(s.directory, "data", "worker.schema9.pre-questions.backup.sqlite"),
      { readonly: true },
    );
    assert.equal(backup.pragma("user_version", { simple: true }), 9);
    backup.close();
    assert.equal(store.questions.list(s.conversation.id).length, 0);
  } finally {
    store?.close();
    rmSync(s.directory, { recursive: true, force: true });
  }
});

test("idle answer creates one distinct continuation and permits stop before model admission", async () => {
  const s = setup(),
    controller = new RunController(
      s.store,
      join(s.directory, "data"),
      () => undefined,
    );
  try {
    const set = publish(s.store, s.run),
      accepted = controller.answerQuestions(request(set));
    assert.equal(accepted.state, "answered");
    assert.ok(accepted.receipt?.runId);
    assert.notEqual(accepted.receipt.runId, s.run.id);
    assert.equal(s.store.run(s.run.id).state, "needs_input");
    assert.equal(
      controller.answerQuestions(request(set)).receipt?.runId,
      accepted.receipt.runId,
    );
    await controller.stop(accepted.receipt.runId);
    assert.equal(s.store.run(accepted.receipt.runId).state, "cancelled");
    assert.equal(s.store.run(accepted.receipt.runId).requests, 0);
    assert.ok(!s.store.retention(0, 0).runIds.includes(accepted.receipt.runId));
  } finally {
    await controller.shutdown();
    s.store.close();
    rmSync(s.directory, { recursive: true, force: true });
  }
});

test("older question provenance survives bounded chat pages and late references invalidate prune previews", () => {
  const s = setup();
  try {
    s.run.state = "completed";
    s.run.createdAt = "2020-01-01T00:00:00.000Z";
    s.store.updateRun(s.run);
    const preview = s.store.retention(1, 0);
    assert.ok(preview.runIds.includes(s.run.id));
    const first = publish(s.store, s.run);
    assert.throws(() => s.store.prune(preview.token), /câu hỏi mới/);
    for (let i = 0; i < 21; i++) {
      const run = fixture(s.project.id, s.conversation.id, s.source);
      s.store.createRun(run);
      publish(s.store, run);
    }
    assert.equal(s.store.questions.list(s.conversation.id).length, 20);
    assert.ok(
      !s.store.questions
        .list(s.conversation.id)
        .some((set) => set.id === first.id),
    );
    const exported = JSON.parse(s.store.report(s.run.id));
    assert.equal(exported.questionSets[0].id, first.id);
    assert.equal(exported.questionSets[0].state, "superseded");
  } finally {
    s.store.close();
    rmSync(s.directory, { recursive: true, force: true });
  }
});
