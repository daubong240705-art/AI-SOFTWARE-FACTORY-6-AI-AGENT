import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { workflowDefinitionSchema } from "@factory/contracts";
import { workflowGraph } from "../dist/workflow/graph.js";
import { proposePatch } from "../dist/workflow/patch.js";
import { workflowFixture, packs } from "./workflow-fixture.mjs";
import { pack } from "./org-fixture.mjs";
import { engineFixture } from "./workflow-engine-fixture.mjs";
import { createApiServer, createRoutes } from "../dist/api/index.js";
import { createBootstrapGate, createSessionStore } from "../dist/identity/index.js";
import { registryEntry } from "../dist/org/registry.js";

const software = pack.files.workflows.find((file) => file.definition.key === "software-delivery").definition;
const viewFields = ["id", "key", "title", "state", "revision", "createdAt", "startedAt", "endedAt", "counts",
  "stalledReason", "lastProgressAt", "stages", "params", "definitionRevision", "packKey", "packVersion",
  "definitionTitle", "phases", "patches"];

function assertKeys(value, keys) {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
}

function assertGraphFields(graph) {
  assertKeys(graph, ["stages", "edges", "joins", "gates"]);
  for (const stage of graph.stages) {
    assertKeys(stage, ["key", "title", "phase", "optional", "parallelGroup", "placement", "sideEffect",
      "requiredCapabilities", "teamHint", "inputs", "outputs"]);
    for (const input of stage.inputs) assertKeys(input, ["kind", "required"]);
    for (const output of stage.outputs) assertKeys(output, ["kind", "mustReach"]);
  }
  for (const edge of graph.edges) assertKeys(edge, ["from", "to", "type", "artifact", "maxLoops", "hasCondition"]);
  for (const join of graph.joins) assertKeys(join, ["group", "policy", "n"]);
  for (const gate of graph.gates) assertKeys(gate, ["before", "kind", "approver", "hasCondition"]);
}

function syntheticEntry(definitions, key = "software-team", version = pack.manifest.version) {
  return registryEntry({ ...pack, manifest: { ...pack.manifest, key, version },
    files: { ...pack.files, workflows: definitions.map((definition, index) => ({
      path: `workflows/graph-${index}.json`, definition: workflowDefinitionSchema.parse(definition),
    })) } });
}

function engagePack(f, entry, projectId = f.projectId) {
  const teamId = randomUUID();
  f.raw.prepare(`INSERT INTO teams (id,revision,name,charter,pack_key,pack_version,lifecycle)
    VALUES (?,1,'Graph team','Graph tests',?,?,'active')`).run(teamId, entry.key, entry.version);
  f.engage(teamId, projectId);
}

function databaseSnapshot(raw) {
  const tables = raw.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all();
  const counts = tables.map(({ name }) => [name, raw.prepare(`SELECT COUNT(*) AS n FROM "${name.replaceAll('"', '""')}"`).get().n]);
  return { counts, changes: raw.prepare("SELECT total_changes() AS n").get().n };
}

test("software delivery graph is bounded and redacts conditions", () => {
  const graph = workflowGraph(software);
  assertGraphFields(graph);
  assert.equal(graph.stages.length, 7);
  assert.equal(graph.edges.length, 8);
  assert.equal(graph.joins.length, 1);
  assert.equal(graph.gates.length, 2);
  assert.deepEqual(graph.stages.map((stage) => stage.key), software.stages.map((stage) => stage.key));
  assert.deepEqual(graph.stages[0], { key: "research", title: "research", phase: "discovery", optional: true,
    parallelGroup: null, placement: "portable", sideEffect: "artifact", requiredCapabilities: ["research.synthesis"],
    teamHint: null, inputs: [{ kind: "brief", required: true }], outputs: [{ kind: "research-report", mustReach: "approved" }] });
  assert.equal(graph.stages.find((stage) => stage.key === "design").parallelGroup, "analysis-specialists");
  assert.equal(graph.stages.find((stage) => stage.key === "ba").sideEffect, null);
  assert.deepEqual(graph.edges.find((edge) => edge.type === "rework"), {
    from: "qa", to: "development", type: "rework", artifact: null, maxLoops: 3, hasCondition: true,
  });
  assert.deepEqual(graph.edges.find((edge) => edge.type === "artifact-approved"), {
    from: "architecture", to: "development", type: "artifact-approved", artifact: "data-model", maxLoops: null, hasCondition: false,
  });
  assert.deepEqual(graph.joins, [{ group: "analysis-specialists", policy: "all", n: null }]);
  assert.deepEqual(graph.gates.map((gate) => gate.hasCondition), [false, true]);
  assert.equal(JSON.stringify(graph).includes("changes-requested"), false);
  assert.equal(JSON.stringify(graph).includes("production"), false);
});

