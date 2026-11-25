import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { setupProposalViewSchema, SYSTEM_SCOPE_ID } from "@factory/contracts";
import { startHost } from "../src/host.js";
import { createFakeGateway, type FakeStep } from "../src/models/fake.js";
import { DEFAULT_BUDGET_CONFIG } from "../src/policy/budget.js";
import { fixedClock, idFactory, MIGRATIONS_DIR } from "./helpers.js";

const usage = { inputTokens: 20, outputTokens: 6, cachedInputTokens: 3, reasoningOutputTokens: 2 };
const trigger = { id: "start", title: "Start", type: "trigger", trigger: { kind: "manual" } };
const draft = (title: string) => ({ schema: 2, key: "store", title, nodes: [trigger], edges: [] });
const config = (name: string) => ({ name, role: "Builder", runtime: { adapter: "fake" }, skills: [] as { skillId: string; version: string }[] });
const request = "Tôi muốn xây dựng một hệ thống thương mại điện tử";
const flowOnly = (title: string) => ({ summary: "Workflow", agents: [], teams: [], relations: [], flows: [draft(title)], notes: [] });
const projectProposal = () => ({ ...flowOnly("Build a store"),
  agents: [{ key: "builder", config: config("Store Builder") }, { key: "tester", config: config("Store Tester") }],
  teams: [{ name: "Store", description: "Build the store", leadKey: "builder", memberKeys: ["builder", "tester"] }],
  relations: [{ fromKey: "builder", toKey: "tester", kind: "manages" }],
  flows: [{ ...draft("Build a store"), nodes: [trigger, { id: "build", title: "Build", type: "agent", agent: { role: "setup:builder" },
    review: { agent: { role: "setup:tester" } }, task: { title: "Build", instructions: "Build the store", acceptance: ["Store works"], inputs: [] } }],
  edges: [{ id: "start-build", from: { node: "start", port: "out" }, to: { node: "build" } }] }],
});

async function fixture(context: TestContext, steps: FakeStep[], defaultDayTokens?: number) {
  const dir = mkdtempSync(join(process.cwd(), ".setup-test-"));
  const gateway = createFakeGateway(steps);
  let bootstrap: string | undefined;
  const starting = startHost({ stateDir: join(dir, "state"), port: 8787, listen: false, dispatch: {}, clock: fixedClock(),
    packsDir: fileURLToPath(new URL("../../../../packs/", import.meta.url)), migrationsDir: MIGRATIONS_DIR,
    modelGateway: gateway, lead: { model: "setup-lead", effort: "high" }, onBootstrapToken(token) { bootstrap = token; },
    ...(defaultDayTokens === undefined ? {} : { budgetConfig: { ...DEFAULT_BUDGET_CONFIG, defaultDayTokens } }) });
  context.after(async () => { try { await (await starting.catch(() => undefined))?.close(); } finally { rmSync(dir, { recursive: true, force: true }); } });
  const host = await starting;
  const { app, storage: { raw } } = host;
  const origin = host.origins[0]!;
  const base = { host: new URL(origin).host, origin };
  const projectId = idFactory(1)();
  const path = `/projects/${projectId}/setup-proposals`;
  assert.equal((await app.inject({ url: path, headers: base })).statusCode, 401);
  const session = await app.inject({ method: "POST", url: "/auth/bootstrap", headers: base, payload: { token: bootstrap } });
  assert.equal(session.statusCode, 200);
  const cookie = session.cookies[0]!;
  const headers = { ...base, cookie: `${cookie.name}=${cookie.value}`, "x-csrf-token": session.json().csrfToken };
  const newId = idFactory(2);
  const command = async (type: string, payload: unknown, status = 200, scope = projectId) => {
    const response = await app.inject({ method: "POST", url: "/commands", headers,
      payload: { apiVersion: 1, commandId: newId(), projectId: scope, type, payload } });
    assert.equal(response.statusCode, status, `${type}: ${response.body}`);
    return response.json();
  };
  const groupId = newId();
  await command("groups.create", { groupId, name: "Commerce", slug: "commerce", parentId: null }, 200, SYSTEM_SCOPE_ID);
  await command("groups.set-settings", { groupId, expectedRevision: 0,
    settings: { defaultModel: "group-model", defaultAdapter: "fake" } }, 200, SYSTEM_SCOPE_ID);
  await command("projects.create", { name: "Commerce", groupId, workspace: { kind: "directory", root: join(dir, "project") } });
  const get = (url: string) => app.inject({ url, headers });
  const view = async (id: string) => {
    const response = await get(`${path}/${id}`);
    assert.equal(response.statusCode, 200);
    return setupProposalViewSchema.parse(response.json().proposal);
  };
  const wait = async (id: string) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const proposal = await view(id);
      if (proposal.state !== "generating") return proposal;
      await delay(10);
    }
    assert.fail("proposal still generating");
  };
  const propose = async (mode = "project", flowId?: string) => {
    const id = newId();
    await command("setup.propose", { proposalId: id, request, mode, flowId });
    return id;
  };
  return { gateway, raw, newId, projectId, path, get, command, propose, view, wait };
}

