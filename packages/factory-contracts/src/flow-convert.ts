import type { z } from "zod";
import { flowConditionSchema, flowDefinitionSchema, type FlowCondition, type FlowDefinition } from "./flow.js";
import type { Condition, WorkflowDefinition } from "./workflow.js";

type NodeInput = z.input<typeof flowDefinitionSchema>["nodes"][number];
type Rework = WorkflowDefinition["edges"][number];
type Arc = { from: string; to: string; port: string; loopBack?: boolean };

function convertCondition(condition: Condition, fact?: (leaf: Extract<Condition, { fact: string }>) => FlowCondition | undefined): FlowCondition | undefined {
  if ("param" in condition) return { path: `inputs.${condition.param}`, op: condition.op, value: condition.value };
  if ("fact" in condition) return fact?.(condition);
  if ("not" in condition) {
    const not = convertCondition(condition.not, fact);
    return not && { not };
  }
  const children: FlowCondition[] = [];
  for (const child of "all" in condition ? condition.all : condition.any) {
    const converted = convertCondition(child, fact);
    if (!converted) return undefined;
    children.push(converted);
  }
  return "all" in condition ? { all: children } : { any: children };
}

function negate(condition: FlowCondition): FlowCondition {
  if ("not" in condition) return condition.not;
  if ("all" in condition) return { any: condition.all.map(negate) };
  if ("any" in condition) return { all: condition.any.map(negate) };
  const inverse = { eq: "ne", ne: "eq", lt: "gte", lte: "gt", gt: "lte", gte: "lt" } as const;
  return condition.op === "in" ? { not: condition } : { ...condition, op: inverse[condition.op] };
}

function reachable(start: string, arcs: Arc[], reverse = false): Set<string> {
  const pending = [start];
  const seen = new Set<string>();
  for (const id of pending) {
    if (seen.has(id)) continue;
    seen.add(id);
    for (const arc of arcs) {
      if (!arc.loopBack && (reverse ? arc.to : arc.from) === id) pending.push(reverse ? arc.from : arc.to);
    }
  }
  return seen;
}

