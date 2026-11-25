import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { createContentStore } from "../src/artifacts/content-store.js";
import { DEFAULT_DOCUMENT_CONFIG } from "../src/artifacts/limits.js";
import { chatSendHandler, conversationsCreateHandler, listMessages } from "../src/chat/service.js";
import { createCommandPipeline } from "../src/commands/pipeline.js";
import { createFlowHandlers } from "../src/flow/commands.js";
import { getRun } from "../src/flow/store.js";
import { createKnowledgeIndex } from "../src/knowledge/index.js";
import { LeadEventHub, LeadTraceRecorder } from "../src/lead/causation.js";
import { createLeadRunner } from "../src/lead/runner.js";
import { setLeadChatMode } from "../src/lead/settings.js";
import type { ModelRequest } from "../src/models/gateway.js";
import { loadPack } from "../src/org/pack.js";
import { registryEntry } from "../src/org/registry.js";
import { createProjectsCreateHandler } from "../src/projects/service.js";
import { spanId } from "../src/trace/recorder.js";
import { listTasks } from "../src/work/service.js";
import { fixedClock, idFactory, migratedStorage } from "./helpers.js";

const block = (name: string, value: unknown) => `\`\`\`factory-${name}\n${JSON.stringify(value)}\n\`\`\``;
const brief = (title = "Phương án mẫu") => block("brief", { title, goals: ["Giữ phạm vi hẹp"], scope: [], outOfScope: [],
  decisions: [{ decision: "Chọn phương án hai", reason: "Ít phụ thuộc hơn" }], acceptance: [], openQuestions: [] });
const run = (flowKey: string, quote = "chốt", inputs = {}) => `${brief()}\n${block("run", { flowKey, inputs, decision: { quote } })}`;
const task = (title: string) => ({ title, goal: "Hoàn thành thay đổi", acceptance: ["Kiểm tra thay đổi"], requiredCapabilities: ["test.unit"] });