test("graph copies only display fields without mutating or sharing definition arrays", () => {
  const definition = structuredClone(software);
  definition.stages[0].teamHint = "Research team";
  definition.stages[0].limits = { maxTasks: 3, budgetShare: 0.5 };
  definition.joins[0] = { group: "analysis-specialists", policy: "quorum", n: 2 };
  definition.budgets = { suggestedTokens: 1000 };
  const before = structuredClone(definition);
  const graph = workflowGraph(definition);
  assertGraphFields(graph);
  assert.deepEqual(definition, before);
  assert.equal(graph.stages[0].teamHint, "Research team");
  assert.equal(graph.joins[0].n, 2);
  graph.stages[0].requiredCapabilities.push("docs.write");
  graph.stages[0].inputs[0].required = false;
  graph.stages[0].outputs[0].mustReach = "draft";
  graph.edges[0].to = "deploy";
  graph.joins[0].n = 1;
  graph.gates[0].before = "qa";
  assert.deepEqual(definition, before);
});

test("instance view graph follows the patched stored definition and keeps existing fields", async (t) => {
  const f = await api(t, packs, engineFixture(t, software));
  const before = f.view();
  const added = { key: "evidence", title: "Evidence", phase: "delivered", requiredCapabilities: ["docs.write"], inputs: [], outputs: [] };
  const patch = proposePatch(f.deps, { projectId: f.projectId, instanceId: f.id, proposedBy: "operator", reason: "Add evidence", ops: [{ op: "addStage", stage: added, after: "qa" }] });
  assert.equal(patch.state, "applied");
  const pending = proposePatch(f.deps, { projectId: f.projectId, instanceId: f.id, proposedBy: "lead", reason: "Review evidence",
    ops: [{ op: "addStage", stage: { ...added, key: "pending-evidence" }, after: "evidence" }] });
  assert.equal(pending.state, "pending");
  const snapshot = databaseSnapshot(f.raw);
  const view = f.view();
  const response = await f.get(`/projects/${f.projectId}/workflows/${f.id}`);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().instance, view);
  assert.deepEqual(databaseSnapshot(f.raw), snapshot);
  assertKeys(view, [...viewFields, "graph"]);
  assertGraphFields(view.graph);
  assert.equal(view.graph.stages.some((stage) => stage.key === "evidence"), true);
  assert.equal(view.graph.stages.some((stage) => stage.key === "pending-evidence"), false);
  assert.ok(view.graph.edges.some((edge) => edge.from === "qa" && edge.to === "evidence"));
  assert.equal(software.stages.some((stage) => stage.key === "evidence"), false);
  assert.equal(view.definitionRevision, before.definitionRevision + 1);
  for (const field of ["params", "phases", "packKey", "packVersion", "definitionTitle", "createdAt", "startedAt", "endedAt"]) {
    assert.deepEqual(view[field], before[field], field);
  }
  assertKeys(view.stages[0], ["key", "phase", "state", "optional", "loopCount", "blockedReason", "engagementId", "extraTasks", "iteration", "tasks"]);
  const pendingView = view.patches.find((item) => item.id === pending.id);
  assert.equal(pendingView.state, "pending");
  assertKeys(pendingView, ["id", "number", "proposedBy", "policy", "state", "reason", "refusal", "createdAt", "decidedAt", "comment"]);
  assert.equal(view.graph.stages.length, before.graph.stages.length + 1);
});

async function api(t, entries = packs, fixture) {
  const f = fixture ?? workflowFixture(t, entries);
  const host = "127.0.0.1:8787";
  const origin = `http://${host}`;
  const gate = createBootstrapGate({ clock: f.clock });
  const app = createApiServer({ origins: [origin], clock: f.clock, gate, sessions: createSessionStore({ clock: f.clock }),
    register: createRoutes({ storage: f.storage, hub: f.hub, pipeline: f.pipeline, packs: entries }) });
  t.after(() => app.close());
  const auth = await app.inject({ method: "POST", url: "/auth/bootstrap", headers: { host, origin, "content-type": "application/json" }, payload: { token: gate.token } });
  assert.equal(auth.statusCode, 200);
  const headers = { host, cookie: auth.headers["set-cookie"].split(";")[0] };
  return { ...f, app, headers, get: (url) => app.inject({ url, headers }), anonymous: (url) => app.inject({ url, headers: { host } }) };
}

test("workflow definitions route requires session and project", async (t) => {
  const f = await api(t);
  const snapshot = databaseSnapshot(f.raw);
  assert.equal((await f.anonymous(`/projects/${f.projectId}/workflow-definitions`)).statusCode, 401);
  const missing = await f.get(`/projects/${randomUUID()}/workflow-definitions`);
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, "not-found");
  assert.deepEqual(databaseSnapshot(f.raw), snapshot);
});

