import assert from "node:assert/strict";
import { test } from "node:test";
import {
  flowConditionSchema, flowDefinitionSchema, flowGraph, flowNodeSchema, FLOW_NODE_PORTS, jsonSubsetSchema, validateFlow,
  type FlowIssueCode,
} from "../src/index.js";
import { validateBundleParams } from "../src/flow-validate.js";

const trigger = { id: "start", type: "trigger", title: "Start", trigger: { kind: "manual" } } as const;
const agent = (id: string) => ({ id, type: "agent", title: id, agent: { role: id },
  task: { title: id, instructions: "", acceptance: ["Deliver findings"], inputs: [] } });
const output = { id: "delivery", type: "output", title: "Delivery", target: "deliver", from: ["nodes.lead.output"] };
const edge = (id: string, source: string, destination: string, port = "out", loopBack = false) => ({
  id, from: { node: source, port }, to: { node: destination }, loopBack,
});
const rawFlow = (nodes: unknown[], edges: unknown[]) => ({ schema: 2, key: "demo-flow", title: "Demo", nodes, edges });
const flow = (nodes: unknown[], edges: unknown[]) => flowDefinitionSchema.parse(rawFlow(nodes, edges));
const join = { id: "join", type: "join", title: "Join", policy: "all" };
const approval = { id: "review", type: "approval", title: "Review", approver: "operator", prompt: "{{ nodes.join.output }}" };
const loop = { id: "repeat", type: "loop", title: "Repeat", maxIterations: 3,
  until: { path: "nodes.lead.output.verdict", op: "eq", value: "pass" } };

test("accepts a hand-written Lead, parallel branches, Join, Review, Delivery flow", () => {
  const definition = flow([trigger, agent("lead"), agent("research"), agent("design"), agent("analysis"), join, approval, output], [
    edge("1", "start", "lead"), edge("2", "lead", "research"), edge("3", "lead", "design"), edge("4", "lead", "analysis"),
    edge("5", "research", "join"), edge("6", "design", "join"), edge("7", "analysis", "join"), edge("8", "join", "review"),
    edge("9", "review", "delivery", "approved"),
  ]);
  assert.deepEqual(validateFlow(definition), []);
  assert.deepEqual(flowGraph(definition).topologicalOrder(), ["start", "lead", "research", "design", "analysis", "join", "review", "delivery"]);
  assert.deepEqual(definition.settings, { concurrency: "allow" });
  assert.deepEqual(FLOW_NODE_PORTS(flowNodeSchema.parse(approval)), ["approved", "rejected", "timeout"]);
});

test("accepts a hand-written loop and exposes its back edge without sorting through it", () => {
  const definition = flow([trigger, loop, agent("lead"), output], [
    edge("1", "start", "repeat"), edge("2", "repeat", "lead", "body"), edge("3", "lead", "repeat", "out", true),
    edge("4", "repeat", "delivery", "done"),
  ]);
  assert.deepEqual(validateFlow(definition), []);
  const graph = flowGraph(definition);
  assert.deepEqual(graph.successors("lead"), [{ edge: "3", port: "out", to: "repeat" }]);
  assert.deepEqual(graph.predecessors("repeat").map(({ from }) => from), ["start", "lead"]);
  assert.deepEqual(graph.topologicalOrder(), ["start", "repeat", "lead", "delivery"]);
});

test("rejects malformed shapes, duplicate IDs, invalid error ports and conditions", () => {
  assert.equal(flowDefinitionSchema.safeParse(rawFlow([trigger, trigger], [])).success, false);
  assert.equal(flowDefinitionSchema.safeParse(rawFlow([trigger], [edge("same", "start", "lead"), edge("same", "start", "other")])).success, false);
  assert.equal(flowNodeSchema.safeParse({ ...trigger, onError: "port" }).success, false);
  assert.equal(flowNodeSchema.safeParse({ ...loop, maxIterations: 21 }).success, false);
  assert.equal(flowNodeSchema.safeParse({ ...agent("lead"), onError: "port" }).success, true);
  const condition = { type: "condition", id: "check", title: "Check" };
  const rule = { when: loop.until, port: "pass" };
  assert.equal(flowNodeSchema.safeParse({ ...condition, rules: [rule, rule] }).success, false);
  assert.equal(flowNodeSchema.safeParse({ ...condition, rules: [{ ...rule, port: "else" }] }).success, false);
  assert.deepEqual(FLOW_NODE_PORTS(flowNodeSchema.parse({ ...condition, rules: [rule] })), ["pass", "else"]);
  const leaf = { path: "nodes.lead.output[14]", op: "gte", value: 2 };
  assert.equal(flowConditionSchema.safeParse({ all: [{ not: { any: [leaf] } }, { fact: "review.verdict", op: "eq", value: "approved" },
    { param: "enabled", op: "eq", value: true }] }).success, true);
  assert.equal(flowConditionSchema.safeParse({ not: { not: { not: { not: leaf } } } }).success, false);
  assert.equal(flowConditionSchema.safeParse({ ...leaf, op: "in", value: [1, "two"] }).success, false);
  assert.equal(flowConditionSchema.safeParse({ ...leaf, value: "two" }).success, false);
  assert.equal(flowConditionSchema.safeParse({ ...leaf, path: "context.lead" }).success, false);
  for (const input of [{ name: "mode", type: "enum", required: false }, { name: "text", type: "string", required: true, values: ["x"] }]) {
    assert.equal(flowDefinitionSchema.safeParse({ ...rawFlow([trigger], []), inputs: [input] }).success, false);
  }
});