test("project setup is reviewable and applies through receipted commands with resolved flow selectors", async (context) => {
  const skillId = idFactory(900)();
  const candidate = projectProposal();
  candidate.agents[0]!.config.skills.push({ skillId, version: "latest" });
  const { gateway, raw, newId, projectId, path, get, command, propose, view, wait } = await fixture(context,
    [{ text: JSON.stringify(candidate), usage, delayMs: 150 }]);
  await command("skills.create", { skillId, name: "commerce", description: "Commerce practice", content: "Skill body not sent" }, 200, SYSTEM_SCOPE_ID);
  const existing = [newId(), newId()];
  await command("agents.create", { agentId: existing[0], config: config("Existing Planner") });
  await command("agents.create", { agentId: existing[1], config: config("Existing Reviewer") });
  await command("relations.set", { expectedRevision: 0, relations: [{ from: existing[0], to: existing[1], kind: "reviews" }] });
  const id = await propose();
  assert.equal((await view(id)).state, "generating");
  const ready = await wait(id);
  assert.equal(ready.state, "ready");
  assert.equal(ready.tokens, 26);
  assert.equal(gateway.calls[0]?.model, "setup-lead");
  assert.equal(gateway.calls[0]?.effort, "high");
  const prompt = JSON.parse(gateway.calls[0]!.messages[0]!.content);
  assert.equal(prompt.context.defaultModel, "group-model");
  assert.deepEqual(prompt.context.adapters, ["fake"]);
  assert.ok(prompt.context.agents.some((agent: { name: string }) => agent.name === "Existing Planner"));
  assert.ok(!gateway.calls[0]!.messages[0]!.content.includes("Skill body not sent"));
  assert.equal((await get(path)).json().proposals[0].id, id);
  assert.equal((await get(`/projects/${newId()}/setup-proposals/${id}`)).statusCode, 404);
  const before = raw.prepare("SELECT count(*) AS count FROM command_receipts").get() as { count: number };
  await command("setup.apply", { proposalId: id, expectedRevision: ready.revision, edited: { ...ready.proposal, summary: "Edited" } });
  const applied = await view(id);
  assert.equal(applied.state, "applied");
  assert.equal(applied.proposal?.summary, "Edited");
  const { agentIds, teamIds, flowIds } = applied.applied!;
  assert.equal(agentIds.length, 2);
  assert.deepEqual(raw.prepare("SELECT lead_agent_id FROM teams WHERE id=?").get(teamIds[0]), { lead_agent_id: agentIds[0] });
  assert.equal(raw.prepare("SELECT count(*) FROM team_members WHERE team_id=?").pluck().get(teamIds[0]), 2);
  assert.equal(raw.prepare("SELECT count(*) FROM agent_relations WHERE project_id=?").pluck().get(projectId), 2);
  const saved = (await get(`/projects/${projectId}/flows/${flowIds[0]}`)).json();
  assert.deepEqual(saved.draft.nodes[1].agent, { agent: agentIds[0] });
  assert.deepEqual(saved.draft.nodes[1].review, { agent: { agent: agentIds[1] } });
  assert.deepEqual(saved.versions, []);
  assert.equal(raw.prepare("SELECT count(*) FROM command_receipts").pluck().get(), before.count + 6);
  assert.deepEqual(raw.prepare("SELECT input_tokens,output_tokens FROM usage_records WHERE setup_proposal_id=?").all(id),
    [{ input_tokens: 20, output_tokens: 6 }]);
});

test("invalid JSON is repaired once; unknown usage stays unknown", async (context) => {
  const { propose, wait, gateway, raw } = await fixture(context, [{ text: "invalid" }, { text: `\u0060\u0060\u0060json\n${JSON.stringify(flowOnly("New draft"))}\n\u0060\u0060\u0060` }]);
  const id = await propose("flow");
  const ready = await wait(id);
  assert.equal(ready.state, "ready");
  assert.equal(ready.tokens, null);
  assert.equal(gateway.calls.length, 2);
  assert.match(gateway.calls[1]!.messages[0]!.content, /JSON hợp lệ/);
  assert.equal(raw.prepare("SELECT count(*) FROM usage_records WHERE setup_proposal_id=? AND input_tokens IS NULL AND estimated_tokens > 0")
    .pluck().get(id), 2);
});

