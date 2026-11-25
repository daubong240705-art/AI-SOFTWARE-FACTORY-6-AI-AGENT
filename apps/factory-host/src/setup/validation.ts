import { setupProposalSchema, validateFlow, type AgentAdapter, type AgentSelector, type FlowDefinition,
  type SetupIssue, type SetupProposal } from "@factory/contracts";
import type { Database } from "better-sqlite3";
import { getFlow } from "../flow/store.js";
import { groupChain, projectGroupId } from "../groups/settings.js";
import { isKnownToolPattern } from "../org/agents.js";
import { issue, type ProposalRow } from "./store.js";

const localPrefix = "setup:";

export function mapSelectors(flow: FlowDefinition, map: (selector: AgentSelector, path: string) => AgentSelector): FlowDefinition {
  return { ...flow, nodes: flow.nodes.map((node, index) => {
    const path = `nodes.${index}`;
    if (node.type === "agent") return { ...node, agent: map(node.agent, `${path}.agent`),
      review: typeof node.review === "string" ? node.review : { agent: map(node.review.agent, `${path}.review.agent`) } };
    if (node.type === "approval" && typeof node.approver !== "string")
      return { ...node, approver: { agent: map(node.approver.agent, `${path}.approver.agent`) } };
    if (node.type === "orchestrate") return { ...node, lead: map(node.lead, `${path}.lead`),
      allowed: node.allowed.map((selector, index) => map(selector, `${path}.allowed.${index}`)) };
    return node;
  }) };
}

function localKey(selector: AgentSelector): string | undefined {
  return "role" in selector && selector.role.startsWith(localPrefix) ? selector.role.slice(localPrefix.length) : undefined;
}

export function resolveFlowAgents(flow: FlowDefinition, ids: ReadonlyMap<string, string>): FlowDefinition {
  return mapSelectors(flow, (selector) => {
    const key = localKey(selector);
    return key === undefined ? selector : { agent: ids.get(key)! };
  });
}

