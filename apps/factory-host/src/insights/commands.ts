import { API_VERSION, flowDefinitionSchema, validateFlow, type Finding, type FlowDefinition, type ImprovementPatchItem } from "@factory/contracts";
import type { Database } from "better-sqlite3";
import { CommandError } from "../commands/errors.js";
import type { HandlerContext, HandlerMap, createCommandPipeline } from "../commands/pipeline.js";
import { saveFlowDraft } from "../flow/commands.js";
import { activeAgents, matchesAgent } from "../flow/selector.js";
import { definitionOf, getFlow, getVersion } from "../flow/store.js";
import { currentAgentConfig, getAgent } from "../org/agents.js";
import { proposeSetup } from "../setup/commands.js";
import { insightsWindow, readFlowInsights } from "./read.js";
import { combinedPatch, flowFindings } from "./rules.js";
import { insertProposal, readProposal, setProposalState } from "./store.js";

export const INSIGHTS_COMMANDS = ["insights.propose", "insights.apply", "insights.discard"] as const;
function validation(message: string, fields?: { path: string; message: string }[]) {
  const extra: { currentRevision?: number; fields?: typeof fields } = fields === undefined ? {} : { fields };
  return new CommandError("validation", message, "correct-input", extra);
}

function editableFlow(raw: Database, projectId: string, flowId: string) {
  const flow = getFlow(raw, projectId, flowId);
  if (!flow || flow.archived) throw new CommandError("not-found", "Không tìm thấy quy trình có thể chỉnh sửa.", "refresh");
  return flow;
}

function reviewedProposal(ctx: HandlerContext, projectId: string, id: string, revision: number) {
  const proposal = readProposal(ctx.raw, projectId, id);
  if (!proposal) throw new CommandError("not-found", "Không tìm thấy đề xuất cải tiến.", "refresh");
  if (proposal.revision !== revision)
    throw new CommandError("conflict", "Đề xuất cải tiến đã thay đổi.", "refresh", { currentRevision: proposal.revision });
  return proposal;
}

function aiRequest(findings: Finding[], days: number) {
  const intro = `Đề xuất chỉnh sửa bản nháp quy trình dựa trên ${findings.length} phát hiện trong ${days} ngày. Không xuất bản và không bỏ qua bước phê duyệt.`;
  if (!findings.length) return `${intro}\nChưa đủ số liệu để đề xuất thay đổi dựa trên quy tắc.`;
  const lines = findings.map((finding, index) => {
    const values = Object.values(finding.metrics).map(({ value }) => value === null ? "chưa rõ" : Number(value.toPrecision(5))).join(" / ");
    return `${index + 1}. ${finding.nodeId ?? finding.agentId ?? "Quy trình"}: ${finding.message} Số liệu: ${values}.`;
  });
  const detailed = [intro, ...lines].join("\n");
  if (detailed.length <= 4000) return detailed;
  const counts = new Map<string, number>();
  for (const { message } of findings) counts.set(message, (counts.get(message) ?? 0) + 1);
  const summary = [intro, "Tóm tắt theo loại phát hiện:", ...[...counts].map(([message, count]) => `${count} × ${message}`), "Ví dụ có số liệu:"];
  for (const line of lines) {
    if (summary.join("\n").length + line.length + 1 > 4000) break;
    summary.push(line);
  }
  return summary.join("\n");
}

function patchDraft(raw: Database, projectId: string, draft: FlowDefinition, patch: ImprovementPatchItem[]) {
  const agents = activeAgents(raw, projectId);
  const nodes = new Map(draft.nodes.map((node) => [node.id, node]));
  for (const item of patch) {
    if (item.op === "change-model") continue;
    const node = nodes.get(item.nodeId);
    const field = (message: string) => validation(message, [{ path: `nodes.${item.nodeId}`, message }]);
    if (!node) throw field("Không tìm thấy bước cần chỉnh sửa.");
    switch (item.op) {
      case "set-timeout": nodes.set(node.id, { ...node, timeoutMinutes: item.timeoutMinutes }); break;
      case "set-retry": nodes.set(node.id, { ...node, retry: { max: item.max, backoffSeconds: item.backoffSeconds } }); break;
      case "set-on-error": nodes.set(node.id, { ...node, onError: item.onError }); break;
      case "change-agent": {
        if (node.type !== "agent") throw field("Chỉ có thể đổi agent ở bước agent.");
        const target = agents.find(({ id }) => id === item.agentId);
        const previous = "agent" in node.agent ? getAgent(raw, projectId, node.agent.agent) : undefined;
        const role = previous?.role ?? ("role" in node.agent ? node.agent.role : undefined);
        if (!target || target.id === previous?.id || target.role.toLowerCase() !== role?.toLowerCase())
          throw field("Agent thay thế phải đang hoạt động và có cùng vai trò.");
        nodes.set(node.id, { ...node, agent: { agent: item.agentId } });
        break;
      }
      case "add-review":
        if (node.type !== "agent" || node.review !== "none" || !agents.some((agent) => matchesAgent(raw, projectId, item.reviewer, agent)))
          throw field("Chỉ thêm phản biện cho bước chưa có phản biện và có agent phản biện đang hoạt động.");
        nodes.set(node.id, { ...node, review: { agent: item.reviewer } });
        break;
    }
  }
  const parsed = flowDefinitionSchema.safeParse({ ...draft, nodes: [...nodes.values()] });
  if (!parsed.success) throw validation("Bản nháp không hợp lệ.", parsed.error.issues.slice(0, 50)
    .map((issue) => ({ path: issue.path.join(".").slice(0, 256), message: issue.message.slice(0, 500) })));
  const issues = validateFlow(parsed.data, { agentIds: new Set(agents.map(({ id }) => id)) });
  if (issues.length) throw validation("Bản nháp không hợp lệ.", issues.slice(0, 50).map(({ node, edge, message }) => ({
    path: node ? `nodes.${node}` : edge ? `edges.${edge}` : "definition", message: message.slice(0, 500),
  })));
  return parsed.data;
}