function fixture(context: TestContext, maxHistoryMessages = 20) {
  const storage = migratedStorage(); const { raw } = storage;
  const clock = fixedClock(), newId = idFactory(), projectId = newId(), conversationId = newId();
  const warnings: string[] = [];
  const trace = new LeadTraceRecorder(raw, clock, message => warnings.push(message));
  const hub = new LeadEventHub(raw, trace, { clock, newId });
  const pack = loadPack(fileURLToPath(new URL("../../../../packs/software-team", import.meta.url)));
  const dir = mkdtempSync(fileURLToPath(new URL("../lead-", import.meta.url)));
  const store = createContentStore({ dir });
  const knowledge = createKnowledgeIndex({ raw, store });
  const pipeline = createCommandPipeline({ storage, hub, clock, newId, handlers: {
    ...createFlowHandlers({ engine: { raw, hub, clock, newId }, packs: [registryEntry(pack)] }),
    "projects.create": createProjectsCreateHandler({ pack }), "projects.set-lead-chat-mode": setLeadChatMode,
    "conversations.create": conversationsCreateHandler, "chat.send": chatSendHandler,
  } });
  function execute(type: string, payload: unknown) {
    const commandId = newId();
    const result = pipeline.execute({ apiVersion: 1, commandId, projectId, type, payload });
    assert.ok(result.body.ok, JSON.stringify(result.body));
    return commandId;
  }
  execute("projects.create", { name: "Lead test", workspace: { kind: "directory", root: "/projects/lead-test" } });
  const { id: agentId } = raw.prepare("SELECT s.id FROM engagements e JOIN seats s ON s.team_id=e.team_id WHERE e.project_id=? AND s.is_lead=1")
    .get(projectId) as { id: string };
  execute("conversations.create", { conversationId, agentId, title: "Lead", workItemId: null });
  const script: string[] = [], requests: ModelRequest[] = [];
  const runner = createLeadRunner({ storage, hub, clock, newId, profileText: "Lead",
    config: { maxHistoryMessages }, execute: pipeline.execute,
    documents: { store, config: DEFAULT_DOCUMENT_CONFIG, afterRegister: ref => { knowledge.indexVersion(ref.projectId, ref.artifactId, ref.version); } },
    gateway: { providerId: "scripted", async complete(request) {
      requests.push(request);
      const text = script.shift();
      assert.notEqual(text, undefined, "unexpected model call");
      return { model: request.model, provider: "scripted", text: text!, finishReason: "stop", usage: null };
    } },
  });
  context.after(async () => { await runner.stop(); storage.close(); rmSync(dir, { recursive: true, force: true }); });
  function queue(text: string, intent?: "discuss" | "delegate") {
    const messageId = newId();
    const commandId = execute("chat.send", { conversationId, messageId, expectedRevision: 1, text, attachmentIds: [], context: [], draftRevision: null,
      ...(intent ? { intent } : {}) });
    return { messageId, commandId };
  }
  const answer = () => listMessages(raw, projectId, conversationId).messages.findLast(message => message.speaker === "agent")!;
  async function send(text: string, output: string, intent?: "discuss" | "delegate") {
    script.push(output); const identity = queue(text, intent);
    runner.kick(); await runner.idle();
    assert.equal(script.length, 0);
    const row = raw.prepare("SELECT state FROM lead_turns WHERE id=?").get(identity.messageId);
    assert.deepEqual(row, { state: "done" });
    return { ...identity, answer: answer() };
  }
  function flow(key = "review-flow", publish = true) {
    const flowId = newId();
    const edge = (from: string, to: string) => ({ id: `${from}-${to}`, from: { node: from, port: "out" }, to: { node: to } });
    execute("flows.create", { flowId, definition: { schema: 2, key, title: "Quy trình mẫu", description: "Chờ rồi ghi kết quả",
      inputs: [{ name: "brief", type: "string", required: true }, { name: "briefArtifactId", type: "artifact", required: true }],
      nodes: [{ id: "start", title: "Start", type: "trigger", trigger: { kind: "manual" } },
        { id: "wait", title: "Wait", type: "wait", wait: { for: 2 } },
        { id: "done", title: "Done", type: "output", target: "artifact", from: ["nodes.wait.output"] }],
      edges: [edge("start", "wait"), edge("wait", "done")] } });
    if (publish) execute("flows.publish", { flowId, expectedRevision: 1 });
    return flowId;
  }
  const count = (table: "flow_runs" | "artifact_versions" | "tasks") => (raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  return { raw, hub, warnings, runner, answer, requests, script, queue, send, projectId, execute, flow, count, knowledge };
}

test("auto discussion writes no work or files, including a proposed CSV", async context => {
  const fx = fixture(context);
  const { answer } = await fx.send("So sánh hai phương án?", "Phương án hai ít phụ thuộc hơn.\n```factory-csv\n# file: plan.csv\nexample\n```");
  assert.match(answer.text, /hai ít phụ thuộc/);
  assert.equal(answer.leadCards, undefined);
  for (const table of ["flow_runs", "artifact_versions", "tasks"] as const) assert.equal(fx.count(table), 0);
});

test("confirmed auto run stores brief, receipt, events and trace; newer decision cancels", async context => {
  const fx = fixture(context);
  const flowId = fx.flow();
  const cursor = fx.hub.currentCursor(fx.projectId)!;
  const started = await fx.send("  CHỐT\n   phương án hai ", run("review-flow", "chốt phương án hai"));
  const briefCard = started.answer.leadCards?.find(card => card.kind === "brief");
  const runCard = started.answer.leadCards?.find(card => card.kind === "run");
  assert.ok(briefCard && runCard);
  const stored = getRun(fx.raw, fx.projectId, runCard.runId)!;
  assert.equal(stored.flow_id, flowId); assert.equal(stored.version, 1); assert.equal(stored.state, "waiting");
  const inputs = JSON.parse(stored.inputs_json);
  assert.equal(inputs.briefArtifactId, briefCard.artifactId);
  assert.match(inputs.brief, /## Quyết định và lý do/);
  assert.match(fx.requests[0]?.system ?? "", /review-flow.*briefArtifactId/);
  const found = fx.hub.readAfter(fx.projectId, cursor);
  assert.equal(found.kind, "events");
  const receipt = found.events.find(event => event.payload.type === "command.receipted" && event.payload.receipt.effects.some(effect => effect.id === runCard.runId));
  assert.ok(receipt?.payload.type === "command.receipted");
  assert.equal(receipt.causationId, started.messageId);
  assert.deepEqual(fx.raw.prepare("SELECT state FROM command_receipts WHERE command_id=?").get(receipt.payload.receipt.commandId), { state: "completed" });
  for (const id of [runCard.runId, briefCard.artifactId]) assert.ok(found.events.some(event => event.causationId === started.messageId
    && event.payload.type === "entity.changed" && event.payload.entity.id === id));
  const parent = (span: string) => fx.raw.prepare("SELECT parent_id FROM trace_spans WHERE project_id=? AND id=?").get(fx.projectId, span);
  const artifactSpan = spanId("artifact", `${briefCard.artifactId}:1`);
  assert.deepEqual(parent(artifactSpan), { parent_id: started.commandId });
  assert.deepEqual(parent(spanId("flow-run", runCard.runId)), { parent_id: artifactSpan });
  const cancelled = await fx.send("Huỷ run đó", block("cancel", { runId: runCard.runId, decision: { quote: "Huỷ run đó" } }));
  assert.match(cancelled.answer.text, /Đã dừng/);
  assert.equal(getRun(fx.raw, fx.projectId, runCard.runId)?.state, "cancelled");
  assert.deepEqual(fx.warnings, []);
});

test("a decision quote must be in the latest message; an unpublished workflow cannot start", async context => {
  const fx = fixture(context);
  fx.flow("draft-only", false);
  await fx.send("chốt", "Bạn muốn chọn phương án nào?");
  const refused = await fx.send("So sánh trước nhé", run("draft-only"));
  assert.match(refused.answer.text, /Bạn xác nhận/);
  const badPlan = await fx.send("Chỉ nhận xét thôi", `${brief()}\n${block("plan", { tasks: [task("Kiểm thử")], decision: { quote: "chốt" } })}`);
  assert.match(badPlan.answer.text, /Bạn xác nhận/);
  const unpublished = await fx.send("Chốt", run("draft-only"));
  assert.match(unpublished.answer.text, /không có version đã publish/);
  for (const table of ["flow_runs", "artifact_versions", "tasks"] as const) assert.equal(fx.count(table), 0);
});

test("consecutive queued messages cannot authorize an outdated start; invalid workflow inputs are rejected", async context => {
  const fx = fixture(context);
  fx.flow();
  fx.script.push(run("review-flow"), "Để mình xem lại.");
  const first = fx.queue("chốt");
  fx.queue("Đợi đã, chưa chốt");
  fx.runner.kick(); await fx.runner.idle();
  const refused = fx.raw.prepare(`SELECT json_extract(m.body_json,'$.message.text') AS text FROM lead_turns t
    JOIN messages m ON m.project_id=t.project_id AND m.id=t.reply_message_id WHERE t.id=?`).get(first.messageId) as { text: string };
  assert.match(refused.text, /Bạn xác nhận/);
  assert.equal(fx.count("artifact_versions"), 0);
  const invalid = await fx.send("chốt", run("review-flow", "chốt", { unknownField: true }));
  assert.match(invalid.answer.text, /input không hợp lệ/);
  assert.equal(fx.count("flow_runs"), 0);
});

test("confirmed plans create accepted tasks, version the brief and retain classic behavior", async context => {
  const fx = fixture(context);
  const plan = (title: string, topic?: string) => `${brief(topic)}\n${block("plan", { tasks: [task(title)], decision: { quote: "làm đi" } })}`;
  const first = await fx.send("ok làm đi", plan("Kiểm thử lần một"));
  const second = await fx.send("ok làm đi", plan("Kiểm thử lần hai", "PHƯƠNG ÁN MẪU"));
  const firstBrief = first.answer.leadCards?.find(card => card.kind === "brief");
  const secondBrief = second.answer.leadCards?.find(card => card.kind === "brief");
  assert.ok(firstBrief && secondBrief);
  assert.equal(secondBrief.artifactId, firstBrief.artifactId); assert.equal(secondBrief.version, 2);
  assert.deepEqual(listTasks(fx.raw, fx.projectId).map(value => value.state), ["accepted", "accepted"]);
  assert.equal(fx.count("artifact_versions"), 2);
  const noDecision = await fx.send("Có thể chia việc thế nào?", block("plan", { tasks: [task("Đề xuất thêm")] }));
  assert.equal(noDecision.answer.leadCards, undefined);
  fx.execute("projects.set-lead-chat-mode", { expectedRevision: 1, leadChatMode: "classic" });
  await fx.send("ok làm đi", plan("Không tạo trong chế độ hỏi"));
  await fx.send("Làm việc này", block("plan", { tasks: [task("Đề xuất cổ điển")] }), "delegate");
  assert.deepEqual(listTasks(fx.raw, fx.projectId).map(value => value.state), ["accepted", "accepted", "proposed", "proposed"]);
  assert.equal(fx.count("artifact_versions"), 2);
});

test("history summarizes older messages incrementally, never using summary as authorization", async context => {
  const fx = fixture(context, 2);
  await fx.send("Phạm vi đầu tiên. password=synthetic-marker", "Đã hiểu.");
  fx.script.push("Phạm vi đầu tiên được giữ. password=another-synthetic-marker");
  await fx.send("So sánh tiếp", "Phương án hai nhanh hơn.");
  fx.script.push("Phạm vi đầu tiên và phương án hai.");
  await fx.send("Chưa quyết định", run("review-flow", "Phạm vi đầu tiên"));
  const summarizations = fx.requests.filter(request => request.system.startsWith("Summarize"));
  assert.equal(summarizations.length, 2);
  assert.match(summarizations[0]?.messages[0]?.content ?? "", /Phạm vi đầu tiên/);
  assert.doesNotMatch(summarizations[0]?.messages[0]?.content ?? "", /synthetic-marker/);
  assert.match(summarizations[1]?.messages[0]?.content ?? "", /previousSummary.*Phạm vi đầu tiên/);
  assert.doesNotMatch(summarizations[1]?.messages[0]?.content ?? "", /another-synthetic-marker/);
  assert.match(fx.requests.at(-1)?.system ?? "", /Older discussion summary.*\n.*Phạm vi đầu tiên/);
  assert.equal(fx.count("artifact_versions"), 0);
});
