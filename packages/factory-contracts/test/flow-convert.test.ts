import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { convertWorkflowV1, flowDefinitionSchema, flowGraph, validateFlow, workflowDefinitionSchema } from "../src/index.js";

const repo = new URL("../../../../", import.meta.url);
const fixtures = globSync("packs/*/workflows/*.json", { cwd: fileURLToPath(repo) }).sort();
test("discovers pack workflows", () => assert.ok(fixtures.length > 0));
for (const filename of fixtures) test(`converts ${filename} to a publishable flow`, () => {
  const v1 = workflowDefinitionSchema.parse(JSON.parse(readFileSync(new URL(filename, repo), "utf8")));
  const result = convertWorkflowV1(v1);
  assert.deepEqual(flowDefinitionSchema.parse(result.definition), result.definition);
  assert.deepEqual(validateFlow(result.definition), []);
  assert.deepEqual(convertWorkflowV1(v1), result);
});

const stage = (key: string, extra: Record<string, unknown> = {}) => ({
  key, phase: "Work", title: key, requiredCapabilities: ["work.general"], inputs: [], outputs: [], ...extra,
});
const dependency = (from: string, to: string) => ({ from, to, type: "finish-to-start" });
const param = { param: "again", op: "eq", value: true };
function convert(stages: unknown[], edges: unknown[], extra: Record<string, unknown> = {}) {
  const result = convertWorkflowV1(workflowDefinitionSchema.parse({
    key: "sample", revision: 1, title: "Sample", phases: ["Work"], stages, edges,
    parameters: [{ name: "request", type: "string", default: "" }, { name: "again", type: "bool", default: false }],
    joins: [], gates: [], ...extra,
  }));
  assert.deepEqual(validateFlow(result.definition), []);
  return result;
}

test("inserts a rework loop at the target and sends its done port to the continuation", () => {
  const { definition } = convert([stage("draft"), stage("review"), stage("ship")], [
    dependency("draft", "review"), dependency("review", "ship"),
    { from: "review", to: "draft", type: "rework", when: param, maxLoops: 4 },
  ]);
  const graph = flowGraph(definition);
  const loop = definition.nodes.find(({ id }) => id === "draft-rework");
  assert.equal(loop?.type, "loop");
  if (loop?.type !== "loop") return;
  assert.equal(loop.maxIterations, 4);
  assert.deepEqual(loop.until, { not: { path: "inputs.again", op: "eq", value: true } });
  assert.deepEqual(graph.successors("start").map(({ to }) => to), [loop.id]);
  assert.deepEqual(graph.successors(loop.id).map(({ port, to }) => [port, to]), [["done", "ship"], ["body", "draft"]]);
  assert.ok(definition.edges.some(({ from, to, loopBack }) => from.node === "review" && to.node === loop.id && loopBack));
});

test("inserts a gated stage and maps project-lead to operator", () => {
  const { definition, notes } = convert([stage("draft", { requiredCapabilities: [] })], [], {
    gates: [{ before: "draft", kind: "execution-gate", approver: "project-lead" }],
  });
  const gate = definition.nodes.find(({ id }) => id === "draft-gate");
  const draft = definition.nodes.find(({ id }) => id === "draft");
  assert.ok(gate?.type === "approval" && gate.approver === "operator");
  assert.ok(draft?.type === "agent");
  assert.deepEqual(draft.agent, { tags: ["general"] });
  assert.equal(draft.task.instructions, "{{ inputs.request }}");
  assert.deepEqual(flowGraph(definition).successors(gate.id).map(({ port, to }) => [port, to]), [["approved", "draft"]]);
  assert.ok(notes.some((note) => note.includes("rejected")));
});

test("joins group members before their shared successor and notes artifact/informs edges", () => {
  const { definition, notes } = convert([stage("draft", { parallelGroup: "writers" }), stage("edit", { parallelGroup: "writers" }), stage("ship")], [
    dependency("draft", "ship"), { from: "edit", to: "ship", type: "artifact-approved", artifact: "report" },
    { from: "draft", to: "edit", type: "informs" },
  ], { joins: [{ group: "writers", policy: "quorum", n: 2 }] });
  const join = definition.nodes.find(({ id }) => id === "writers-join");
  assert.ok(join?.type === "join");
  assert.deepEqual(join.policy, { quorum: 2 });
  assert.deepEqual(flowGraph(definition).predecessors(join.id).map(({ from }) => from), ["draft", "edit"]);
  assert.deepEqual(flowGraph(definition).predecessors("ship").map(({ from }) => from), [join.id]);
  assert.ok(notes.some((note) => note.includes("informs")));
  assert.ok(notes.some((note) => note.includes("stage review")));
});

test("turns includeIf and skipIf into path conditions and notes unsupported facts", () => {
  const { definition, notes } = convert([stage("draft", { includeIf: param }), stage("edit", { skipIf: param }),
    stage("ship", { includeIf: { fact: "review.verdict", op: "eq", value: "approved" } })], []);
  const check = definition.nodes.find(({ id }) => id === "draft-if");
  assert.ok(check?.type === "condition");
  assert.deepEqual(check.rules, [{ port: "include", when: { path: "inputs.again", op: "eq", value: true } }]);
  assert.deepEqual(flowGraph(definition).successors("draft-if").map(({ port, to }) => [port, to]), [["include", "draft"]]);
  assert.deepEqual(flowGraph(definition).successors("edit-if").map(({ port, to }) => [port, to]), [["else", "edit"]]);
  assert.ok(!definition.nodes.some(({ id }) => id === "ship-if"));
  assert.ok(notes.some((note) => note.includes("ship") && note.includes("always included")));
});