export function validateProposal(raw: Database, row: ProposalRow, candidate: unknown, adapters: ReadonlySet<AgentAdapter>):
  { proposal?: SetupProposal; issues: SetupIssue[] } {
  const parsed = setupProposalSchema.safeParse(candidate);
  if (!parsed.success) return { issues: parsed.error.issues.slice(0, 50).map((error) =>
    issue(error.path.join("."), error.code === "unrecognized_keys" ? "Trường không được hỗ trợ." : error.message)) };
  const proposal = parsed.data;
  const projectId = row.project_id;
  const issues: SetupIssue[] = [];
  const add = (path: string, message: string) => { if (issues.length < 50) issues.push(issue(path, message)); };
  if (row.mode === "flow") {
    for (const field of ["agents", "teams", "relations"] as const)
      if (proposal[field].length) add(field, "Chế độ workflow không được thay đổi agent, team hoặc quan hệ.");
    if (proposal.flows.length !== 1) add("flows", "Chế độ workflow cần đúng một bản nháp.");
  }
  if (row.flow_id !== null) {
    const current = getFlow(raw, projectId, row.flow_id);
    if (!current || current.archived || current.revision !== row.flow_revision)
      add("flows.0", "Workflow gốc đã thay đổi. Hãy tạo đề xuất mới từ bản nháp hiện tại.");
  }
  // The local selector prefix is only for workflow selectors; a role like "setup:qa" is the model mixing them up.
  proposal.agents.forEach((agent, index) => {
    if (agent.config.role.trim().toLowerCase().startsWith(localPrefix))
      add(`agents.${index}.config.role`, "Vai trò phải là chức danh dễ đọc, không dùng mã \"setup:\" (mã đó chỉ dùng trong selector của workflow).");
  });
  const seats = raw.prepare<[string], { id: string; name: string; status: string }>(
    "SELECT id, name, status FROM seats WHERE project_id=?").all(projectId);
  const keys = new Set<string>();
  const names = new Set(seats.map(({ name }) => name.trim().toLowerCase()));
  const groups = new Set(groupChain(raw, projectGroupId(raw, projectId)).map(({ id }) => id));
  const findSkill = raw.prepare<[number | string, number | string, string], { group_id: string | null; name: string }>(`
    SELECT s.group_id, v.name FROM skills s JOIN skill_versions v ON v.skill_id=s.id
      AND v.version=CASE WHEN ?='latest' THEN s.latest_version ELSE ? END WHERE s.id=?`);
  for (const [index, { key, config }] of proposal.agents.entries()) {
    const path = `agents.${index}`;
    if (keys.has(key)) add(`${path}.key`, "Mã agent bị trùng.");
    keys.add(key);
    const name = config.name.toLowerCase();
    if (names.has(name)) add(`${path}.config.name`, "Tên agent đã được sử dụng.");
    names.add(name);
    if (!adapters.has(config.runtime.adapter)) add(`${path}.config.runtime.adapter`, "Adapter chưa được đăng ký trên Host.");
    const skillNames = new Set<string>();
    config.skills.forEach(({ skillId, version }, index) => {
      const skill = findSkill.get(version, version, skillId);
      const skillPath = `${path}.config.skills.${index}`;
      if (!skill || (skill.group_id !== null && !groups.has(skill.group_id)))
        add(skillPath, "Skill hoặc phiên bản không tồn tại hoặc không khả dụng trong project.");
      else if (skillNames.has(skill.name)) add(skillPath, "Tên skill trùng với một skill khác của agent.");
      else skillNames.add(skill.name);
    });
    config.tools?.forEach(({ tool }, index) => {
      if (!isKnownToolPattern(tool)) add(`${path}.config.tools.${index}`, "Tool không được hỗ trợ.");
    });
  }
  const knownKey = (key: string, path: string) => { if (!keys.has(key)) add(path, "Mã agent không có trong đề xuất."); };
  const teamNames = new Set(raw.prepare<[string], { name: string }>("SELECT name FROM teams WHERE project_id=? AND kind='group'")
    .all(projectId).map(({ name }) => name.trim().toLowerCase()));
  proposal.teams.forEach(({ name, memberKeys, leadKey }, index) => {
    const path = `teams.${index}`;
    if (teamNames.has(name.toLowerCase())) add(`${path}.name`, "Tên team đã được sử dụng.");
    teamNames.add(name.toLowerCase());
    memberKeys.forEach((key, index) => knownKey(key, `${path}.memberKeys.${index}`));
    if (new Set(memberKeys).size !== memberKeys.length) add(`${path}.memberKeys`, "Thành viên team bị trùng.");
    if (leadKey !== undefined) {
      knownKey(leadKey, `${path}.leadKey`);
      if (!memberKeys.includes(leadKey)) add(`${path}.leadKey`, "Trưởng team phải là thành viên của team.");
    }
  });
  const manages = new Map<string, string[]>();
  const seen = new Set<string>();
  proposal.relations.forEach(({ fromKey, toKey, kind }, index) => {
    const path = `relations.${index}`;
    knownKey(fromKey, `${path}.fromKey`);
    knownKey(toKey, `${path}.toKey`);
    if (fromKey === toKey) add(path, "Agent không thể có quan hệ với chính mình.");
    const edge = `${fromKey}:${toKey}:${kind}`;
    if (seen.has(edge)) add(path, "Quan hệ bị trùng.");
    seen.add(edge);
    if (kind === "manages" && keys.has(fromKey) && keys.has(toKey)) {
      const targets = manages.get(fromKey) ?? [];
      targets.push(toKey);
      manages.set(fromKey, targets);
    }
  });
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cyclic = (key: string): boolean => {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    if ((manages.get(key) ?? []).some(cyclic)) return true;
    visiting.delete(key);
    visited.add(key);
    return false;
  };
  if ([...manages.keys()].some(cyclic)) add("relations", "Quan hệ manages tạo thành chu trình.");

  const flowKeys = new Set(raw.prepare<[string, string | null], { key: string }>(
    "SELECT key FROM flows WHERE project_id=? AND id IS NOT ?").all(projectId, row.flow_id).map(({ key }) => key));
  const activeIds = new Set([...seats.filter(({ status }) => status === "active").map(({ id }) => id),
    ...[...keys].map((key) => `${localPrefix}${key}`)]);
  proposal.flows.forEach((flow, index) => {
    const path = `flows.${index}`;
    if (flowKeys.has(flow.key)) add(`${path}.key`, "Mã workflow đã được sử dụng.");
    flowKeys.add(flow.key);
    if (Buffer.byteLength(JSON.stringify(flow)) > 524288) add(path, "Bản nháp workflow vượt quá giới hạn kích thước.");
    const resolved = mapSelectors(flow, (selector, at) => {
      const key = localKey(selector);
      if (key === undefined) return selector;
      if (!keys.has(key)) { knownKey(key, `${path}.${at}`); return selector; }
      return { agent: `${localPrefix}${key}` };
    });
    for (const problem of validateFlow(resolved, { agentIds: activeIds })) {
      const nodeIndex = flow.nodes.findIndex(({ id }) => id === problem.node);
      const edgeIndex = flow.edges.findIndex(({ id }) => id === problem.edge);
      add(nodeIndex >= 0 ? `${path}.nodes.${nodeIndex}` : edgeIndex >= 0 ? `${path}.edges.${edgeIndex}` : path, problem.message);
    }
  });
  return { proposal, issues };
}
