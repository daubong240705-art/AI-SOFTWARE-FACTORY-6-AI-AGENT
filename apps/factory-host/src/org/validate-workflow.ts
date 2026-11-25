import { workflowDefinitionSchema, type Condition, type WorkflowDefinition } from "@factory/contracts";

export function validateWorkflowDefinition(definition: WorkflowDefinition, options: {
  knownCapabilities?: ReadonlySet<string>;
} = {}): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = []; const warnings: string[] = [];
  const parsed = workflowDefinitionSchema.safeParse(definition);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors.push(`${issue.path.map((p) => typeof p === "number" || /^[a-zA-Z]+$/.test(String(p)) ? String(p) : "field").join(".") || "definition"}: ${issue.message === "unknown phase" ? "unknown phase" : "invalid value"}`);
    return { ok: false, errors, warnings };
  }
  const d = parsed.data;
  const stages = new Map(d.stages.map((s) => [s.key, s]));
  const graph = new Map(d.stages.map((s) => [s.key, [] as string[]]));
  const incoming = new Set<string>(); const seen = new Set<string>();
  for (const [i, e] of d.edges.entries()) {
    if (!stages.has(e.from) || !stages.has(e.to)) errors.push(`edges.${i}: unknown stage`);
    if (e.from === e.to) errors.push(`edges.${i}: self edge`);
    const key = `${e.from}:${e.to}:${e.type}:${e.artifact ?? ""}`;
    if (seen.has(key)) errors.push(`edges.${i}: duplicate edge`);
    seen.add(key);
    if (e.type !== "rework" && stages.has(e.from) && stages.has(e.to)) { graph.get(e.from)!.push(e.to); incoming.add(e.to); }
    if (e.type === "artifact-approved" && !stages.get(e.from)?.outputs.some((o) => o.kind === e.artifact))
      errors.push(`edges.${i}: source output missing`);
  }
  const colors = new Map<string, number>(); const path: string[] = []; let cycle = false;
  const visit = (key: string): void => {
    if (cycle || colors.get(key) === 2) return;
    if (colors.get(key) === 1) { errors.push(`edges: cycle ${[...path.slice(path.indexOf(key)), key].join(" -> ")}`); cycle = true; return; }
    colors.set(key, 1); path.push(key);
    for (const next of graph.get(key) ?? []) visit(next);
    path.pop(); colors.set(key, 2);
  };
  for (const key of stages.keys()) visit(key);
  const reaches = (from: string, to: string, visited = new Set<string>()): boolean => {
    if (visited.has(from)) return false;
    visited.add(from);
    return (graph.get(from) ?? []).some((next) => next === to || reaches(next, to, visited));
  };
  for (const [i, e] of d.edges.entries()) if (e.type === "rework" && (e.from === e.to || !reaches(e.to, e.from)))
    errors.push(`edges.${i}: rework target must precede source`);
  if (d.stages.every((s) => incoming.has(s.key))) errors.push("stages: no entry stage");
  const groups = new Map<string, number>();
  for (const stage of d.stages) if (stage.parallelGroup) groups.set(stage.parallelGroup, (groups.get(stage.parallelGroup) ?? 0) + 1);
  for (const group of groups.keys()) if (!d.joins.some((j) => j.group === group)) errors.push("joins: group policy missing");
  for (const [i, j] of d.joins.entries()) {
    const size = groups.get(j.group);
    if (size === undefined) errors.push(`joins.${i}: unknown group`);
    if (j.policy === "quorum" && (j.n === undefined || j.n < 1 || j.n > (size ?? 0))) errors.push(`joins.${i}: invalid quorum`);
  }
  const parameters = new Map(d.parameters.map((p) => [p.name, p]));
  const check = (c: Condition, location: string): void => {
    if ("all" in c) { c.all.forEach((v) => check(v, location)); return; }
    if ("any" in c) { c.any.forEach((v) => check(v, location)); return; }
    if ("not" in c) { check(c.not, location); return; }
    if (!("param" in c)) {
      if (c.stage !== undefined && !stages.has(c.stage)) errors.push(`${location}: unknown stage`);
      return;
    }
    const p = parameters.get(c.param);
    if (!p) { errors.push(`${location}: unknown parameter`); return; }
    const values = Array.isArray(c.value) ? c.value : [c.value];
    const type = p.type === "bool" ? "boolean" : p.type === "enum" ? "string" : p.type;
    if (values.some((v) => typeof v !== type) || (["lt", "lte", "gt", "gte"].includes(c.op) && p.type !== "number"))
      errors.push(`${location}: parameter type mismatch`);
    else if (p.type === "enum" && values.some((v) => !p.values.includes(String(v)))) errors.push(`${location}: unknown enum value`);
  };
  for (const [i, stage] of d.stages.entries()) {
    if (stage.includeIf) check(stage.includeIf, `stages.${i}.includeIf`);
    if (stage.skipIf) check(stage.skipIf, `stages.${i}.skipIf`);
    if (!stage.requiredCapabilities.length && !stage.optional && !d.gates.some((g) => g.before === stage.key))
      errors.push(`stages.${i}: capability or gate required`);
    if (options.knownCapabilities) for (const capability of stage.requiredCapabilities)
      if (!options.knownCapabilities.has(capability)) warnings.push(`stages.${i}.requiredCapabilities: unknown capability`);
    if (stage.optional && !stage.includeIf && !stage.skipIf) warnings.push(`stages.${i}: optional stage has no condition`);
    // W1a has no team catalogue; hints are advisory, never a dispatch target.
    if (stage.teamHint) warnings.push(`stages.${i}.teamHint: unknown team`);
  }
  for (const [i, gate] of d.gates.entries()) {
    if (!stages.has(gate.before)) errors.push(`gates.${i}: unknown stage`);
    if (gate.when) check(gate.when, `gates.${i}.when`);
  }
  for (const [i, edge] of d.edges.entries()) if (edge.when) check(edge.when, `edges.${i}.when`);
  if (d.stages.reduce((sum, s) => sum + (s.limits?.budgetShare ?? 0), 0) > 1) warnings.push("stages: budget shares exceed one");
  return { ok: errors.length === 0, errors, warnings };
}
