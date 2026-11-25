import type { Database } from "better-sqlite3";
import { API_VERSION, artifactRefSchema, idSchema, isTerminalFlowRunState, type FlowDefinition, type FlowEdge, type FlowNode, type Seat } from "@factory/contracts";
import { approvalsDecideHandler, publicApprovalText } from "../approvals/service.js";
import { listTaskArtifacts } from "../artifacts/service.js";
import { DocumentError, registerUpload, uploadQuerySchema } from "../artifacts/uploads.js";
import { CommandError } from "../commands/errors.js";
import { startTask } from "../dispatch/advance.js";
import { listAttempts, liveAttemptOfTask } from "../dispatch/attempts.js";
import { moveTask } from "../dispatch/tasks.js";
import { isTerminalTask } from "../collab/policy.js";
import { createNotification, notificationKey } from "../notify/service.js";
import { getTask, tasksCreateHandler } from "../work/service.js";
import { withoutWorkflowAdvancement } from "./lifecycle.js";
import { advanceRun, arm, insertRun, runOutputs, type FlowEngineDeps } from "./engine.js";
import { matchesSchema, readPath, render } from "./expressions.js";
import { boundedJson, decode, definitionOf, emit, flowByKey, getRun, getVersion, hash, latestNodes, type NodeRow, type RunRow } from "./store.js";
import { activeAgents, chooseAgent as choose } from "./selector.js";

export type NodeOutcome =
  | { kind: "done"; port: string | null; output: unknown; pinned?: boolean }
  | { kind: "waiting"; patch: Partial<NodeRow> }
  | { kind: "failed"; error: string; retryable?: boolean; errorPort?: boolean };

const httpCaller = (run: RunRow, row: NodeRow) => `flow:${run.id}:${row.node_id}:${row.iteration}`;
function renderHttpArgs(source: string, context: unknown, missing: Set<string>): unknown {
  const exact = /^\s*\{\{\s*([^{}\s]+)\s*\}\}\s*$/;
  const whole = exact.exec(source)?.[1];
  if (whole) {
    const value = readPath(context, whole);
    if (value === undefined) missing.add(whole);
    return typeof value === "string" ? JSON.parse(value) : value;
  }
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, walk(entry)]));
    if (typeof value !== "string") return value;
    const path = exact.exec(value)?.[1];
    if (!path) return render(value, context, missing);
    const resolved = readPath(context, path);
    if (resolved === undefined) missing.add(path);
    return resolved;
  };
  return walk(JSON.parse(source));
}

export { activeAgents } from "./selector.js";

function makeTask(deps: FlowEngineDeps, run: RunRow, row: NodeRow, owner: Seat, spec: {
  title: string; brief: string; acceptance: string[]; parent?: string; inputs?: Array<{ artifactId: string; version: number }>;
  role?: "agent" | "subtask" | "orchestrator"; human?: boolean;
}): string {
  const { raw, hub, clock, newId } = deps;
  const taskId = newId();
  const serial = raw.prepare("SELECT COALESCE(MAX(CAST(substr(code,4) AS INTEGER)),0)+1 AS next FROM tasks WHERE project_id=? AND code LIKE 'FL-%'")
    .get(run.project_id) as { next: number };
  if (serial.next > 999999) throw new CommandError("resource-exhausted", "flow task codes exhausted", "contact-host");
  const engagement = raw.prepare("SELECT id FROM engagements WHERE project_id=? AND team_id=? AND state='active' ORDER BY priority DESC,id LIMIT 1")
    .get(run.project_id, owner.teamId) as { id: string } | undefined;
  if (!engagement) throw new CommandError("validation", "selected agent has no active engagement", "correct-input");
  const title = spec.title.trim().slice(0, 160) || row.node_id;
  const brief = spec.brief.slice(0, 32000) || title;
  tasksCreateHandler({ raw, hub, clock, newId, actorId: "flow" }, {
    apiVersion: API_VERSION, commandId: taskId, projectId: run.project_id, type: "tasks.create", payload: {
      taskId, code: `FL-${String(serial.next).padStart(3, "0")}`, title, goal: brief.slice(0, 500), brief,
      parentTaskId: spec.parent ?? null, engagementId: engagement.id, ownerSeatId: owner.id, requiredCapabilities: [],
      placement: "portable", sideEffect: "none", reviewPolicy: spec.human ? "human-final" : "automatic", requiresGo: false,
      acceptance: spec.acceptance.map((text) => text.trim().slice(0, 500) || "Hoàn thành task"), inputs: spec.inputs ?? [], dependsOn: [],
    },
  });
  raw.prepare("INSERT INTO flow_tasks VALUES(?,?,?,?,?,?)").run(run.project_id, taskId, run.id, row.node_id, row.iteration, spec.role ?? "agent");
  const task = withoutWorkflowAdvancement(raw, () => {
    moveTask(raw, run.project_id, taskId, "accepted");
    const ready = moveTask(raw, run.project_id, taskId, "ready");
    return deps.dispatcher ? startTask(raw, run.project_id, taskId, { dispatcher: deps.dispatcher }).task : ready;
  });
  emit(hub, run.project_id, run.id, { kind: "task", id: taskId, revision: task.revision });
  return taskId;
}

