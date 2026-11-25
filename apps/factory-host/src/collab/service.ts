import { API_VERSION, COLLABORATION_TOOLS, reviewVerdictSchema, type AgentConfig, type AgentSelector, type ArtifactRef, type Seat, type Task } from "@factory/contracts";
import type { Database } from "better-sqlite3";
import { z } from "zod";
import { listTaskArtifacts } from "../artifacts/service.js";
import { CommandError } from "../commands/errors.js";
import type { HandlerMap } from "../commands/pipeline.js";
import type { Dispatcher } from "../dispatch/dispatcher.js";
import { moveTask } from "../dispatch/tasks.js";
import type { EventHub } from "../events/hub.js";
import { withoutWorkflowAdvancement, workflowChanged } from "../flow/lifecycle.js";
import { activeAgents, agentLoad, chooseAgent, matchesAgent } from "../flow/selector.js";
import { emit, hash } from "../flow/store.js";
import { saveTaskResult } from "../flow/work.js";
import type { Clock } from "../ids.js";
import { withAgentLibraryScope } from "../library/commands.js";
import { assertActiveGrant, McpToolError, sanitizeAgentText } from "../mcp/security.js";
import type { ToolResult } from "../mcp/tools.js";
import { createAgentHandlers } from "../org/agent-commands.js";
import { currentAgentConfig } from "../org/agents.js";
import { DEFAULT_BUDGET_CONFIG, type BudgetConfig } from "../policy/budget.js";
import type { TokenGrant } from "../proxy/tokens.js";
import { getTask, tasksCreateHandler } from "../work/service.js";
import { assignmentScope, budgetRefusal, duplicateTask, isTerminalTask, terminalTasks } from "./policy.js";
import { wake } from "./wakeups.js";

type Tool = keyof typeof COLLABORATION_TOOLS;
type Input<Name extends Tool> = z.output<(typeof COLLABORATION_TOOLS)[Name]>;
type Orchestrator = { task_id: string; run_id: string; node_id: string; iteration: number; allowed_json: string;
  max_tasks: number; max_depth: number; budget_tokens: number | null; node_state: string; run_state: string };
type Deps = { raw: Database; hub: EventHub; clock: Clock; newId: () => string; dispatcher: Dispatcher; budgetConfig?: BudgetConfig };
type Actor = { agentId: string; config: AgentConfig; task: Task; grant: TokenGrant };

function deny(reason: string): never { throw new CommandError("validation", reason, "correct-input"); }
function clean(text: string): string { return sanitizeAgentText(text).trim(); }
function parse<Name extends Tool>(name: Name, args: unknown): Input<Name> {
  const parsed = COLLABORATION_TOOLS[name].safeParse(args);
  if (!parsed.success) throw new McpToolError("invalid tool input");
  return parsed.data as Input<Name>;
}

function orchestrator(raw: Database, projectId: string, taskId: string): Orchestrator | undefined {
  return raw.prepare(`SELECT o.*, n.state AS node_state, f.state AS run_state FROM tasks t
    JOIN collab_orchestrators o ON o.project_id=t.project_id AND o.task_id=t.node_run_id
    JOIN flow_node_runs n ON n.project_id=o.project_id AND n.run_id=o.run_id AND n.node_id=o.node_id AND n.iteration=o.iteration AND n.attempt_no=o.attempt_no
    JOIN flow_runs f ON f.project_id=o.project_id AND f.id=o.run_id WHERE t.project_id=? AND t.id=?`).get(projectId, taskId) as Orchestrator | undefined;
}

function actorFor(raw: Database, grant: TokenGrant, now: Date): Actor {
  const row = raw.prepare(`SELECT s.id FROM attempt_seats a JOIN seats s ON s.id=a.seat_id AND s.project_id=a.project_id
    WHERE a.project_id=? AND a.attempt_id=? AND s.status='active'`).get(grant.projectId, grant.attemptId) as { id: string } | undefined;
  const cfg = row && currentAgentConfig(raw, row.id);
  const task = getTask(raw, grant.projectId, grant.taskId);
  if (grant.expiresAt <= now.getTime() || !row || !cfg || !task || task.ownerSeatId !== row.id || task.state !== "active" || task.disposition !== "active")
    return deny("attempt is not active");
  return { agentId: row.id, config: cfg.config, task, grant };
}