test("bounds and restricts structured output schemas", () => {
  const schema = { type: "object", required: ["rows"], properties: { rows: { type: "array", maxItems: 4,
    items: { type: "object", properties: { ok: { type: "boolean" } } } } } };
  assert.equal(jsonSubsetSchema.safeParse(schema).success, true);
  assert.equal(jsonSubsetSchema.safeParse({ type: "object", properties: { nested: schema } }).success, false);
  assert.equal(jsonSubsetSchema.safeParse({ type: "string", pattern: ".*" }).success, false);
});

function expectIssue(code: FlowIssueCode, nodes: unknown[], edges: unknown[], target: { node?: string; edge?: string } = {}): void {
  assert.ok(validateFlow(flow(nodes, edges)).some((issue) => issue.code === code &&
    (target.node === undefined || issue.node === target.node) && (target.edge === undefined || issue.edge === target.edge)));
}

test("rejects flows with no trigger", () => expectIssue("no-trigger", [agent("lead")], []));
test("rejects a trigger with an incoming edge", () => expectIssue("trigger-has-input", [trigger, agent("lead")],
  [edge("1", "lead", "start")], { node: "start" }));
test("rejects an unknown endpoint", () => expectIssue("unknown-node", [trigger], [edge("1", "start", "missing")], { edge: "1" }));
test("rejects an unknown output port", () => expectIssue("unknown-port", [trigger, agent("lead")],
  [edge("1", "start", "lead", "error")], { edge: "1" }));
test("rejects a duplicate edge tuple", () => expectIssue("duplicate-edge", [trigger, agent("lead")],
  [edge("1", "start", "lead"), edge("2", "start", "lead")], { edge: "2" }));
test("rejects an outgoing edge from an output", () => expectIssue("output-has-edges", [trigger, agent("lead"), output],
  [edge("1", "delivery", "lead", "out", true)], { node: "delivery" }));
test("rejects an unreachable node", () => expectIssue("unreachable", [trigger, agent("lead")], [], { node: "lead" }));
test("rejects a cycle made of forward edges", () => expectIssue("cycle-without-loop", [trigger, agent("lead"), agent("follow")],
  [edge("1", "start", "lead"), edge("2", "lead", "follow"), edge("3", "follow", "lead")], { node: "lead" }));
test("rejects loopBack to a non-loop or to a loop via its done port", () => {
  expectIssue("bad-loop-back", [trigger, agent("lead")], [edge("1", "start", "lead"), edge("2", "lead", "lead", "out", true)], { edge: "2" });
  expectIssue("bad-loop-back", [trigger, loop, agent("lead")],
    [edge("1", "start", "repeat"), edge("2", "repeat", "lead", "done"), edge("3", "lead", "repeat", "out", true)], { edge: "3" });
});
test("rejects a join with fewer than two incoming edges", () => expectIssue("join-needs-two-inputs", [trigger, join],
  [edge("1", "start", "join")], { node: "join" }));
test("rejects unknown paths in templates, nested conditions, and inputs in node order", () => {
  const lead = agent("lead");
  const definition = flow([trigger, { ...lead, task: { ...lead.task, title: "Look at {{ nodes.nope.output[0] }}", inputs: ["nodes.missing.artifacts"] } },
    { ...loop, until: { not: { ...loop.until, path: "nodes.unknown.output" } } }], [edge("1", "start", "lead"), edge("2", "lead", "repeat"), edge("3", "lead", "absent")]);
  assert.deepEqual(validateFlow(definition).map(({ code, node, edge }) => [code, node, edge]), [
    ["unknown-path", "lead", undefined], ["unknown-path", "lead", undefined], ["unknown-path", "repeat", undefined], ["unknown-node", undefined, "3"],
  ]);
});
test("rejects a subflow referencing itself", () => expectIssue("subflow-self", [trigger, {
  id: "child", type: "subflow", title: "Child", workflow: "demo-flow", version: "published", inputs: {},
}], [edge("1", "start", "child")], { node: "child" }));
test("checks explicit agent IDs in all selector positions only when given a set", () => {
  const selector = (suffix: number) => ({ agent: `00000000-0000-4000-8000-00000000000${suffix}` });
  const definition = flow([trigger, { ...agent("lead"), agent: selector(1), review: { agent: selector(2) } },
    { ...approval, prompt: "", approver: { agent: selector(3) } }, {
      id: "plan", type: "orchestrate", title: "Plan", lead: selector(4), allowed: [selector(5), { tags: ["general"] }],
      goal: "Plan work", maxTasks: 2, maxDepth: 1,
    }], [edge("1", "start", "lead"), edge("2", "lead", "review"), edge("3", "review", "plan", "approved")]);
  assert.deepEqual(validateFlow(definition), []);
  assert.deepEqual(validateFlow(definition, { agentIds: new Set([selector(1).agent]) }).map(({ code, node }) => [code, node]), [
    ["agent-not-found", "lead"], ["agent-not-found", "review"], ["agent-not-found", "plan"], ["agent-not-found", "plan"],
  ]);
});

test("bundle.publish accepts an integration id, name or expression and rejects anything else", () => {
  const base = { operation: "publish" };
  assert.deepEqual(validateBundleParams({ ...base, integrationId: "00000000-0000-4000-8000-000000000001" }), []);
  assert.deepEqual(validateBundleParams({ ...base, integrationId: "lazy-gaming-portal" }), []);
  assert.deepEqual(validateBundleParams({ ...base, integrationId: "{{inputs.portalIntegrationId}}" }), []);
  assert.equal(validateBundleParams({ ...base, integrationId: "Not A Name!" })[0]?.code, "bundle-integration");
});