function approver(deps: FlowEngineDeps, run: RunRow, item: Extract<FlowNode, { type: "approval" }>, fired: FlowEdge[]): Seat | undefined {
  if (item.approver === "operator") return;
  if (typeof item.approver === "object") return choose(deps.raw, run.project_id, item.approver.agent);
  const def = definitionOf(run.definition_json);
  const rows = latestNodes(deps.raw, run);
  const upstream = fired.map((edge) => edge.from.node);
  const seen = new Set<string>();
  for (const id of upstream) {
    if (seen.has(id)) continue;
    seen.add(id);
    const taskId = rows.get(id)?.task_id;
    const owner = taskId && getTask(deps.raw, run.project_id, taskId)?.ownerSeatId;
    if (owner) {
      const candidates = deps.raw.prepare("SELECT from_agent_id AS id FROM agent_relations WHERE project_id=? AND to_agent_id=? AND kind='approves' ORDER BY id")
        .all(run.project_id, owner) as { id: string }[];
      const seat = activeAgents(deps.raw, run.project_id).find((candidate) => candidates.some(({ id: agentId }) => agentId === candidate.id));
      if (seat) return seat;
    }
    for (const edge of def.edges) if (!edge.loopBack && edge.to.node === id && rows.get(edge.from.node)?.port === edge.from.port) upstream.push(edge.from.node);
  }
}

function createApproval(deps: FlowEngineDeps, run: RunRow, row: NodeRow, item: Extract<FlowNode, { type: "approval" }>,
  context: unknown, fired: FlowEdge[], missing: Set<string>): NodeOutcome {
  const seat = approver(deps, run, item, fired);
  if (!seat && typeof item.approver === "object") return { kind: "failed", error: "no agent matches approver" };
  const id = deps.newId();
  const prompt = publicApprovalText(render(item.prompt, context, missing)).slice(0, 4000) || item.title;
  const requested = deps.clock();
  const expiry = new Date(requested.getTime() + (item.timeoutMinutes ?? 10080) * 60000).toISOString();
  const options = [{ id: "approve", label: "Duyệt", consequence: "Workflow đi tiếp theo branch duyệt" },
    { id: "reject", label: "Từ chối", consequence: "Workflow đi theo branch từ chối" }];
  deps.raw.prepare(`INSERT INTO approvals(project_id,id,revision,kind,task_id,subject,summary,options_json,recommendation,impact_if_waiting,context_digest,approver,requested_at,expires_at,state)
    VALUES(?,?,1,'question',NULL,?,?,?,NULL,'Workflow đang chờ quyết định này',?,?,?,?,'pending')`).run(run.project_id, id, item.title, prompt,
    JSON.stringify(options), hash(JSON.stringify({ id, prompt, options })), seat ? "team-lead" : "operator", requested.toISOString(), expiry);
  const patch: Partial<NodeRow> = { approval_id: id };
  if (seat) {
    deps.raw.prepare("INSERT INTO flow_approvers VALUES(?,?,?)").run(run.project_id, id, seat.id);
    patch.task_id = makeTask(deps, run, row, seat, { title: item.title,
      brief: `${prompt}\nBáo quyết định bằng tool task.result với {"verdict":"approve"} (duyệt) hoặc {"verdict":"reject"} (từ chối).`, acceptance: ["Báo quyết định duyệt hoặc từ chối"], role: "subtask" });
  }
  emit(deps.hub, run.project_id, run.id, { kind: "approval", id, revision: 1 });
  arm(deps, run, row, "approval-timeout", expiry);
  return { kind: "waiting", patch };
}