function relations(raw: Database, projectId: string, agentId: string, reviewerId: string): boolean {
  return Boolean(raw.prepare(`SELECT 1 FROM agent_relations WHERE project_id=? AND from_agent_id=? AND to_agent_id=? AND kind='reviews'`)
    .get(projectId, reviewerId, agentId));
}

function targets(raw: Database, actor: Actor, review = false): Seat[] {
  const { projectId } = actor.grant;
  const within = assignmentScope(raw, projectId, actor.agentId, actor.config);
  const node = orchestrator(raw, projectId, actor.task.id);
  const allowed = node ? JSON.parse(node.allowed_json) as AgentSelector[] : undefined;
  return activeAgents(raw, projectId).filter((seat) => (within(seat) || (review && relations(raw, projectId, actor.agentId, seat.id)))
    && (!allowed || allowed.some((selector) => matchesAgent(raw, projectId, selector, seat))));
}

function findTarget(raw: Database, actor: Actor, selector: string | AgentSelector, review = false): Seat {
  return chooseAgent(raw, actor.grant.projectId, typeof selector === "string" ? { agent: selector } : selector, targets(raw, actor, review)) ?? deny("not_allowed");
}

function insertAssignment(deps: Deps, actor: Actor, target: Seat, spec: { title: string; goal: string; brief?: string | undefined;
  acceptance?: string[]; artifacts?: ArtifactRef[]; estimateTokens: number; parent?: boolean; force?: boolean;
  kind: "delegation" | "review" | "decision" }) {
  const { raw, hub, clock } = deps;
  const { projectId } = actor.grant;
  const title = clean(spec.title).slice(0, 160);
  const goal = clean(spec.goal).slice(0, 500);
  if (!title || !goal) return deny("invalid tool input");
  const node = orchestrator(raw, projectId, actor.task.id);
  if (node && (node.node_state !== "waiting" || !["running", "waiting", "stalled"].includes(node.run_state))) return deny("orchestrator_not_running");
  const parentTaskId = spec.parent === false ? actor.task.parentTaskId : actor.task.id;
  const ancestors = raw.prepare(`WITH RECURSIVE chain(id) AS (SELECT ? UNION
    SELECT coalesce(a.source_task_id,t.parent_task_id) FROM chain c JOIN tasks t ON t.project_id=? AND t.id=c.id
      LEFT JOIN collab_assignments a ON a.project_id=t.project_id AND a.task_id=t.id)
    SELECT t.id,t.owner_seat_id,t.created_by_agent_id,t.state,t.node_run_id FROM chain JOIN tasks t ON t.project_id=? AND t.id=chain.id`)
    .all(actor.task.id, projectId, projectId) as { id: string; owner_seat_id: string | null; created_by_agent_id: string | null; state: string; node_run_id: string | null }[];
  const parents = raw.prepare(`WITH RECURSIVE chain(id) AS (SELECT ? UNION SELECT t.parent_task_id
    FROM chain c JOIN tasks t ON t.project_id=? AND t.id=c.id) SELECT t.id,t.node_run_id FROM chain
    JOIN tasks t ON t.project_id=? AND t.id=chain.id`).all(parentTaskId, projectId, projectId) as { id: string; node_run_id: string | null }[];
  const depth = Math.max(1, parents.length);
  if (spec.kind !== "decision") {
    if (ancestors.some((task) => !isTerminalTask(task.state) && (task.owner_seat_id === target.id || task.created_by_agent_id === target.id)))
      return deny("delegation_cycle");
    if (depth > actor.config.delegation.maxDepth) return deny("max_depth");
    if (spec.kind === "delegation" && !spec.force) {
      const duplicate = duplicateTask(raw, projectId, title);
      if (duplicate) return { taskId: duplicate, duplicate_of: duplicate };
    }
    const open = raw.prepare(`SELECT count(*) AS total FROM tasks WHERE project_id=? AND created_by_agent_id=? AND state NOT IN (${terminalTasks})`)
      .get(projectId, actor.agentId) as { total: number };
    if (open.total >= actor.config.delegation.maxOpenSubtasks) return deny("max_open_subtasks");
  }
  if (node) {
    if (spec.kind === "decision" && !(JSON.parse(node.allowed_json) as AgentSelector[]).some((selector) => matchesAgent(raw, projectId, selector, target)))
      return deny("not_allowed");
    if (Math.max(1, parents.filter((task) => task.node_run_id === node.task_id).length) > node.max_depth) return deny("max_depth");
    const usage = raw.prepare(`SELECT count(*) AS total,coalesce(sum(a.estimate_tokens),0) AS tokens FROM tasks t
      JOIN collab_assignments a ON a.project_id=t.project_id AND a.task_id=t.id WHERE t.project_id=? AND t.node_run_id=?`)
      .get(projectId, node.task_id) as { total: number; tokens: number };
    if (usage.total >= node.max_tasks) return deny("max_tasks");
    if (node.budget_tokens !== null && spec.estimateTokens > node.budget_tokens - usage.tokens) return deny("budget:node");
  }
  const refusal = budgetRefusal(raw, { projectId, taskId: actor.task.id, target, estimateTokens: spec.estimateTokens,
    now: clock(), config: deps.budgetConfig ?? DEFAULT_BUDGET_CONFIG });
  if (refusal) return deny(refusal);
  const engagement = raw.prepare("SELECT id FROM engagements WHERE project_id=? AND team_id=? AND state='active' ORDER BY priority DESC,id LIMIT 1")
    .get(projectId, target.teamId) as { id: string } | undefined;
  if (!engagement) return deny("target has no active engagement");
  const { serial } = raw.prepare("SELECT coalesce(max(CAST(substr(code,4) AS INTEGER)),0)+1 AS serial FROM tasks WHERE project_id=? AND code LIKE 'CO-%'")
    .get(projectId) as { serial: number };
  if (serial > 999999) return deny("task codes exhausted");
  const taskId = deps.newId();
  tasksCreateHandler({ ...deps, actorId: actor.agentId }, { apiVersion: API_VERSION, commandId: taskId, projectId, type: "tasks.create", payload: {
    taskId, code: `CO-${String(serial).padStart(3, "0")}`, title, goal, brief: clean(spec.brief ?? goal) || goal,
    parentTaskId, engagementId: engagement.id, ownerSeatId: target.id, requiredCapabilities: [],
    placement: "portable", sideEffect: "none", reviewPolicy: "automatic", requiresGo: false,
    acceptance: (spec.acceptance ?? []).map(clean).filter(Boolean), inputs: spec.artifacts ?? [], dependsOn: [],
  } });
  raw.prepare("UPDATE tasks SET created_by_agent_id=?,node_run_id=?,origin_kind=? WHERE project_id=? AND id=?")
    .run(actor.agentId, node?.task_id ?? null, parentTaskId ? "delegation" : "operator", projectId, taskId);
  raw.prepare("INSERT INTO collab_assignments VALUES(?,?,?,?,?,?)").run(projectId, taskId, actor.task.id, spec.kind, depth, spec.estimateTokens);
  if (node) raw.prepare("INSERT INTO flow_tasks VALUES(?,?,?,?,?,'subtask')").run(projectId, taskId, node.run_id, node.node_id, node.iteration);
  const task = withoutWorkflowAdvancement(raw, () => {
    moveTask(raw, projectId, taskId, "accepted");
    return moveTask(raw, projectId, taskId, "ready");
  });
  wake(raw, projectId, target.id, taskId, spec.kind === "review" ? "review-requested" : "assigned", clock());
  emit(hub, projectId, actor.task.id, { kind: "task", id: taskId, revision: task.revision });
  return { taskId };
}