export function createInsightsHandlers(deps: { kickSetup: () => void; executeChild: ReturnType<typeof createCommandPipeline>["execute"] }):
  Pick<HandlerMap, typeof INSIGHTS_COMMANDS[number]> {
  return {
    "insights.propose": (ctx, { projectId, payload }) => {
      const { raw } = ctx;
      const flow = editableFlow(raw, projectId, payload.flowId);
      if (readProposal(raw, projectId, payload.proposalId))
        throw new CommandError("conflict", "Mã đề xuất đã được sử dụng.", "refresh");
      const now = ctx.clock();
      const analytics = readFlowInsights(raw, insightsWindow(projectId, payload.days, now), flow);
      const available = flowFindings(analytics, { draft: definitionOf(flow.draft_json), agents: activeAgents(raw, projectId) });
      const selected = payload.findingIds && new Set(payload.findingIds);
      const findings = selected ? available.filter(({ id }) => selected.has(id)) : available;
      if (selected && findings.length !== selected.size) throw validation("Một số phát hiện không còn trong khoảng thời gian này.");
      const setupProposalId = payload.useAi ? ctx.newId() : null;
      if (setupProposalId) proposeSetup(ctx, { projectId, payload: { proposalId: setupProposalId, mode: "flow", flowId: flow.id,
        request: aiRequest(findings, payload.days) } }, deps.kickSetup);
      return { effects: [insertProposal(raw, { projectId, id: payload.proposalId, flowId: flow.id,
        baseVersion: getVersion(raw, projectId, flow.id)?.version ?? null, baseDraftRevision: flow.revision, state: "ready", source: "rules", findings,
        patch: combinedPatch(findings), setupProposalId, revision: 1, createdAt: now.toISOString(), updatedAt: now.toISOString() })] };
    },
    "insights.apply": (ctx, { projectId, payload }) => {
      const { raw } = ctx;
      if (ctx.actorIsOperator !== true) throw new CommandError("forbidden", "Chỉ người vận hành được áp dụng đề xuất.", "correct-input");
      const proposal = reviewedProposal(ctx, projectId, payload.proposalId, payload.expectedRevision);
      if (proposal.state !== "ready") throw new CommandError("conflict", "Đề xuất chưa sẵn sàng để áp dụng.", "refresh");
      const flow = editableFlow(raw, projectId, proposal.flowId);
      if (flow.revision !== proposal.baseDraftRevision)
        throw new CommandError("conflict", "Bản nháp quy trình đã thay đổi.", "refresh", { currentRevision: flow.revision });
      if (!proposal.patch.length) throw validation("Đề xuất không có thay đổi theo quy tắc để áp dụng.");
      const definition = patchDraft(raw, projectId, definitionOf(flow.draft_json), proposal.patch);
      const effects = proposal.patch.some(({ op }) => op !== "change-model")
        ? saveFlowDraft(ctx, { projectId, payload: { flowId: flow.id, expectedRevision: flow.revision, definition } }).effects : [];
      for (const item of proposal.patch) if (item.op === "change-model") {
        const agent = getAgent(raw, projectId, item.agentId);
        const current = agent && currentAgentConfig(raw, agent.id);
        if (!current) throw new CommandError("not-found", "Không tìm thấy agent cần đổi mô hình.", "refresh");
        const result = deps.executeChild({ apiVersion: API_VERSION, commandId: ctx.newId(), projectId, type: "agents.update", payload: {
          agentId: item.agentId, expectedRevision: item.expectedRevision, note: "Áp dụng đề xuất cải tiến đã được duyệt.",
          config: { ...current.config, runtime: { ...current.config.runtime, model: item.model } },
        } }, ctx.actorId, ctx.actorIsOperator);
        if (!result.body.ok) {
          const { code, message, nextAction, currentRevision, fields } = result.body.error;
          throw new CommandError(code, message, nextAction, { ...(currentRevision === undefined ? {} : { currentRevision }),
            ...(fields === undefined ? {} : { fields }) });
        }
      }
      return { effects: [...effects, setProposalState(raw, proposal, "applied", ctx.clock().toISOString())] };
    },
    "insights.discard": (ctx, { projectId, payload }) => {
      const proposal = reviewedProposal(ctx, projectId, payload.proposalId, payload.expectedRevision);
      if (proposal.state === "applied" || proposal.state === "discarded")
        throw new CommandError("conflict", "Không thể bỏ đề xuất ở trạng thái này.", "refresh");
      return { effects: [setProposalState(ctx.raw, proposal, "discarded", ctx.clock().toISOString())] };
    },
  };
}