function taskOutput(deps: FlowEngineDeps, projectId: string, taskId: string, latestReport = false) {
  const attempt = listAttempts(deps.raw, projectId, taskId).at(-1);
  const submission = attempt && deps.raw.prepare(`SELECT json_extract(body_json,'$.summary') AS summary FROM attempt_events
    WHERE project_id=? AND attempt_id=? AND kind='state' AND json_extract(body_json,'$.to')='submitting' ORDER BY seq DESC LIMIT 1`)
    .get(projectId, attempt.id) as { summary?: string } | undefined;
  const reported = (latestReport ? latestTaskResult(deps.raw, projectId, taskId)
    : attempt && deps.raw.prepare("SELECT result_json FROM flow_task_results WHERE project_id=? AND attempt_id=?").get(projectId, attempt.id)) as { result_json: string } | undefined;
  const artifacts = listTaskArtifacts(deps.raw, projectId, taskId).flatMap(({ artifactId, kind, versions }) =>
    versions[0] ? [{ artifactId, version: versions[0].version, kind, status: versions[0].status }] : []);
  return { summary: typeof submission?.summary === "string" ? publicApprovalText(submission.summary).slice(0, 4000) : null,
    artifacts, result: reported ? decode(reported.result_json) : null };
}

function taskFailure(deps: FlowEngineDeps, run: RunRow, taskId: string, state: string): NodeOutcome {
  const attempt = listAttempts(deps.raw, run.project_id, taskId).at(-1);
  const failure = attempt && deps.raw.prepare(`SELECT json_extract(body_json,'$.kind') AS kind FROM attempt_events
    WHERE project_id=? AND attempt_id=? AND kind='state' AND json_extract(body_json,'$.to')='failed' ORDER BY seq DESC LIMIT 1`)
    .get(run.project_id, attempt.id) as { kind?: string } | undefined;
  const kind = failure?.kind;
  const retryable = state === "failed" && attempt?.state === "failed" && (kind === "runtime" || kind === "timeout" || kind === "model");
  return { kind: "failed", error: retryable ? `${kind} failure` : `task ${state}`, retryable };
}