function depend(raw: Database, actor: Actor, input: Input<"task.depend">) {
  const { projectId } = actor.grant;
  for (const id of [input.taskId, input.dependsOn]) if (!raw.prepare("SELECT 1 FROM tasks WHERE project_id=? AND id=? AND created_by_agent_id=?")
    .get(projectId, id, actor.agentId)) return deny("not_allowed");
  if (raw.prepare(`WITH RECURSIVE predecessors(id) AS (SELECT ? UNION SELECT d.depends_on_task_id
      FROM task_dependencies d JOIN predecessors p ON p.id=d.task_id WHERE d.project_id=?) SELECT 1 FROM predecessors WHERE id=?`)
    .get(input.dependsOn, projectId, input.taskId)) return deny("dependency_cycle");
  const task = getTask(raw, projectId, input.taskId)!;
  if (!["accepted", "ready"].includes(task.state)) return deny("task_already_started");
  const added = raw.prepare("INSERT OR IGNORE INTO task_dependencies VALUES(?,?,?)").run(projectId, task.id, input.dependsOn).changes > 0;
  if (added) raw.prepare("UPDATE tasks SET revision=revision+1 WHERE project_id=? AND id=?").run(projectId, task.id);
  return { added, task };
}

function comment(deps: Deps, actor: Actor, input: Input<"task.comment">) {
  const { raw, clock } = deps;
  const { projectId } = actor.grant;
  const task = raw.prepare("SELECT owner_seat_id,created_by_agent_id,state FROM tasks WHERE project_id=? AND id=?")
    .get(projectId, input.taskId) as { owner_seat_id: string | null; created_by_agent_id: string | null; state: string } | undefined;
  const review = (agentId: string) => raw.prepare(`SELECT t.id,t.state FROM collab_assignments a JOIN tasks t ON t.project_id=a.project_id AND t.id=a.task_id
    WHERE a.project_id=? AND a.source_task_id=? AND a.kind='review' AND t.owner_seat_id=? AND t.state NOT IN (${terminalTasks}) ORDER BY t.rowid DESC LIMIT 1`)
    .get(projectId, input.taskId, agentId) as { id: string; state: string } | undefined;
  if (!task || (task.owner_seat_id !== actor.agentId && task.created_by_agent_id !== actor.agentId && !review(actor.agentId))) return deny("not_allowed");
  const text = clean(input.text);
  if (!text) return deny("invalid tool input");
  const mention = input.mention;
  if (mention && !raw.prepare("SELECT 1 FROM seats WHERE project_id=? AND id=?").get(projectId, mention)) return deny("unknown mention");
  const now = clock();
  const commentId = deps.newId();
  raw.prepare("INSERT INTO task_comments VALUES(?,?,?,?,?,?,?)").run(projectId, commentId, input.taskId, actor.agentId, mention ?? null, text, now.toISOString());
  if (mention) {
    const recipient = mention === task.owner_seat_id && !isTerminalTask(task.state) ? { id: input.taskId } : review(mention);
    if (recipient && raw.prepare("SELECT 1 FROM seats WHERE project_id=? AND id=? AND status='active'").get(projectId, mention))
      wake(raw, projectId, mention, recipient.id, "comment-mention", now);
  }
  return { commentId };
}

