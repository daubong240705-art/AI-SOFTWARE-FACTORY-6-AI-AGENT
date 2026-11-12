import type { WorkflowDefinition } from "@factory/contracts";

export function workflowGraph(definition: WorkflowDefinition) {
  return {
    stages: definition.stages.slice(0, 60).map((stage) => ({
      key: stage.key,
      title: stage.title,
      phase: stage.phase,
      optional: stage.optional,
      parallelGroup: stage.parallelGroup ?? null,
      placement: stage.placement,
      sideEffect: stage.sideEffect ?? null,
      requiredCapabilities: [...stage.requiredCapabilities],
      teamHint: stage.teamHint ?? null,
      // Plan Patch addTaskWithinStage needs room: the Host allows 2 + extra tasks up to this limit (default 1 = no room).
      maxTasks: stage.limits?.maxTasks ?? 1,
      inputs: stage.inputs.map(({ kind, required }) => ({ kind, required })),
      outputs: stage.outputs.map(({ kind, mustReach }) => ({ kind, mustReach })),
    })),
    edges: definition.edges.slice(0, 200).map((edge) => ({
      from: edge.from,
      to: edge.to,
      type: edge.type,
      artifact: edge.artifact ?? null,
      maxLoops: edge.maxLoops ?? null,
      hasCondition: edge.when !== undefined,
    })),
    joins: definition.joins.slice(0, 60).map((join) => ({
      group: join.group,
      policy: join.policy,
      n: join.n ?? null,
    })),
    gates: definition.gates.slice(0, 200).map((gate) => ({
      before: gate.before,
      kind: gate.kind,
      approver: gate.approver,
      hasCondition: gate.when !== undefined,
    })),
  };
}
