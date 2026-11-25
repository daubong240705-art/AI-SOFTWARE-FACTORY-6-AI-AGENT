import type { AgentSelector } from "./agents.js";
import { bundleDirSchema, bundleQuerySchema, bundleScriptsSchema, flowPathSchema, FLOW_NODE_PORTS, type FlowCondition, type FlowDefinition, type FlowEdge, type FlowNode } from "./flow.js";
import { idSchema } from "./base.js";
import type { HttpOperation } from "./integrations.js";

export interface FlowIssue { code: FlowIssueCode; message: string; node?: string; edge?: string }
export type FlowIssueCode = "no-trigger" | "unknown-node" | "unknown-port" | "unreachable" | "cycle-without-loop"
  | "bad-loop-back" | "join-needs-two-inputs" | "trigger-has-input" | "unknown-path" | "subflow-self"
  | "duplicate-edge" | "output-has-edges" | "agent-not-found" | "budget"
  | "bundle-integration" | "bundle-operation" | "bundle-dir" | "bundle-ref" | "bundle-scripts" | "bundle-query" | "bundle-path-param";
export interface FlowValidationContext {
  /** When provided, every `{ agent: id }` selector must be in this set. */
  agentIds?: ReadonlySet<string>;
  bundleOperations?: (integrationId: string) => readonly HttpOperation[] | undefined;
}

export function isBundleOperation(operation: HttpOperation | undefined): operation is HttpOperation {
  return operation !== undefined && (operation.method === "POST" || operation.method === "PUT") && operation.sideEffect === "external";
}

export function validateBundleParams(params: Extract<FlowNode, { type: "action" }>["params"], context?: FlowValidationContext): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const { integrationId, operation, dir, ref, scripts, query, ...pathParams } = params;
  const id = idSchema.safeParse(integrationId);
  const expression = typeof integrationId === "string" ? /^\{\{\s*([^\s{}]+)\s*\}\}$/.exec(integrationId)?.[1] : undefined;
  const add = (code: FlowIssueCode, message: string) => { issues.push({ code, message }); };
  if (!id.success && !flowPathSchema.safeParse(expression).success) add("bundle-integration", "Use an HTTP integration ID or a flow expression");
  if (typeof operation !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(operation)) add("bundle-operation", "Use an HTTP operation name");
  else if (id.success && context?.bundleOperations) {
    const operations = context.bundleOperations(id.data);
    if (!operations) add("bundle-integration", "HTTP integration not found in project scope");
    else if (!isBundleOperation(operations.find(({ name }) => name === operation))) add("bundle-operation", "Use an external POST or PUT operation");
  }
  if (dir !== undefined && !bundleDirSchema.safeParse(dir).success) add("bundle-dir", "Use a relative bundle directory without traversal");
  if (ref !== undefined && ref !== "integration" && ref !== "main") add("bundle-ref", "Use the integration or main ref");
  if (scripts !== undefined && !bundleScriptsSchema.safeParse(scripts).success) add("bundle-scripts", "Use a list of ci, check, test, or build scripts");
  if (query !== undefined) {
    const templates = bundleQuerySchema.safeParse(query);
    if (!templates.success || Object.values(templates.data).some((template) => [...template.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)]
      .some((match) => match[1] !== "bundle.commit" && !flowPathSchema.safeParse(match[1]).success)))
      add("bundle-query", "Use at most ten query string templates with valid flow paths or bundle.commit");
  }
  if (Object.values(pathParams).some((value) => typeof value === "object")) add("bundle-path-param", "Path parameters must be scalars");
  return issues;
}

export function flowGraph(definition: FlowDefinition): {
  successors(node: string): { edge: string; port: string; to: string }[];
  predecessors(node: string): { edge: string; port: string; from: string }[];
  topologicalOrder(): string[];
} {
  const ids = definition.nodes.map(({ id }) => id);
  const incoming = new Map(ids.map((id) => [id, [] as FlowEdge[]]));
  const outgoing = new Map(ids.map((id) => [id, [] as FlowEdge[]]));
  for (const edge of definition.edges) {
    outgoing.get(edge.from.node)?.push(edge);
    incoming.get(edge.to.node)?.push(edge);
  }
  return {
    successors: (node) => (outgoing.get(node) ?? []).map(({ id, from, to }) => ({ edge: id, port: from.port, to: to.node })),
    predecessors: (node) => (incoming.get(node) ?? []).map(({ id, from }) => ({ edge: id, port: from.port, from: from.node })),
    topologicalOrder: () => {
      const indegree = new Map(ids.map((id) => [id,
        incoming.get(id)?.filter((edge) => !edge.loopBack && outgoing.has(edge.from.node)).length ?? 0,
      ]));
      const ready = ids.filter((id) => indegree.get(id) === 0);
      for (const id of ready) {
        for (const edge of outgoing.get(id) ?? []) {
          const count = indegree.get(edge.to.node);
          if (edge.loopBack || count === undefined) continue;
          indegree.set(edge.to.node, count - 1);
          if (count === 1) ready.push(edge.to.node);
        }
      }
      return ready;
    },
  };
}

function visitCondition(condition: FlowCondition, visitPath: (path: string) => void): void {
  if ("path" in condition) visitPath(condition.path);
  else if ("all" in condition) condition.all.forEach((item) => visitCondition(item, visitPath));
  else if ("any" in condition) condition.any.forEach((item) => visitCondition(item, visitPath));
  else if ("not" in condition) visitCondition(condition.not, visitPath);
}