test("workflow definitions route is empty without engagements and read-only", async (t) => {
  const f = await api(t);
  f.raw.prepare("DELETE FROM engagements WHERE project_id = ?").run(f.projectId);
  const before = databaseSnapshot(f.raw);
  const response = await f.get(`/projects/${f.projectId}/workflow-definitions`);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { apiVersion: 1, ok: true, items: [] });
  assert.deepEqual(databaseSnapshot(f.raw), before);
});

test("workflow definitions route lists engaged pack workflows with parameters and graph", async (t) => {
  const f = await api(t);
  const before = databaseSnapshot(f.raw);
  const response = await f.get(`/projects/${f.projectId}/workflow-definitions`);
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.apiVersion, 1);
  assert.equal(body.ok, true);
  assert.deepEqual(body.items.map((item) => item.title), ["Software Delivery"]);
  assertKeys(body.items[0], ["key", "packKey", "packVersion", "revision", "title", "domain", "parameters", "phases", "graph"]);
  assert.deepEqual(body.items[0], { key: software.key, packKey: pack.manifest.key, packVersion: pack.manifest.version,
    revision: software.revision, title: software.title, domain: "software", parameters: software.parameters.map((parameter) => ({
      name: parameter.name, type: parameter.type, default: parameter.default,
      options: parameter.type === "enum" ? parameter.values : null, min: null, max: null, label: null,
    })),
    phases: software.phases, graph: workflowGraph(software) });
  assert.deepEqual(body.items[0].parameters[1], { name: "deployTarget", type: "enum", default: "staging", options: ["none", "staging", "production"], min: null, max: null, label: null });
  assertGraphFields(body.items[0].graph);
  assert.deepEqual(databaseSnapshot(f.raw), before);
  const item = body.items[0];
  const result = f.execute("workflows.create", { instanceId: randomUUID(), definitionKey: item.key, packKey: item.packKey });
  assert.equal(result.status, 200);
});

test("definitions are scoped to engaged packs and deduplicated across teams", async (t) => {
  const f = await api(t);
  const otherTeam = f.secondTeam();
  const otherProject = f.project();
  f.engage(otherTeam, otherProject);
  const url = `/projects/${f.projectId}/workflow-definitions`;
  assert.deepEqual((await f.get(url)).json().items.map((item) => item.packKey), ["software-team"]);
  f.engage(otherTeam);
  engagePack(f, packs[0]);
  const snapshot = databaseSnapshot(f.raw);
  const items = (await f.get(url)).json().items;
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.packKey).sort(), ["software-team", "specialist-team"]);
  assert.deepEqual(databaseSnapshot(f.raw), snapshot);
});

test("definitions sort by title then key and project parameter schema fields for the form", async (t) => {
  const parameters = [
    { name: "enabled", type: "bool", default: false },
    { name: "summary", type: "string", default: "Ready" },
    { name: "effort", type: "number", default: 3 },
    { name: "target", type: "enum", default: "one", values: ["one", "two"] },
  ];
  const definition = { key: "sort-base", revision: 2, title: "Sorted", phases: ["delivery"], parameters,
    stages: [{ key: "author", title: "Author", phase: "delivery", requiredCapabilities: ["docs.write"], inputs: [], outputs: [] }],
    edges: [], joins: [], gates: [] };
  const entry = syntheticEntry([
    { ...definition, key: "last-key", title: "Alpha" },
    { ...definition, key: "first-key", title: "Alpha" },
    { ...definition, key: "middle-key", title: "Zulu" },
  ]);
  const f = await api(t, [entry]);
  const response = await f.get(`/projects/${f.projectId}/workflow-definitions`);
  assert.equal(response.statusCode, 200);
  const items = response.json().items;
  assert.deepEqual(items.map((item) => item.key), ["first-key", "last-key", "middle-key"]);
  assert.deepEqual(items.map((item) => item.domain), [null, null, null]);
  for (const item of items) assert.deepEqual(item.parameters, parameters.map((parameter) => ({ name: parameter.name,
    type: parameter.type, default: parameter.default, options: parameter.type === "enum" ? parameter.values : null,
    min: null, max: null, label: null })));
});