test("invalid relations, skills, adapters and workflows report issues after one repair", async (context) => {
  const candidate = projectProposal();
  candidate.relations.push({ fromKey: "tester", toKey: "builder", kind: "manages" });
  candidate.agents[0]!.config.skills.push({ skillId: idFactory(800)(), version: "latest" });
  candidate.agents[1]!.config.runtime.adapter = "opencode";
  candidate.flows[0]!.edges = [];
  const text = JSON.stringify(candidate);
  const { propose, wait, command, gateway } = await fixture(context, [{ text, usage }, { text, usage }]);
  const id = await propose();
  const invalid = await wait(id);
  assert.equal(invalid.state, "invalid");
  assert.equal(invalid.tokens, 52);
  assert.equal(gateway.calls.length, 2);
  assert.deepEqual(new Set(invalid.issues.map(({ path }) => path)), new Set([
    "relations", "agents.0.config.skills.0", "agents.1.config.runtime.adapter", "flows.0.nodes.1",
  ]));
  await command("setup.apply", { proposalId: id, expectedRevision: invalid.revision }, 409);
  await command("setup.discard", { proposalId: id, expectedRevision: invalid.revision });
  assert.equal((await wait(id)).state, "discarded");
});

test("apply detects a changed project and rolls back writes and receipts on a downstream failure", async (context) => {
  const { raw, newId, projectId, command, propose, view, wait } = await fixture(context, [{ text: JSON.stringify(projectProposal()) }]);
  const id = await propose();
  const ready = await wait(id);
  const existing = newId();
  await command("agents.create", { agentId: existing, config: config("Store Builder") });
  await command("setup.apply", { proposalId: id, expectedRevision: ready.revision }, 400);
  const clash = await view(id);
  assert.equal(clash.state, "ready");
  assert.equal(clash.issues[0]?.path, "agents.0.config.name");
  const edited = structuredClone(clash.proposal!);
  edited.agents[0]!.config.name = "New Builder";
  raw.exec(`CREATE TEMP TRIGGER reject_setup_flow BEFORE INSERT ON flows BEGIN SELECT RAISE(ABORT, 'test'); END`);
  const before = raw.prepare("SELECT count(*) FROM command_receipts").pluck().get() as number;
  await command("setup.apply", { proposalId: id, expectedRevision: clash.revision, edited }, 409);
  const failed = await view(id);
  assert.equal(failed.state, "ready");
  assert.equal(failed.issues[0]?.path, "flows.0");
  assert.deepEqual(raw.prepare("SELECT id FROM seats WHERE project_id=?").pluck().all(projectId), [existing]);
  assert.equal(raw.prepare("SELECT count(*) FROM teams WHERE project_id=? AND kind='group'").pluck().get(projectId), 0);
  assert.equal(raw.prepare("SELECT count(*) FROM agent_relations WHERE project_id=?").pluck().get(projectId), 0);
  assert.equal(raw.prepare("SELECT count(*) FROM command_receipts").pluck().get(), before + 1);
});

test("flow mode modifies only the draft and preserves the published version", async (context) => {
  const { raw, gateway, newId, projectId, command, propose, view, wait, get } = await fixture(context,
    [{ text: JSON.stringify(flowOnly("Revised")), usage }]);
  const flowId = newId();
  await command("flows.create", { flowId, definition: draft("Original") });
  await command("flows.publish", { flowId, expectedRevision: 1 });
  const id = await propose("flow", flowId);
  const ready = await wait(id);
  assert.equal(ready.state, "ready");
  assert.equal(JSON.parse(gateway.calls[0]!.messages[0]!.content).context.draft.title, "Original");
  await command("setup.apply", { proposalId: id, expectedRevision: ready.revision });
  assert.deepEqual((await view(id)).applied, { agentIds: [], teamIds: [], flowIds: [flowId] });
  const after = (await get(`/projects/${projectId}/flows/${flowId}`)).json();
  assert.equal(after.flow.revision, 3);
  assert.equal(after.draft.title, "Revised");
  assert.equal(after.versions.length, 1);
  assert.equal(JSON.parse(raw.prepare("SELECT definition_json FROM flow_versions WHERE flow_id=?").pluck().get(flowId) as string).title, "Original");
});

test("budget refusal is in Vietnamese and does not call the gateway", async (context) => {
  const { propose, wait, gateway } = await fixture(context, [], 1);
  const failed = await wait(await propose("flow"));
  assert.equal(failed.state, "failed");
  assert.equal(failed.tokens, null);
  assert.match(failed.issues[0]!.message, /Không đủ ngân sách/);
  assert.equal(gateway.calls.length, 0);
});