function visitNode(node: FlowNode, path: (value: string) => void, selector: (value: AgentSelector) => void): void {
  const template = (value: string): void => {
    for (const match of value.matchAll(/\{\{\s*([^\s{}]+)\s*\}\}/g)) {
      const candidate = match[1];
      if (candidate !== undefined && flowPathSchema.safeParse(candidate).success) path(candidate);
    }
  };
  switch (node.type) {
    case "agent":
      selector(node.agent);
      if (typeof node.review === "object") selector(node.review.agent);
      template(node.task.title);
      template(node.task.instructions);
      node.task.inputs.forEach(path);
      break;
    case "action":
      for (const value of Object.values(node.params)) if (typeof value === "string") template(value);
      if (node.action === "bundle.publish") {
        const query = bundleQuerySchema.safeParse(node.params.query);
        if (query.success) Object.values(query.data).forEach(template);
      }
      break;
    case "condition": node.rules.forEach(({ when }) => visitCondition(when, path)); break;
    case "parallel": path(node.forEach); break;
    case "approval":
      if (typeof node.approver === "object") selector(node.approver.agent);
      template(node.prompt);
      break;
    case "loop": if (node.until) visitCondition(node.until, path); break;
    case "subflow": Object.values(node.inputs).forEach(template); break;
    case "orchestrate":
      selector(node.lead);
      node.allowed.forEach(selector);
      template(node.goal);
      break;
    case "output": node.from.forEach(path); break;
  }
}

function walk(roots: string[], successors: (id: string) => string[]): Set<string> {
  const seen = new Set<string>();
  for (const id of roots) {
    if (seen.has(id)) continue;
    seen.add(id);
    roots.push(...successors(id));
  }
  return seen;
}

export function validateFlow(definition: FlowDefinition, context?: FlowValidationContext): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const ports = new Map(definition.nodes.map((node) => [node.id, FLOW_NODE_PORTS(node)]));
  const graph = flowGraph(definition);
  const triggers = definition.nodes.filter(({ type }) => type === "trigger").map(({ id }) => id);
  const forward = new Map<string, FlowEdge[]>();
  for (const edge of definition.edges) {
    if (edge.loopBack || !ports.has(edge.to.node) || !ports.get(edge.from.node)?.includes(edge.from.port)) continue;
    const edges = forward.get(edge.from.node) ?? [];
    edges.push(edge);
    forward.set(edge.from.node, edges);
  }
  const successors = (id: string): string[] => (forward.get(id) ?? []).map(({ to }) => to.node);
  const reachable = walk([...triggers], successors);
  const ordered = new Set(graph.topologicalOrder());
  if (!triggers.length) issues.push({ code: "no-trigger", message: "A flow must have at least one trigger" });

  for (const node of definition.nodes) {
    const incoming = graph.predecessors(node.id).length;
    if (node.type === "trigger" && incoming)
      issues.push({ code: "trigger-has-input", message: "Triggers cannot have incoming edges", node: node.id });
    if (node.type === "join" && incoming < 2)
      issues.push({ code: "join-needs-two-inputs", message: "Join nodes need at least two incoming edges", node: node.id });
    if (node.type === "output" && graph.successors(node.id).length)
      issues.push({ code: "output-has-edges", message: "Output nodes cannot have outgoing edges", node: node.id });
    if (!reachable.has(node.id))
      issues.push({ code: "unreachable", message: "Node is not reachable from a trigger", node: node.id });
    if (!ordered.has(node.id))
      issues.push({ code: "cycle-without-loop", message: "Node is in or downstream of a cycle without a loopBack edge", node: node.id });
    if (node.type === "subflow" && node.workflow === definition.key)
      issues.push({ code: "subflow-self", message: "A subflow cannot reference its own workflow", node: node.id });
    if (node.type === "orchestrate" && node.budgetTokens !== undefined && definition.settings.budgetTokens !== undefined
      && node.budgetTokens > definition.settings.budgetTokens)
      issues.push({ code: "budget", message: "Orchestrate budget exceeds the flow budget", node: node.id });
    if (node.type === "action" && node.action === "bundle.publish")
      issues.push(...validateBundleParams(node.params, context).map((issue) => ({ ...issue, node: node.id })));
    visitNode(node, (path) => {
      const referenced = /^nodes\.([A-Za-z0-9_-]+)/.exec(path)?.[1];
      if (referenced !== undefined && !ports.has(referenced))
        issues.push({ code: "unknown-path", message: `Path ${path} references unknown node ${referenced}`, node: node.id });
    }, (selector) => {
      if (context?.agentIds && "agent" in selector && !context.agentIds.has(selector.agent))
        issues.push({ code: "agent-not-found", message: `Agent ${selector.agent} was not found`, node: node.id });
    });
  }

  const nodeTypes = new Map(definition.nodes.map(({ id, type }) => [id, type]));
  const seen = new Set<string>();
  for (const { id, from, to, loopBack } of definition.edges) {
    const sourcePorts = ports.get(from.node);
    if (!sourcePorts || !ports.has(to.node))
      issues.push({ code: "unknown-node", message: "Edge references an unknown node", edge: id });
    if (sourcePorts && !sourcePorts.includes(from.port))
      issues.push({ code: "unknown-port", message: `Node ${from.node} has no output port ${from.port}`, edge: id, node: from.node });
    const key = `${from.node}/${from.port}/${to.node}`;
    if (seen.has(key)) issues.push({ code: "duplicate-edge", message: "Duplicate edge", edge: id });
    seen.add(key);
    if (loopBack) {
      const body = (forward.get(to.node) ?? []).filter((edge) => edge.from.port === "body").map((edge) => edge.to.node);
      if (nodeTypes.get(to.node) !== "loop" || from.node === to.node || !walk(body, successors).has(from.node))
        issues.push({ code: "bad-loop-back", message: "loopBack must target an ancestor loop via its body port", edge: id });
    }
  }
  return issues;
}