function approval(deps: Deps, actor: Actor, subject: string, summary: string, options: { id: string; label: string; consequence: string }[]): string {
  const { projectId } = actor.grant;
  const id = deps.newId();
  const now = deps.clock();
  deps.raw.prepare(`INSERT INTO approvals(project_id,id,revision,kind,task_id,subject,summary,options_json,recommendation,impact_if_waiting,context_digest,approver,requested_at,expires_at,state)
    VALUES(?,?,1,'question',NULL,?,?,?,NULL,'Agent is waiting for an operator response',?,'operator',?,?,'pending')`)
    .run(projectId, id, subject, summary, JSON.stringify(options), hash(JSON.stringify({ id, subject, summary, options })),
      now.toISOString(), new Date(now.getTime()+7*86400000).toISOString());
  emit(deps.hub, projectId, actor.task.id, { kind: "approval", id, revision: 1 });
  return id;
}

function block(deps: Deps, actor: Actor, input: Input<"task.block">) {
  const { raw } = deps;
  const { projectId } = actor.grant;
  const reason = clean(input.reason);
  if (!reason) return deny("invalid tool input");
  if (actor.task.holds.some(({ kind }) => kind === "decision")) return deny("a decision is already pending");
  const { id: taskId } = actor.task;
  const managers = raw.prepare(`WITH RECURSIVE managers(id,depth) AS (SELECT ?,0 UNION
    SELECT r.from_agent_id,m.depth+1 FROM managers m JOIN agent_relations r ON r.to_agent_id=m.id AND r.project_id=? AND r.kind='manages')
    SELECT s.id FROM managers m JOIN seats s ON s.id=m.id WHERE m.depth>0 AND s.status='active' ORDER BY m.depth,s.id`)
    .all(actor.agentId, projectId) as { id: string }[];
  const seats = activeAgents(raw, projectId);
  let decisionTask: string | undefined;
  for (const { id } of managers) {
    const manager = seats.find((seat) => seat.id === id);
    if (!manager) continue;
    try {
      decisionTask = raw.transaction(() => insertAssignment(deps, actor, manager, { kind: "decision", estimateTokens: 1000,
        title: `Unblock: ${actor.task.title}`.slice(0, 160), goal: reason.slice(0, 500),
        brief: `Resolve the blocker for ${actor.task.code}: ${reason}. Report the answer with task.result.` })).immediate().taskId;
      break;
    } catch (error) { if (!(error instanceof CommandError)) throw error; }
  }
  const approvalId = decisionTask ? undefined : approval(deps, actor, `Blocked: ${actor.task.title}`.slice(0, 160), reason,
    [{ id: "continue", label: "Continue with guidance", consequence: "Wake the agent with your answer." },
      { id: "replan", label: "Replan", consequence: "Wake the agent and ask it to find another approach." }]);
  if (approvalId) raw.prepare("INSERT INTO collab_blocks VALUES(?,?,?)").run(projectId, approvalId, taskId);
  raw.prepare("INSERT INTO task_holds VALUES(?,?,'decision',?,?,?,?,1)")
    .run(projectId, taskId, reason.slice(0, 1000), decisionTask ? "task" : "approval", decisionTask ?? approvalId, deps.clock().toISOString());
  raw.prepare("UPDATE tasks SET revision=revision+1 WHERE project_id=? AND id=?").run(projectId, taskId);
  emit(deps.hub, projectId, taskId, { kind: "task", id: taskId, revision: actor.task.revision + 1 });
  return { ...(decisionTask ? { decisionTaskId: decisionTask } : { approvalId }), instruction: "Stop working; the Host will start a new attempt after the answer." };
}