export function convertWorkflowV1(v1: WorkflowDefinition): { definition: FlowDefinition; notes: string[] } {
  const notes: string[] = [];
  const nodes: NodeInput[] = [{ id: "start", type: "trigger", title: "Start", trigger: { kind: "manual" } }];
  const usedIds = new Set(["start", "done"]);
  const allocateId = (preferred: string): string => {
    const base = /^[a-z]/.test(preferred) ? preferred : `stage-${preferred}`;
    let id = base.slice(0, 40);
    for (let attempt = 2; usedIds.has(id); attempt++) {
      const suffix = `-${attempt}`;
      id = base.slice(0, 40 - suffix.length) + suffix;
    }
    usedIds.add(id);
    return id;
  };
  const stageIds = new Map(v1.stages.map(({ key }) => {
    const id = allocateId(key);
    if (id !== key) notes.push(`Stage ${key} uses node id ${id}.`);
    return [key, id];
  }));
  const entries = new Map<string, string>();
  const bypass = new Map<string, string>();
  const wrapperArcs: Arc[] = [];
  const firstString = v1.parameters.find(({ type }) => type === "string");

  for (const stage of v1.stages) {
    const id = stageIds.get(stage.key)!;
    const tags = stage.requiredCapabilities.length ? stage.requiredCapabilities : ["general"];
    if (!stage.requiredCapabilities.length) notes.push(`Stage ${stage.key} has a gate but no capabilities; using the general tag.`);
    nodes.push({ id, type: "agent", title: stage.title, agent: { tags }, task: {
      title: stage.title, instructions: firstString ? `{{ inputs.${firstString.name} }}` : "",
      acceptance: stage.acceptance?.length ? stage.acceptance : ["Register the stage output as an artifact"], inputs: [],
    }, review: stage.review === "automatic" ? "none" : "human" });

    let entry = id;
    const conditionNode = (suffix: string, rules: { when: FlowCondition; port: string }[]): string => {
      const conditionId = allocateId(`${stage.key}-${suffix}`);
      nodes.push({ id: conditionId, type: "condition", title: `Check ${stage.title}`.slice(0, 160), rules });
      return conditionId;
    };
    const gates = v1.gates.filter(({ before }) => before === stage.key);
    for (const gate of gates.reverse()) {
      const gateId = allocateId(`${stage.key}-gate`);
      nodes.push({ id: gateId, type: "approval", title: `Approve ${stage.title}`.slice(0, 160), approver: "operator", prompt: `Approve ${stage.title}` });
      wrapperArcs.push({ from: gateId, port: "approved", to: entry });
      notes.push(`Gate ${gateId} has no rejected path; rejection ends the branch.`);
      const when = gate.when && convertCondition(gate.when);
      if (when) {
        const check = conditionNode("gate-if", [{ when, port: "approve" }]);
        wrapperArcs.push({ from: check, port: "approve", to: gateId }, { from: check, port: "else", to: entry });
        entry = check;
      } else {
        if (gate.when) notes.push(`Gate ${gateId} uses facts; approval is unconditional.`);
        entry = gateId;
      }
    }

    const include = stage.includeIf && convertCondition(stage.includeIf);
    const skip = stage.skipIf && convertCondition(stage.skipIf);
    if ((stage.includeIf && !include) || (stage.skipIf && !skip)) {
      notes.push(`Stage ${stage.key} uses facts in includeIf/skipIf; the stage is always included.`);
    } else if (include || skip) {
      const when = skip ? (include ? { all: [include, negate(skip)] } : negate(skip)) : include!;
      const check = conditionNode("if", [{ when, port: "include" }]);
      wrapperArcs.push({ from: check, port: "include", to: entry });
      bypass.set(id, check);
      entry = check;
    }
    entries.set(id, entry);
  }

  let arcs: Arc[] = [];
  const reworks = new Map<string, Rework[]>();
  for (const edge of v1.edges) {
    const from = stageIds.get(edge.from);
    const to = stageIds.get(edge.to);
    if (edge.type === "informs" || from === undefined || to === undefined) {
      notes.push(`Dropped ${edge.type} edge ${edge.from} -> ${edge.to}.`);
    } else if (edge.type === "rework") {
      const group = reworks.get(to) ?? [];
      group.push(edge);
      reworks.set(to, group);
    } else {
      arcs.push({ from, to, port: "out" });
      if (edge.type === "artifact-approved") notes.push(`Artifact approval ${edge.from} -> ${edge.to} becomes the source stage review.`);
    }
  }

  const stageArcs = arcs;
  for (const join of v1.joins) {
    const members = v1.stages.filter(({ parallelGroup }) => parallelGroup === join.group).map(({ key }) => stageIds.get(key)!);
    if (members.length < 2) {
      notes.push(`Skipped join ${join.group}: fewer than two members.`);
      continue;
    }
    const id = allocateId(`${join.group}-join`);
    const reachableFromMembers = members.map((member) => reachable(member, stageArcs));
    const targets = new Set(arcs.filter(({ from, to }) => members.includes(from) && !members.includes(to)
      && reachableFromMembers.every((reachableNodes) => reachableNodes.has(to))).map(({ to }) => to));
    nodes.push({ id, type: "join", title: `${join.group} join`, policy: join.policy === "quorum" ? { quorum: Math.min(join.n ?? 1, 16) } : join.policy });
    if (join.n !== undefined && join.n > 16) notes.push(`Join ${join.group} quorum was reduced to 16.`);
    arcs = arcs.filter(({ from, to }) => !members.includes(from) || !targets.has(to));
    for (const from of members) arcs.push({ from, to: id, port: "out" });
    for (const to of targets) arcs.push({ from: id, to, port: "out" });
  }

  const stageOrder = [...stageIds.values()];
  const outputFrom = stageOrder.filter((id) => !stageArcs.some(({ from }) => from === id)).at(-1) ?? stageOrder.at(-1)!;
  const incoming = new Set(arcs.map(({ to }) => to));
  const outgoing = new Set(arcs.map(({ from }) => from));
  for (const id of stageOrder) if (!incoming.has(id)) arcs.push({ from: "start", to: id, port: "out" });
  for (const { id, type } of nodes) if ((type === "agent" || type === "join") && !outgoing.has(id)) {
    arcs.push({ from: id, to: "done", port: "out" });
  }

  for (const [target, edges] of reworks) {
    const descendants = reachable(target, arcs);
    const backEdges = edges.filter(({ from, to }) => {
      const usable = descendants.has(stageIds.get(from)!);
      if (!usable) notes.push(`Dropped rework ${from} -> ${to}: no forward path from target to source.`);
      return usable;
    });
    if (!backEdges.length) continue;
    const loop = allocateId(`${target}-rework`);
    const limits = backEdges.map(({ maxLoops }) => maxLoops ?? 1);
    const maxIterations = Math.min(...limits);
    if (limits.some((limit) => limit !== maxIterations)) notes.push(`Rework ${target} uses the smallest iteration limit (${maxIterations}).`);
    const verdictChecks = new Map<string, FlowCondition[]>();
    const conditions = backEdges.map(({ from, when }) => {
      if (!when) return undefined;
      let usesVerdict = false;
      const condition = convertCondition(when, (leaf) => {
        if (leaf.fact !== "review.verdict" && leaf.fact !== "check.result") return undefined;
        const id = stageIds.get(leaf.stage ?? from);
        const agent = nodes.find((node): node is Extract<NodeInput, { type: "agent" }> => node.id === id && node.type === "agent");
        if (!agent) return undefined;
        usesVerdict = true;
        const value = Array.isArray(leaf.value) ? leaf.value[0] : leaf.value;
        agent.outputSchema = { type: "object", properties: { verdict: { type: typeof value === "boolean" ? "boolean" :
          typeof value === "number" ? "number" : "string" } }, required: ["verdict"] };
        return { path: `nodes.${agent.id}.output.verdict`, op: leaf.op, value: leaf.value };
      });
      if (condition && usesVerdict) {
        const source = stageIds.get(from)!;
        verdictChecks.set(source, [...(verdictChecks.get(source) ?? []), condition]);
      }
      return condition;
    });
    let until: FlowCondition | undefined;
    if (!verdictChecks.size && conditions.every((condition) => condition !== undefined)) {
      const when = conditions.length === 1 ? conditions[0]! : { any: conditions };
      const negated = { not: when };
      const candidate = flowConditionSchema.safeParse(negated).success ? negated : negate(when);
      if (flowConditionSchema.safeParse(candidate).success) until = candidate;
      else notes.push(`Rework ${target} condition cannot be negated within the depth limit.`);
    } else if (conditions.some((condition) => condition === undefined)) notes.push(`Rework ${target} uses facts that cannot be converted.`);
    nodes.push({ id: loop, type: "loop", title: `${target} rework`, maxIterations, ...(until ? { until } : {}) });
    const sources = new Set(backEdges.map(({ from }) => stageIds.get(from)!));
    const body = new Set([...sources].flatMap((source) => [...reachable(source, arcs, true)]).filter((id) => descendants.has(id)));
    const checks = new Map<string, string>();
    for (const [source, rules] of verdictChecks) {
      const id = allocateId(`${source}-verdict`);
      nodes.push({ id, type: "condition", title: `${source} verdict`, rules: [{ port: "rework", when: rules.length === 1 ? rules[0]! : { any: rules } }] });
      checks.set(source, id);
    }
    const exits: Arc[] = [];
    arcs = arcs.map((arc) => {
      if (!arc.loopBack && arc.to === target) return { ...arc, to: loop };
      if (!arc.loopBack && sources.has(arc.from) && !body.has(arc.to) && !nodes.some(({ id, type }) => type === "join" && id === arc.to)) {
        const check = checks.get(arc.from);
        if (check) exits.push({ from: check, port: "else", to: arc.to });
        const skip = bypass.get(arc.from);
        if (skip) exits.push({ from: skip, port: "else", to: arc.to });
        return { from: loop, port: "done", to: arc.to };
      }
      return arc;
    });
    arcs.push(...exits, { from: loop, port: "body", to: target });
    for (const from of sources) {
      const check = checks.get(from);
      if (check) arcs.push({ from, port: "out", to: check }, { from: check, to: loop, port: "rework", loopBack: true });
      else arcs.push({ from, to: loop, port: "out", loopBack: true });
    }
  }

  for (const [stage, condition] of bypass) for (const arc of [...arcs]) {
    if (arc.from !== stage || arc.to === "done" || arc.loopBack || nodes.some((node) => node.id === arc.to && node.type === "condition" && node.rules.some(({ port }) => port === "rework"))) continue;
    arcs.push({ from: condition, port: "else", to: arc.to });
  }

  nodes.push({ id: "done", type: "output", title: "Done", target: "artifact", from: [`nodes.${outputFrom}.output`] });
  const edges: z.input<typeof flowDefinitionSchema>["edges"] = [];
  const seen = new Set<string>();
  for (const arc of [...wrapperArcs, ...arcs.map((edge) => ({ ...edge, to: entries.get(edge.to) ?? edge.to }))]) {
    const key = `${arc.from}/${arc.port}/${arc.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ id: `e-${edges.length + 1}`, from: { node: arc.from, port: arc.port }, to: { node: arc.to }, loopBack: arc.loopBack });
  }
  const definition = flowDefinitionSchema.parse({
    schema: 2, key: v1.key, title: v1.title, nodes, edges,
    inputs: v1.parameters.map((parameter) => ({ ...parameter, required: false })),
    settings: { ...v1.timeouts, ...(v1.budgets?.suggestedTokens ? { budgetTokens: v1.budgets.suggestedTokens } : {}) },
  });
  return { definition, notes };
}
