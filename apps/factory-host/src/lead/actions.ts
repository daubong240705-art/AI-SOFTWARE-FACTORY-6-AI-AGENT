import type { Database } from "better-sqlite3";
import { API_VERSION, allows, isTerminalFlowRunState, type LeadCard, type Message } from "@factory/contracts";
import type { UploadDeps } from "../artifacts/uploads.js";
import type { LeadTurn } from "../chat/service.js";
import type { createCommandPipeline } from "../commands/pipeline.js";
import type { EventHub } from "../events/hub.js";
import { definitionOf, flowByKey, getRun, getVersion, type RunRow } from "../flow/store.js";
import { deterministicUuid } from "../org/service.js";
import { autonomyLevel } from "../policy/autonomy.js";
import { tracesFor } from "../trace/recorder.js";
import { decisionText, leadBriefTopic, markdownText, writeLeadBrief } from "./brief.js";
import { LeadEventHub } from "./causation.js";
import type { parseLeadOutput } from "./protocol.js";
import { leadChatMode } from "./settings.js";
import { redactLeadText } from "./history.js";

export function leadContext(raw: Database, turn: LeadTurn, integrations: readonly { id: string; name: string; kind: string }[] = []): string {
  const published = raw.prepare(`SELECT f.key, v.definition_json FROM flows f JOIN flow_versions v ON v.project_id=f.project_id AND v.flow_id=f.id
    WHERE f.project_id=? AND f.archived=0 AND v.version=(SELECT max(latest.version) FROM flow_versions latest
      WHERE latest.project_id=f.project_id AND latest.flow_id=f.id) ORDER BY f.key`).all(turn.projectId) as { key: string; definition_json: string }[];
  const briefTopics = raw.prepare("SELECT topic FROM lead_briefs WHERE project_id=? AND conversation_id=? ORDER BY rowid DESC LIMIT 30")
    .all(turn.projectId, turn.conversationId) as { topic: string }[];
  const runs = raw.prepare(`SELECT r.id, f.title, f.key, r.state FROM flow_runs r JOIN flows f ON f.project_id=r.project_id AND f.id=r.flow_id
    WHERE r.project_id=? AND r.test=0 AND r.state NOT IN ('failed','succeeded','cancelled') ORDER BY r.rowid DESC LIMIT 30`).all(turn.projectId);
  const recentChatRuns = raw.prepare(`SELECT json_extract(card.value,'$.runId') AS runId, json_extract(card.value,'$.title') AS title
    FROM messages m, json_each(m.body_json,'$.message.leadCards') card
    WHERE m.project_id=? AND m.conversation_id=? AND json_extract(card.value,'$.kind')='run' ORDER BY m.ordinal DESC LIMIT 10`)
    .all(turn.projectId, turn.conversationId);
  return JSON.stringify({ publishedFlows: published.map(({ key, definition_json }) => {
    const { title, description, inputs } = definitionOf(definition_json);
    return { key, title: redactLeadText(title), description: redactLeadText(description),
      inputs: inputs.map(({ default: _default, values, ...input }) => ({ ...input, values: values?.map(redactLeadText), hasDefault: _default !== undefined })) };
  }), integrations: integrations.slice(0, 40).map(({ id, name, kind }) => ({ id, name, kind })),
    briefTopics: briefTopics.map(({ topic }) => topic), activeRuns: runs, recentChatRuns });
}

const repeatConfirmationWindowMs = 2 * 60_000;
const explicitRestart = /^(?:(?:please|hãy|vui lòng)\s+)?(?:restart\b|re-?run\b|(?:chạy lại|khởi động lại)(?=\s|[.!?,]|$))/u;
const leadRunId = (turnId: string) => deterministicUuid(`lead-run:${turnId}`);

function matchingChatRun(raw: Database, turn: LeadTurn, flowId: string, topic: string, recentSince: string, restart: boolean) {
  const candidates = raw.prepare(`SELECT r.id, r.revision, r.state, r.definition_json, t.id AS turnId, b.topic
    FROM flow_runs r
    JOIN lead_turns t ON t.project_id=r.project_id AND t.conversation_id=? AND t.reply_message_id IS NOT NULL
    JOIN messages m ON m.project_id=t.project_id AND m.conversation_id=t.conversation_id AND m.id=t.reply_message_id
    JOIN json_each(m.body_json,'$.message.leadCards') card
      ON json_extract(card.value,'$.kind')='run' AND json_extract(card.value,'$.runId')=r.id
    LEFT JOIN json_each(m.body_json,'$.message.leadCards') briefCard ON json_extract(briefCard.value,'$.kind')='brief'
    LEFT JOIN lead_briefs b ON b.project_id=t.project_id AND b.conversation_id=t.conversation_id
      AND b.artifact_id=json_extract(briefCard.value,'$.artifactId')
    WHERE r.project_id=? AND r.flow_id=? AND r.test=0 AND r.state<>'cancelled'
      AND (r.state NOT IN ('succeeded','failed') OR (?=0 AND COALESCE(r.started_at,r.created_at)>=? AND b.topic=?))
    ORDER BY r.state IN ('succeeded','failed'), r.rowid DESC`)
    .all(turn.conversationId, turn.projectId, flowId, Number(restart), recentSince, topic) as
    (Pick<RunRow, "id" | "revision" | "state" | "definition_json"> & { turnId: string })[];
  return candidates.find((run) => run.id === leadRunId(run.turnId));
}