export function withCollaborationApprovalEffects(decide: HandlerMap["approvals.decide"]): HandlerMap["approvals.decide"] {
  return (ctx, command) => {
    const projectId = command.projectId;
    const proposal = ctx.raw.prepare(`SELECT s.id,s.revision FROM collab_proposals p JOIN seats s ON s.id=p.agent_id
      WHERE p.project_id=? AND p.approval_id=? AND s.status='pending-approval'`)
      .get(projectId, command.payload.approvalId) as { id: string; revision: number } | undefined;
    const result = decide(ctx, command);
    if (proposal) {
      const revision = ctx.raw.prepare("SELECT revision FROM seats WHERE id=?").pluck().get(proposal.id) as number;
      if (revision !== proposal.revision) result.effects.push({ kind: "seat", id: proposal.id, revision });
    }
    return result;
  };
}

export function createCollaborationMcp(deps: Deps) {
  const { raw, hub } = deps;
  const createAgent = withAgentLibraryScope(createAgentHandlers()["agents.create"]);
  return { call(grant: TokenGrant, name: Tool, args: unknown): ToolResult {
    const reply = (value: unknown, isError = false): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value) }], isError });
    try {
      const value = hub.transaction(() => {
        const now = deps.clock();
        assertActiveGrant(raw, grant, now);
        if (grant.expiresAt <= now.getTime()) return deny("attempt is not active");
        const { projectId, taskId } = grant;
        if (name === "task.result") {
          const actor = actorFor(raw, grant, now);
          const input = parse(name, args);
          const assignment = raw.prepare("SELECT kind FROM collab_assignments WHERE project_id=? AND task_id=?").get(projectId, taskId) as { kind: string } | undefined;
          const result = "result" in input ? input.result : input;
          if (assignment?.kind === "review" && !reviewVerdictSchema.safeParse(result).success) return deny("invalid verdict");
          if (actor.task.holds.some(({ kind }) => kind === "decision")) return deny("task is blocked");
          const flowTask = raw.prepare("SELECT 1 FROM flow_tasks WHERE project_id=? AND task_id=?").get(projectId, taskId);
          saveTaskResult(raw, projectId, taskId, grant.attemptId, result, Boolean(assignment) || !flowTask);
          workflowChanged(raw, projectId);
          return { recorded: true };
        }
        const actor = actorFor(raw, grant, now);
        if (actor.task.holds.some(({ kind }) => kind === "decision")) return deny("task is blocked");
        switch (name) {
          case "agent.directory":
            parse(name, args);
            return { agents: targets(raw, actor).map((seat) => ({ id: seat.id, name: seat.name, role: seat.role,
              tags: currentAgentConfig(raw, seat.id)?.config.tags ?? [], status: agentLoad(raw, projectId, seat.id) > 0 ? "busy" : "idle" })) };
          case "task.create": {
            const input = parse(name, args);
            return insertAssignment(deps, actor, findTarget(raw, actor, input.target), { ...input, kind: "delegation" });
          }
          case "task.depend": {
            const { added, task } = depend(raw, actor, parse(name, args));
            if (added) emit(hub, projectId, taskId, { kind: "task", id: task.id, revision: task.revision + 1 });
            return { added };
          }
          case "task.comment": return comment(deps, actor, parse(name, args));
          case "task.request-review": {
            const input = parse(name, args);
            const allowed = new Set([...actor.task.inputs.map((ref) => `${ref.artifactId}/${ref.version}`),
              ...listTaskArtifacts(raw, projectId, taskId).flatMap((artifact) => artifact.versions.map((version) => `${artifact.artifactId}/${version.version}`))]);
            if (!input.artifacts.every((ref) => allowed.has(`${ref.artifactId}/${ref.version}`))) return deny("not_allowed");
            return insertAssignment(deps, actor, findTarget(raw, actor, input.reviewer, true), { kind: "review", artifacts: input.artifacts,
              estimateTokens: input.estimateTokens, title: `Review: ${actor.task.title}`.slice(0, 160), goal: "Review the supplied artifacts.",
              brief: `Review the supplied artifacts without modifying them. Use task.result with verdict approved or changes-requested and notes. ${input.notes}` });
          }
          case "task.block": return block(deps, actor, parse(name, args));
          case "agent.propose": {
            const { config, reason } = parse(name, args);
            if (!actor.config.delegation.canProposeAgents) return deny("not_allowed");
            const agentId = deps.newId();
            const { effects } = createAgent({ ...deps, actorId: actor.agentId }, { apiVersion: API_VERSION,
              commandId: agentId, projectId, type: "agents.create", payload: { agentId, config, isLead: false, teamIds: [] } });
            const { revision } = raw.prepare("UPDATE seats SET status='pending-approval',revision=revision+1 WHERE id=? RETURNING revision")
              .get(agentId) as { revision: number };
            const approvalId = approval(deps, actor, `Proposed agent: ${clean(config.name)}`.slice(0, 160), clean(reason),
              [{ id: "approve", label: "Approve", consequence: "Activate the proposed agent." },
                { id: "reject", label: "Reject", consequence: "Archive the proposed agent without activating it." }]);
            raw.prepare("INSERT INTO collab_proposals VALUES(?,?,?)").run(projectId, approvalId, agentId);
            for (const effect of effects) emit(hub, projectId, taskId, effect.id === agentId ? { ...effect, revision } : effect);
            return { agentId, approvalId };
          }
        }
      });
      if (name === "task.block") setTimeout(() => { void deps.dispatcher.parkAttempt(grant).catch(() => console.error("Collaboration parking failed")); }, 50).unref();
      return reply(value);
    } catch (error) {
      return reply({ reason: error instanceof CommandError || error instanceof McpToolError ? error.message : "collaboration command failed" }, true);
    }
  } };
}