test("definitions are limited to fifty after sorting all engaged pack workflows", async (t) => {
  const definitions = Array.from({ length: 56 }, (_, index) => ({ ...software,
    key: `flow-${String(index).padStart(2, "0")}`, title: `Flow ${String(index % 5)}` }));
  const entries = Array.from({ length: 7 }, (_, index) => syntheticEntry(
    definitions.slice(index * 8, index * 8 + 8).reverse(), `graph-team-${index}`)).reverse();
  const f = await api(t, entries);
  for (const entry of entries) engagePack(f, entry);
  const before = databaseSnapshot(f.raw);
  const response = await f.get(`/projects/${f.projectId}/workflow-definitions`);
  assert.equal(response.statusCode, 200);
  const items = response.json().items;
  assert.equal(items.length, 50);
  const expected = definitions.sort((a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key)).slice(0, 50);
  assert.deepEqual(items.map((item) => item.key), expected.map((item) => item.key));
  assert.deepEqual(databaseSnapshot(f.raw), before);
});

test("definitions omit unavailable pack versions and return an empty list without a registry", async (t) => {
  const f = await api(t, []);
  assert.deepEqual((await f.get(`/projects/${f.projectId}/workflow-definitions`)).json().items, []);
  const unavailable = await api(t, [syntheticEntry([software], "software-team", "2.0.0")]);
  assert.deepEqual((await unavailable.get(`/projects/${unavailable.projectId}/workflow-definitions`)).json().items, []);
});

test("definitions omit paused and ended engagements", async (t) => {
  const f = await api(t);
  const otherTeam = f.secondTeam();
  const engagementId = f.engage(otherTeam);
  const url = `/projects/${f.projectId}/workflow-definitions`;
  for (const state of ["paused", "ended"]) {
    f.raw.prepare("UPDATE engagements SET state=? WHERE project_id=? AND id=?").run(state, f.projectId, engagementId);
    const before = databaseSnapshot(f.raw);
    const response = await f.get(url);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().items.map((item) => item.packKey), ["software-team"]);
    assert.deepEqual(databaseSnapshot(f.raw), before);
  }
});

test("definitions omit invalid workflows that the create command refuses", async (t) => {
  const invalid = { ...software, key: "invalid-flow", edges: [...software.edges, { from: "missing", to: "qa", type: "finish-to-start" }] };
  const f = await api(t, [syntheticEntry([invalid, software])]);
  const response = await f.get(`/projects/${f.projectId}/workflow-definitions`);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().items.map((item) => item.key), [software.key]);
  const result = f.execute("workflows.create", { instanceId: randomUUID(), definitionKey: invalid.key, packKey: "software-team" });
  assert.equal(result.status, 400);
});

test("workflow graph projection enforces bounds", () => {
  const source = software;
  const definition = structuredClone(source);
  definition.stages = Array.from({ length: 61 }, (_, index) => ({ ...source.stages[0], key: `stage-${index}` }));
  definition.edges = Array.from({ length: 201 }, () => ({ from: "research", to: "ba", type: "finish-to-start" }));
  definition.joins = Array.from({ length: 61 }, (_, index) => ({ group: `group-${index}`, policy: "all" }));
  definition.gates = Array.from({ length: 201 }, () => ({ before: "research", kind: "review", approver: "operator" }));
  const graph = workflowGraph(definition);
  assert.equal(graph.stages.length, 60);
  assert.equal(graph.edges.length, 200);
  assert.equal(graph.joins.length, 60);
  assert.equal(graph.gates.length, 200);
  assert.equal(graph.stages.at(-1).key, "stage-59");
  assert.equal(graph.joins.at(-1).group, "group-59");
  assert.equal(definition.stages.length, 61);
  assert.equal(definition.edges.length, 201);
});

test("instance and definitions APIs accept the maximum graph sizes without writing", async (t) => {
  const stages = Array.from({ length: 60 }, (_, index) => ({ ...software.stages[1], key: `stage-${index}`,
    parallelGroup: `group-${index}` }));
  const edges = stages.flatMap((stage, index) => stages.slice(index + 1).map((next) => ({
    from: stage.key, to: next.key, type: "finish-to-start",
  }))).slice(0, 200);
  const definition = workflowDefinitionSchema.parse({ ...software, stages, edges,
    joins: stages.map((stage) => ({ group: stage.parallelGroup, policy: "all" })),
    gates: Array.from({ length: 200 }, (_, index) => ({ before: stages[index % 60].key, kind: "review", approver: "operator" })),
  });
  const f = await api(t, [syntheticEntry([definition])], engineFixture(t, definition));
  const snapshot = databaseSnapshot(f.raw);
  for (const url of [`/projects/${f.projectId}/workflows/${f.id}`, `/projects/${f.projectId}/workflow-definitions`]) {
    const response = await f.get(url);
    assert.equal(response.statusCode, 200);
    const body = response.json();
    const graph = (body.instance ?? body.items[0]).graph;
    assertGraphFields(graph);
    assert.deepEqual([graph.stages.length, graph.edges.length, graph.joins.length, graph.gates.length], [60, 200, 60, 200]);
  }
  assert.deepEqual(databaseSnapshot(f.raw), snapshot);
});