export function executeWork(deps: FlowEngineDeps, run: RunRow, def: FlowDefinition,
  item: Exclude<FlowNode, { type: "trigger" | "condition" | "join" | "loop" | "output" }>, row: NodeRow,
  context: unknown, fired: FlowEdge[], missing: Set<string>): NodeOutcome {
  const done = (output: unknown): NodeOutcome => ({ kind: "done", port: "out", output });
  switch (item.type) {
    case "wait": {
      if ("event" in item.wait) return { kind: "failed", error: "event waits arrive later" };
      const due = "for" in item.wait ? new Date(deps.clock().getTime() + item.wait.for * 60000) : new Date(item.wait.until);
      if (due <= deps.clock()) return done(null);
      arm(deps, run, row, "wait", due.toISOString());
      return { kind: "waiting", patch: {} };
    }
    case "approval": return createApproval(deps, run, row, item, context, fired, missing);
    case "parallel": return { kind: "failed", error: "parallel forEach arrives later" };
    case "orchestrate": {
      const errorPort = def.edges.some((edge) => edge.from.node === item.id && edge.from.port === "error");
      const lead = choose(deps.raw, run.project_id, item.lead);
      if (!lead) return { kind: "failed", error: "no agent matches orchestrator lead", errorPort };
      const goal = render(item.goal, context, missing);
      const limits = { allowed: item.allowed, maxTasks: item.maxTasks, maxDepth: item.maxDepth, budgetTokens: item.budgetTokens };
      try {
        const taskId = makeTask(deps, run, row, lead, { title: item.title, role: "orchestrator", acceptance: [],
          brief: `${goal.slice(0, 27000)}\n\nDelegation limits: ${JSON.stringify(limits)}. Use agent.directory, task.create and task.depend. Report your final answer with task.result. You may finish an attempt while waiting for subtasks; their outcomes will wake you.` });
        deps.raw.prepare(`INSERT INTO collab_orchestrators(project_id,task_id,run_id,node_id,iteration,attempt_no,goal,allowed_json,max_tasks,max_depth,budget_tokens)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
          .run(run.project_id, taskId, run.id, row.node_id, row.iteration, row.attempt_no, goal, JSON.stringify(item.allowed), item.maxTasks, item.maxDepth, item.budgetTokens ?? null);
        deps.raw.prepare("UPDATE tasks SET node_run_id=? WHERE project_id=? AND id=?").run(taskId, run.project_id, taskId);
        return { kind: "waiting", patch: { task_id: taskId } };
      } catch (error) {
        if (error instanceof CommandError) return { kind: "failed", error: error.message, errorPort };
        throw error;
      }
    }
    case "action": {
      const params = Object.fromEntries(Object.entries(item.params).map(([key, value]) => [key,
        typeof value === "string" && !(item.action === "http.request" && key === "args") ? render(value, context, missing) : value]));
      if (item.action === "http.request") {
        if (!deps.httpAction) return { kind: "failed", error: "action not available yet" };
        if (missing.size) return { kind: "failed", error: "HTTP request template input is missing" };
        const integration = deps.httpAction.store.forProject(run.project_id).find((entry) => entry.name === params.integration || entry.id === params.integration);
        if (integration?.kind !== "http-api") return { kind: "failed", error: "HTTP integration not found in project scope" };
        const operation = integration.config.operations.find((entry) => entry.name === params.operation);
        if (!operation) return { kind: "failed", error: "HTTP operation not found" };
        try {
          const args = params.args === undefined ? {} : typeof params.args === "string" ? renderHttpArgs(params.args, context, missing) : params.args;
          if (missing.size) return { kind: "failed", error: "HTTP request template input is missing" };
          const advance = () => { if (deps.raw.open) advanceRun(deps, run.project_id, run.id); };
          void deps.httpAction.effects.submit({ projectId: run.project_id, caller: httpCaller(run, row), nodeAttempt: row.attempt_no,
            integration, operation, args, beforeSend: () => {
              const node = deps.raw.prepare(`SELECT 1 FROM flow_node_runs n JOIN flow_runs r ON r.project_id=n.project_id AND r.id=n.run_id
                WHERE n.project_id=? AND n.run_id=? AND n.node_id=? AND n.iteration=? AND n.attempt_no=?
                AND n.state='waiting' AND r.state IN ('running','waiting','paused')`).get(run.project_id, run.id, row.node_id, row.iteration, row.attempt_no);
              if (!node) throw new Error("HTTP node is no longer active");
            } })
            .then(advance, advance).catch(() => {});
          return { kind: "waiting", patch: {} };
        } catch { return { kind: "failed", error: "Invalid HTTP request arguments" }; }
      }
      if (item.action === "notify.send") {
        const id = deps.newId();
        const { created } = createNotification(deps.raw, { projectId: run.project_id, dedupKey: notificationKey("flow", run.id, row.node_id, row.iteration, row.attempt_no),
          category: "important", urgency: "normal", title: String(params.title ?? item.title), body: String(params.body ?? params.message ?? ""),
          now: deps.clock(), id, entity: { kind: "flow-run", id: run.id } });
        if (created) emit(deps.hub, run.project_id, run.id, { kind: "notification", id, revision: 1 });
        return done({ notificationId: id });
      }
      if (item.action !== "artifact.save") return { kind: "failed", error: "action not available yet" };
      if (!deps.upload) return { kind: "failed", error: "artifact service unavailable" };
      if (params.content === undefined) return { kind: "failed", error: "artifact content is required" };
      try {
        const result = registerUpload({ ...deps.upload, raw: deps.raw, hub: deps.hub, now: deps.clock }, run.project_id,
          uploadQuerySchema.parse({ filename: `${row.node_id}.txt`, title: String(params.title ?? item.title).slice(0, 200) }), "text/plain", Buffer.from(String(params.content)));
        return done({ artifacts: [result] });
      } catch (error) {
        if (error instanceof DocumentError) return { kind: "failed", error: "artifact could not be saved" };
        throw error;
      }
    }
    case "agent": {
      const owner = choose(deps.raw, run.project_id, item.agent);
      if (!owner) return { kind: "failed", error: "no agent matches" };
      const inputs = new Map<string, { artifactId: string; version: number }>();
      const notes: string[] = [];
      for (const path of item.task.inputs) {
        const value = readPath(context, path);
        if (value === undefined) { missing.add(path); continue; }
        for (const entry of Array.isArray(value) ? value : [value]) {
          const ref = artifactRefSchema.safeParse({ artifactId: readPath(entry, "artifactId"), version: readPath(entry, "version") });
          if (ref.success) inputs.set(`${ref.data.artifactId}:${ref.data.version}`, ref.data);
          else if (idSchema.safeParse(entry).success) {
            const version = deps.raw.prepare(`SELECT version FROM artifact_versions WHERE project_id=? AND artifact_id=? AND status NOT IN ('withdrawn','rejected') ORDER BY version DESC LIMIT 1`)
              .get(run.project_id, entry) as { version: number } | undefined;
            if (version) inputs.set(`${entry}:${version.version}`, { artifactId: entry as string, version: version.version });
            else notes.push(`${path}: ${JSON.stringify(entry)}`);
          } else notes.push(`${path}: ${JSON.stringify(entry)}`);
        }
      }
      const authoring = item.outputSchema ? `\nReport the structured result with task.result. Schema: ${JSON.stringify(item.outputSchema)}` : "";
      const taskId = makeTask(deps, run, row, owner, { title: render(item.task.title, context, missing),
        brief: `${render(item.task.instructions, context, missing)}${authoring}${notes.length ? `\nInputs:\n${notes.join("\n")}` : ""}`,
        acceptance: item.task.acceptance.map((text) => render(text, context, missing)), inputs: [...inputs.values()].slice(0, 100), human: item.review === "human" });
      return { kind: "waiting", patch: { task_id: taskId } };
    }
    case "subflow": {
      const flow = flowByKey(deps.raw, run.project_id, item.workflow);
      const version = flow && getVersion(deps.raw, run.project_id, flow.id, item.version === "published" ? undefined : item.version);
      const errorPort = def.edges.some((edge) => edge.from.node === item.id && edge.from.port === "error");
      if (!flow || !version) return { kind: "failed", error: "sub-workflow not found", errorPort };
      if (run.depth >= 3) return { kind: "failed", error: "sub-workflow depth exceeded", errorPort };
      const inputs = Object.fromEntries(Object.entries(item.inputs).map(([key, template]) => {
        const path = /^\{\{\s*([^{}]+?)\s*\}\}$/.exec(template)?.[1];
        return [key, (path && readPath(context, path)) ?? render(template, context, missing)];
      }));
      let child: RunRow;
      try { child = insertRun(deps, flow, { id: deps.newId(), version, test: Boolean(run.test), mockAgents: Boolean(run.mock_agents),
        trigger: "subflow", parent: { run, nodeId: row.node_id }, inputs }); }
      catch (error) {
        if (error instanceof CommandError) return { kind: "failed", error: error.message, errorPort };
        throw error;
      }
      advanceRun(deps, run.project_id, child.id);
      return { kind: "waiting", patch: { child_run_id: child.id } };
    }
  }
}

export function syncWork(deps: FlowEngineDeps, run: RunRow, def: FlowDefinition, item: FlowNode, row: NodeRow): NodeOutcome | null {
  if (item.type === "action" && item.action === "http.request") {
    const effect = deps.httpAction?.effects.latest(run.project_id, httpCaller(run, row));
    if (!effect || effect.state === "pending" || effect.state === "unknown") return null;
    return effect.state === "done" ? { kind: "done", port: "out", output: effect.output }
      : { kind: "failed", error: effect.error ?? "HTTP request failed" };
  }
  if (item.type === "orchestrate" && row.task_id) {
    const task = getTask(deps.raw, run.project_id, row.task_id);
    if (!task) return { kind: "failed", error: "orchestrator task not found" };
    if (isTerminalTask(task.state) && task.state !== "done") return taskFailure(deps, run, task.id, task.state);
    const subtasks = deps.raw.prepare("SELECT id,state FROM tasks WHERE project_id=? AND node_run_id=? AND id<>? ORDER BY code,id")
      .all(run.project_id, task.id, task.id) as { id: string; state: string }[];
    if (!latestTaskResult(deps.raw, run.project_id, task.id) || subtasks.some((subtask) => !isTerminalTask(subtask.state))
      || liveAttemptOfTask(deps.raw, run.project_id, task.id) || task.holds.length || deps.raw.prepare(
        "SELECT 1 FROM collab_orchestrators WHERE project_id=? AND task_id=? AND failure_pending=1").get(run.project_id, task.id)) return null;
    if (task.state === "in-review") {
      const completed = moveTask(deps.raw, run.project_id, task.id, "done");
      emit(deps.hub, run.project_id, run.id, { kind: "task", id: task.id, revision: completed.revision });
    } else if (task.state !== "done") return null;
    const { result } = taskOutput(deps, run.project_id, task.id, true);
    return { kind: "done", port: "out", output: { result, subtasks: subtasks.map(({ id, state }) => ({ taskId: id, state,
      artifacts: taskOutput(deps, run.project_id, id).artifacts })) } };
  }
  if (row.approval_id) {
    const approval = deps.raw.prepare("SELECT state,outcome_option_id,revision,context_digest,expires_at FROM approvals WHERE project_id=? AND id=?")
      .get(run.project_id, row.approval_id) as { state: string; outcome_option_id: string | null; revision: number; context_digest: string; expires_at: string } | undefined;
    if (!approval || approval.state === "withdrawn") return { kind: "failed", error: "approval withdrawn" };
    if (approval.state === "expired") return { kind: "done", port: "timeout", output: null };
    if (approval.outcome_option_id) return { kind: "done", port: approval.outcome_option_id === "approve" ? "approved" : "rejected", output: { decision: approval.outcome_option_id } };
    if (!row.task_id || Date.parse(approval.expires_at) <= deps.clock().getTime()) return null;
    const task = getTask(deps.raw, run.project_id, row.task_id);
    if (task && ["failed", "cancelled", "declined"].includes(task.state)) return taskFailure(deps, run, task.id, task.state);
    if (task?.state !== "done") return null;
    const verdict = readPath(taskOutput(deps, run.project_id, task.id).result, "verdict");
    if (verdict !== "approve" && verdict !== "reject") return { kind: "failed", error: "approver did not report a decision" };
    const result = withoutWorkflowAdvancement(deps.raw, () => approvalsDecideHandler({ ...deps, actorId: task.ownerSeatId ?? "flow" }, {
      apiVersion: API_VERSION, projectId: run.project_id, commandId: deps.newId(), type: "approvals.decide", payload: {
        approvalId: row.approval_id!, expectedRevision: approval.revision, contextDigest: approval.context_digest, optionId: verdict, comment: "Quyết định của agent",
      },
    }));
    for (const entity of result.effects) emit(deps.hub, run.project_id, run.id, entity);
    return { kind: "done", port: verdict === "approve" ? "approved" : "rejected", output: { decision: verdict } };
  }
  if (row.child_run_id) {
    const child = getRun(deps.raw, run.project_id, row.child_run_id);
    if (!child || !isTerminalFlowRunState(child.state)) return null;
    return child.state === "succeeded" ? { kind: "done", port: "out", output: runOutputs(deps.raw, child) }
      : { kind: "failed", error: "child run failed", errorPort: def.edges.some((edge) => edge.from.node === item.id && edge.from.port === "error") };
  }
  if (!row.task_id || item.type !== "agent") return null;
  const task = getTask(deps.raw, run.project_id, row.task_id);
  if (!task) return { kind: "failed", error: "task not found" };
  if (["failed", "cancelled", "declined"].includes(task.state)) return taskFailure(deps, run, task.id, task.state);
  if (task.state !== "done") return null;
  const output = taskOutput(deps, run.project_id, task.id);
  if (item.outputSchema && !matchesSchema(output.result, item.outputSchema)) return { kind: "failed", error: "task result does not match output schema" };
  if (typeof item.review === "object") {
    const review = deps.raw.prepare("SELECT id FROM tasks WHERE project_id=? AND parent_task_id=? AND EXISTS (SELECT 1 FROM flow_tasks f WHERE f.project_id=tasks.project_id AND f.task_id=tasks.id AND role='subtask')")
      .get(run.project_id, task.id) as { id: string } | undefined;
    if (!review) {
      const reviewer = choose(deps.raw, run.project_id, item.review.agent);
      if (!reviewer) return { kind: "failed", error: "no agent matches reviewer" };
      try {
        makeTask(deps, run, row, reviewer, { title: `Review: ${task.title}`, parent: task.id, role: "subtask",
          brief: `Review ${task.title}. Report {"verdict":"accepted"} or {"verdict":"changes-requested"} using task.result.`,
          acceptance: ["Báo kết luận phản biện"], inputs: output.artifacts.map(({ artifactId, version }) => ({ artifactId, version })) });
      } catch (error) {
        if (error instanceof CommandError) return { kind: "failed", error: error.message };
        throw error;
      }
      return { kind: "waiting", patch: {} };
    }
    const reviewTask = getTask(deps.raw, run.project_id, review.id);
    if (reviewTask && ["failed", "cancelled", "declined"].includes(reviewTask.state)) return taskFailure(deps, run, review.id, reviewTask.state);
    if (reviewTask?.state !== "done") return null;
    const verdict = readPath(taskOutput(deps, run.project_id, review.id).result, "verdict");
    if (verdict !== "accepted") return { kind: "failed", error: verdict === "changes-requested" ? verdict : "reviewer did not report a verdict" };
  }
  const projected = output.result !== null && typeof output.result === "object" && !Array.isArray(output.result) ? output.result : {};
  return { kind: "done", port: "out", output: { ...projected, ...output } };
}

function latestTaskResult(raw: Database, projectId: string, taskId: string): { result_json: string } | undefined {
  return raw.prepare(`SELECT r.result_json FROM flow_task_results r JOIN attempts a ON a.project_id=r.project_id AND a.id=r.attempt_id
    WHERE a.project_id=? AND a.task_id=? ORDER BY a.epoch DESC LIMIT 1`).get(projectId, taskId) as { result_json: string } | undefined;
}

export function saveTaskResult(raw: Database, projectId: string, taskId: string, attemptId: string, result: unknown, collaboration = false): void {
  const row = raw.prepare(`SELECT r.definition_json, f.node_id, f.role FROM flow_tasks f JOIN flow_runs r ON r.project_id=f.project_id AND r.id=f.run_id
    WHERE f.project_id=? AND f.task_id=? AND r.state NOT IN ('failed','succeeded','cancelled')`).get(projectId, taskId) as
    { definition_json: string; node_id: string; role: string } | undefined;
  if (!row && (!collaboration || raw.prepare("SELECT 1 FROM flow_tasks WHERE project_id=? AND task_id=?").get(projectId, taskId)))
    throw new CommandError("validation", "task does not accept a flow result", "correct-input");
  const node = row && definitionOf(row.definition_json).nodes.find(({ id }) => id === row.node_id);
  const verdict = readPath(result, "verdict");
  if (row?.role === "agent" && node?.type === "agent" && node.outputSchema && !matchesSchema(result, node.outputSchema))
    throw new CommandError("validation", "task result does not match output schema", "correct-input");
  if (row?.role === "subtask" && !collaboration && !(node?.type === "approval" ? verdict === "approve" || verdict === "reject" : verdict === "accepted" || verdict === "changes-requested"))
    throw new CommandError("validation", "invalid verdict", "correct-input");
  raw.prepare(`INSERT INTO flow_task_results VALUES(?,?,?) ON CONFLICT(project_id,attempt_id) DO UPDATE SET result_json=excluded.result_json`)
    .run(projectId, attemptId, boundedJson(result, 32768));
}

export function completeFlowTask(deps: FlowEngineDeps, input: { projectId: string; taskId: string }): boolean {
  const task = getTask(deps.raw, input.projectId, input.taskId);
  if (task?.reviewPolicy !== "automatic" || task.state !== "in-review") return false;
  const flowTask = deps.raw.prepare("SELECT role FROM flow_tasks WHERE project_id=? AND task_id=?")
    .get(input.projectId, input.taskId) as { role: string } | undefined;
  if (flowTask?.role === "orchestrator") return true;
  const assignment = deps.raw.prepare("SELECT kind FROM collab_assignments WHERE project_id=? AND task_id=?")
    .get(input.projectId, input.taskId) as { kind: string } | undefined;
  if (!flowTask && !assignment) return false;
  if (assignment && assignment.kind !== "delegation" && !latestTaskResult(deps.raw, input.projectId, input.taskId)) return false;
  return deps.hub.transaction(() => {
    const current = moveTask(deps.raw, input.projectId, input.taskId, "done", { now: deps.clock().toISOString() });
    emit(deps.hub, input.projectId, input.taskId, { kind: "task", id: input.taskId, revision: current.revision });
    return true;
  });
}
