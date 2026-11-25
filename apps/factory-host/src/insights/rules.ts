import type { AgentInsights, Finding, FlowDefinition, FlowInsights, ImprovementPatchItem, InsightMetric, NodeInsights } from "@factory/contracts";
import { evidence } from "./metrics.js";

export const MIN_SAMPLES = 5;
export const NODE_FAILURE_RATE = 0.30;
export const NODE_RETRIES = 1;
export const NODE_TIMEOUTS = 2;
export const REWORK_ITERATIONS = 2;
export const APPROVAL_REJECTION_RATE = 0.50;
export const SLOW_NODE_MULTIPLIER = 3;
export const QUEUE_WAIT_MS = 10 * 60_000;
export const COST_SHARE = 0.50;

type Candidate = { id: string; role: string };
type RuleContext = { draft: FlowDefinition; agents: Candidate[] };
const tokenSum = (cost: FlowInsights["cost"]) => (cost.knownTokens.value ?? 0) + (cost.estimatedTokens.value ?? 0);
const qualifies = (metric: InsightMetric, predicate: (value: number) => boolean) =>
  metric.samples >= MIN_SAMPLES && metric.value !== null && predicate(metric.value);

function finding(code: Finding["code"], severity: Finding["severity"], message: string, metrics: Finding["metrics"],
  target: Pick<Finding, "nodeId" | "agentId">, suggestion?: ImprovementPatchItem): Finding {
  return { id: `${code}:${target.nodeId ?? target.agentId ?? "flow"}`, code, severity, message, metrics, ...target,
    evidence: evidence(Object.values(metrics).flatMap((item) => item.evidence)), ...(suggestion ? { suggestion } : {}) };
}

function suggestFailure(nodeId: string, context?: RuleContext): ImprovementPatchItem | undefined {
  const node = context?.draft.nodes.find((item) => item.id === nodeId);
  if (node?.type !== "agent") return;
  const currentId = "agent" in node.agent ? node.agent.agent : undefined;
  const current = context?.agents.find((entry) => entry.id === currentId);
  const replacement = current && context?.agents.find((entry) => entry.id !== current.id && entry.role.toLowerCase() === current.role.toLowerCase());
  if (replacement) return { op: "change-agent", nodeId, agentId: replacement.id };
}

function nodeFindings(node: NodeInsights, flow: FlowInsights, context?: RuleContext): Finding[] {
  const target = { nodeId: node.nodeId };
  const results: Finding[] = [];
  const current = context?.draft.nodes.find(({ id }) => id === node.nodeId);
  if (qualifies(node.failureRate, (value) => value > NODE_FAILURE_RATE))
    results.push(finding("node-failure-rate", "high", "Tỷ lệ lỗi của bước vượt 30%.", { failureRate: node.failureRate }, target,
      suggestFailure(node.nodeId, context)));
  if (qualifies(node.averageRetries, (value) => value > NODE_RETRIES))
    results.push(finding("node-retry-heavy", "warning", "Bước chạy lại trung bình hơn một lần mỗi lượt chạy.",
      { averageRetries: node.averageRetries, retries: node.retries }, target,
      current?.retry && current.retry.max > 1 ? { op: "set-retry", ...target, max: current.retry.max - 1, backoffSeconds: current.retry.backoffSeconds } : undefined));
  if (qualifies(node.timeouts, (value) => value >= NODE_TIMEOUTS))
    results.push(finding("node-timeout", "warning", "Bước đã hết thời gian ít nhất hai lần.", { timeouts: node.timeouts }, target,
      current?.timeoutMinutes && current.timeoutMinutes < 10080 && current.type !== "approval"
        ? { op: "set-timeout", ...target, timeoutMinutes: Math.min(10080, Math.ceil(current.timeoutMinutes * 1.5)) } : undefined));
  if (qualifies(node.averageIterations, (value) => value > REWORK_ITERATIONS))
    results.push(finding("rework-loops", "warning", "Bước có trung bình hơn hai vòng làm lại mỗi lượt chạy.",
      { averageIterations: node.averageIterations, reworkIterations: node.reworkIterations }, target));
  if (qualifies(node.approvals.rejectionRate, (value) => value > APPROVAL_REJECTION_RATE))
    results.push(finding("approval-rejections", "high", "Hơn một nửa quyết định phê duyệt bị từ chối.",
      { rejectionRate: node.approvals.rejectionRate }, target));
  const baseline = flow.medianNodeRunMs.value;
  if (baseline !== null && qualifies(node.run.p90Ms, (value) => value > SLOW_NODE_MULTIPLIER * baseline))
    results.push(finding("slow-node", "warning", "P90 thời gian chạy của bước lớn hơn ba lần trung vị các bước trong quy trình.",
      { p90Ms: node.run.p90Ms, flowMedianMs: flow.medianNodeRunMs }, target));
  const flowTokens = tokenSum(flow.cost);
  if (node.cost.knownTokens.samples >= MIN_SAMPLES && flowTokens > 0 && tokenSum(node.cost) / flowTokens > COST_SHARE)
    results.push(finding("cost-hotspot", "warning", "Bước dùng hơn một nửa tổng token đã ghi nhận và ước tính của quy trình.",
      { ...node.cost, flowKnownTokens: flow.cost.knownTokens, flowEstimatedTokens: flow.cost.estimatedTokens }, target));
  if (qualifies(node.cost.unknownCount, (value) => value > 0))
    results.push(finding("unknown-cost", "info", "Bước có chi phí chưa rõ; không tính là bằng không.", { unknownCount: node.cost.unknownCount }, target));
  return results;
}

export function flowFindings(flow: FlowInsights, context?: RuleContext): Finding[] {
  return flow.nodes.flatMap((node) => nodeFindings(node, flow, context));
}

export function agentFindings(agents: AgentInsights[]): Finding[] {
  return agents.flatMap((agent) => {
    const target = { agentId: agent.agentId };
    const results: Finding[] = [];
    if (qualifies(agent.medianQueueWaitMs, (value) => value > QUEUE_WAIT_MS))
      results.push(finding("queue-wait", "warning", "Agent có thời gian chờ trung vị hơn 10 phút.",
        { medianQueueWaitMs: agent.medianQueueWaitMs, busyShare: agent.busyShare }, target));
    if (qualifies(agent.cost.unknownCount, (value) => value > 0))
      results.push(finding("unknown-cost", "info", "Agent có chi phí chưa rõ; không tính là bằng không.", { unknownCount: agent.cost.unknownCount }, target));
    return results;
  });
}

export function combinedPatch(findings: Finding[]): ImprovementPatchItem[] {
  const items = new Map<string, ImprovementPatchItem>();
  for (const { suggestion } of findings) if (suggestion) {
    const key = `${suggestion.op}:${"nodeId" in suggestion ? suggestion.nodeId : suggestion.agentId}`;
    if (!items.has(key)) items.set(key, suggestion);
  }
  return [...items.values()];
}