type ActionResult = { text: string; cards: LeadCard[]; startedRun?: boolean };
type Parsed = ReturnType<typeof parseLeadOutput>;

export function applyLeadAction(input: {
  raw: Database; hub: EventHub; turn: LeadTurn; user: Message; ordinal: number; parsed: Parsed;
  upload?: UploadDeps; execute?: ReturnType<typeof createCommandPipeline>["execute"];
  budgetAllowsStart: () => boolean; acceptTasks: (brief: { artifactId: string; version: number }) => LeadCard | null;
}): ActionResult {
  const { raw, hub, turn, user, ordinal, parsed, upload, execute } = input;
  const { projectId, conversationId } = turn;
  const action = parsed.action;
  const quote = action ? decisionText(action.kind === "plan" ? action.decision.quote : action.data.decision.quote) : "";
  const newer = raw.prepare(`SELECT 1 FROM messages WHERE project_id=? AND conversation_id=? AND ordinal>?
    AND json_extract(body_json,'$.message.speaker')='user' LIMIT 1`).get(projectId, conversationId, ordinal);
  const wanted = parsed.requested === "run" ? "chạy workflow" : parsed.requested === "cancel" ? "dừng run" : "tạo task";
  const target = action?.kind === "run" ? ` ${markdownText(action.data.flowKey)}` : "";
  if (!action || Array.from(quote).length < 2 || !decisionText(user.text).includes(quote) || newer)
    return { text: `Lead dự định ${wanted}${target} nhưng chưa thực hiện. Bạn xác nhận muốn ${wanted}${target} theo phương án vừa bàn không?`, cards: [] };
  if (leadChatMode(raw, projectId) === "classic") return { text: "Chưa thực hiện: dự án đã chuyển về chế độ Cổ điển.", cards: [] };

  const commandId = deterministicUuid(`lead-command:${turn.id}`);
  const scope = { projectId, messageId: turn.id };
  const withCause = <Value>(invoke: () => Value, details: { commandId?: string; runId?: string; briefRef?: string } = {}): Value =>
    hub instanceof LeadEventHub ? hub.leadAction({ ...scope, ...details }, invoke) : invoke();
  if (action.kind === "cancel") {
    const run = getRun(raw, projectId, action.data.runId);
    if (!run || !execute) return { text: "Không thể dừng: không tìm thấy run trong dự án này.", cards: [] };
    if (isTerminalFlowRunState(run.state)) return { text: "Run này đã kết thúc, không cần dừng nữa.", cards: [] };
    const result = withCause(() => execute({ apiVersion: API_VERSION, commandId, projectId, type: "flow-runs.cancel",
      payload: { runId: run.id, expectedRevision: run.revision, reason: "Người điều hành yêu cầu dừng qua Lead." } }, "lead", false),
    { commandId, runId: run.id });
    return { text: result.body.ok ? "Đã dừng run theo quyết định của bạn." : "Không thể dừng run; hãy kiểm tra trạng thái hiện tại.", cards: [] };
  }

  if (!parsed.brief || !upload) return { text: `Chưa ${wanted}: không có Bản chốt hợp lệ. Bạn có muốn Lead lập lại Bản chốt không?`, cards: [] };
  if (!allows(autonomyLevel(raw, projectId, "project", projectId).level, "team-plan-change"))
    return { text: `Chưa ${wanted}: mức tự chủ của Lead không cho phép bắt đầu công việc.`, cards: [] };
  if (!raw.prepare("SELECT 1 FROM projects WHERE id=? AND disposition='active'").get(projectId))
    return { text: `Chưa ${wanted}: dự án không hoạt động.`, cards: [] };
  let flow: { id: string; version: number; inputs: ReturnType<typeof definitionOf>["inputs"]; key: string } | undefined;
  const restart = explicitRestart.test(decisionText(user.text));
  let existing: ReturnType<typeof matchingChatRun>;
  if (action.kind === "run") {
    const candidate = flowByKey(raw, projectId, action.data.flowKey);
    const version = candidate && getVersion(raw, projectId, candidate.id);
    if (!candidate || !version) return { text: `Chưa chạy workflow ${target.trim()}: không có version đã publish trong dự án.`, cards: [] };
    if (!execute) return { text: "Chưa chạy workflow: Host chưa kết nối đường lệnh workflow.", cards: [] };
    flow = { id: candidate.id, key: candidate.key, version: version.version, inputs: definitionOf(version.definition_json).inputs };
    const recentSince = new Date(upload.now().getTime() - repeatConfirmationWindowMs).toISOString();
    existing = matchingChatRun(raw, turn, flow.id, leadBriefTopic(parsed.brief.title), recentSince, restart);
    if (!existing && !flow.inputs.some(({ name, type }) => name === "brief" && type === "string"))
      return { text: "Chưa chạy workflow: version đã publish cần khai báo input brief kiểu string.", cards: [] };
  }
  if (!existing && !input.budgetAllowsStart()) return { text: `Chưa ${wanted}: đã chạm giới hạn ngân sách.`, cards: [] };

  tracesFor(raw)?.event({ projectId, causationId: turn.id, payload: { type: "message.appended", message: user } });
  let brief: ReturnType<typeof writeLeadBrief>;
  try { brief = withCause(() => writeLeadBrief(upload, turn, parsed.brief!)); }
  catch { return { text: `Chưa ${wanted}: Host không lưu được Bản chốt. Hãy kiểm tra dung lượng tài liệu.`, cards: [] }; }
  const cards: LeadCard[] = [{ kind: "brief", artifactId: brief.artifactId, version: brief.version, title: brief.title }];
  const projectLink = `#/project/${projectId}`;
  const prefix = `Đã chốt:\n${brief.decisionLines.slice(0, 3).map((line) => `- ${line}`).join("\n")}\n\n[Bản chốt v${brief.version}](${projectLink}/knowledge/${brief.artifactId}/${brief.version})\n\n`;
  const stop = " Bạn có thể nói “dừng lại” để yêu cầu dừng run.";
  if (existing) {
    const title = redactLeadText(definitionOf(existing.definition_json).title).trim() || "Workflow";
    cards.push({ kind: "run", runId: existing.id, revision: existing.revision, state: existing.state, title });
    const link = `[xem run](${projectLink}/runs/${existing.id})`;
    const status = isTerminalFlowRunState(existing.state) ? `Run vừa chạy đã kết thúc — ${link}. Không tạo run trùng.`
      : `Run hiện tại vẫn tiếp tục — ${link}. Không tạo run mới.${restart ? " Cần dừng run hiện tại trước khi chạy lại." : stop}`;
    return { text: `${prefix}${status}`, cards };
  }
  if (action.kind === "run" && flow && execute) {
    const inputs = { ...action.data.inputs, brief: brief.markdown,
      ...(flow.inputs.some(({ name }) => name === "briefArtifactId") ? { briefArtifactId: brief.artifactId } : {}) };
    const runId = leadRunId(turn.id);
    const result = withCause(() => execute({ apiVersion: API_VERSION, commandId, projectId, type: "flow-runs.start",
      payload: { runId, flowId: flow.id, version: flow.version, inputs } }, "lead", false),
    { commandId, runId, briefRef: `${brief.artifactId}:${brief.version}` });
    const run = result.body.ok ? getRun(raw, projectId, runId) : undefined;
    if (!run) {
      return { text: `${prefix}Chưa chạy workflow ${markdownText(flow.key)}: ${!result.body.ok && result.body.error.code === "validation"
        ? "input không hợp lệ theo version đã publish." : "Host từ chối lệnh chạy."}`, cards };
    }
    const title = redactLeadText(definitionOf(run.definition_json).title).trim() || "Workflow";
    cards.push({ kind: "run", runId, revision: run.revision, state: run.state, title });
    return { text: `${prefix}${run.state === "cancelled" ? "Run không bắt đầu (quy tắc chạy đồng thời)." : `Đã gửi lệnh chạy workflow ${markdownText(title)} — [xem run](${projectLink}/runs/${runId}).${stop}`}`, cards, startedRun: true };
  }
  const tasks = input.acceptTasks(brief);
  if (tasks?.kind === "tasks") cards.push(tasks);
  return { text: `${prefix}${tasks?.kind === "tasks" ? `Đã tạo ${tasks.tasks.length} task sẵn sàng giao việc. Bạn có thể yêu cầu dừng công việc trong chat.`
    : "Không tạo task mới vì các task trong phương án đã có."}`, cards };
}
