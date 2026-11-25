import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { agentConfigSchema, agentTemplateDetailSchema, failureResponseSchema, libraryResponseSchema, skillVersionSchema } from "@factory/contracts";
import fastify from "fastify";
import { findPackTemplate, getSkillVersion, getTemplateDetail, importPackToLibrary, importPacksToLibrary,
  listLibrary, registerLibraryRoutes, seatToAgentConfig } from "../src/library/index.js";
import { loadPack } from "../src/org/pack.js";
import { loadPackRegistry, registryEntry } from "../src/org/registry.js";
import { fixedClock, idFactory, migratedStorage } from "./helpers.js";

const packsDir = new URL("../../../../packs/", import.meta.url);
const load = (key: string) => loadPack(fileURLToPath(new URL(key, packsDir)));
const deps = () => ({ newId: idFactory(), clock: fixedClock() });
const libraryCounts = (raw: ReturnType<typeof migratedStorage>["raw"]) =>
  ["skills", "skill_versions", "agent_templates", "agent_template_revisions"].map((table) =>
    raw.prepare<[], { count: number }>(`SELECT count(*) AS count FROM ${table}`).get()!.count);

test("imports the software-team skills and a template with pinned skills for each seat", (context) => {
  const storage = migratedStorage();
  context.after(() => storage.close());
  const { raw } = storage;
  const pack = load("software-team");
  const { skills, templates } = importPackToLibrary(raw, pack, deps());
  assert.deepEqual(libraryCounts(raw), [pack.files.skills.length, pack.files.skills.length, pack.manifest.seats.length, pack.manifest.seats.length]);
  assert.deepEqual(skills.map(({ name }) => name), pack.files.skills.map(({ name }) => name));
  assert.deepEqual(templates.map(({ seatName }) => seatName), pack.manifest.seats.map(({ name }) => name));
  for (const skill of skills) {
    assert.equal(skill.created, true);
    const file = pack.files.skills.find(({ name }) => name === skill.name)!;
    const version = getSkillVersion(raw, skill.skillId, 1);
    assert.equal(version?.description, (file.description.trim() || pack.manifest.description).slice(0, 1_024));
    assert.equal(version?.sha256, createHash("sha256").update(file.content).digest("hex"));
  }
  for (const template of templates) {
    assert.equal(template.created, true);
    const detail = getTemplateDetail(raw, template.templateId);
    assert.equal(detail?.template.description, pack.manifest.description);
    assert.deepEqual(agentConfigSchema.parse(detail?.config).skills, skills.map(({ skillId, version }) => ({ skillId, version })));
  }
});

test("reimporting the same pack reuses all versions and revisions without adding rows", (context) => {
  const storage = migratedStorage();
  context.after(() => storage.close());
  const { raw } = storage;
  const pack = load("software-team");
  const importDeps = deps();
  const first = importPackToLibrary(raw, pack, importDeps);
  const counts = libraryCounts(raw);
  const second = importPackToLibrary(raw, pack, importDeps);
  assert.deepEqual(second.skills, first.skills.map((skill) => ({ ...skill, created: false })));
  assert.deepEqual(second.templates, first.templates.map((template) => ({ ...template, created: false })));
  assert.deepEqual(libraryCounts(raw), counts);
});

test("a new pack version advances changed skills and creates new seat templates", (context) => {
  const storage = migratedStorage();
  context.after(() => storage.close());
  const { raw } = storage;
  const pack = load("software-team");
  const importDeps = deps();
  const oldVersion = pack.manifest.version;
  const first = importPackToLibrary(raw, pack, importDeps);
  pack.manifest.version = "1.2.3";
  pack.files.skills[0]!.content += "\nUpdated pack skill.";
  const second = importPackToLibrary(raw, pack, { ...importDeps, clock: fixedClock("2026-11-20T10:00:00.000Z") });
  assert.deepEqual(second.skills, first.skills.map((skill, index) => ({ ...skill, version: index === 0 ? 2 : 1, created: index === 0 })));
  assert.deepEqual(libraryCounts(raw), [first.skills.length, first.skills.length + 1, first.templates.length * 2, first.templates.length * 2]);
  assert.deepEqual(raw.prepare("SELECT latest_version, revision, updated_at FROM skills WHERE id = ?").get(first.skills[0]!.skillId),
    { latest_version: 2, revision: 2, updated_at: "2026-11-20T10:00:00.000Z" });
  for (const [index, template] of second.templates.entries()) {
    assert.equal(template.created, true);
    assert.equal(template.revision, 1);
    assert.notEqual(template.templateId, first.templates[index]?.templateId);
    const old = findPackTemplate(raw, pack.manifest.key, oldVersion, template.seatName);
    assert.equal(old?.templateId, first.templates[index]?.templateId);
    assert.ok(old?.config.skills.every(({ version }) => version === 1));
    const updated = findPackTemplate(raw, pack.manifest.key, pack.manifest.version, template.seatName);
    assert.equal(updated?.templateId, template.templateId);
    assert.deepEqual(updated?.config.skills, second.skills.map(({ skillId, version }) => ({ skillId, version })));
  }
});

test("seatToAgentConfig maps runtimes, slots, profiles, tags, tools and lead delegation", () => {
  const pack = load("design-team");
  const lead = pack.manifest.seats.find(({ isLead }) => isLead)!;
  const worker = pack.manifest.seats.find(({ isLead, capabilities }) => !isLead && capabilities?.length)!;
  const leadConfig = seatToAgentConfig(pack, lead.name, []);
  const workerConfig = seatToAgentConfig(pack, worker.name, []);
  assert.equal(leadConfig.runtime.adapter, "codex");
  assert.equal(leadConfig.delegation.canAssign, "project");
  assert.equal(workerConfig.runtime.adapter, "opencode");
  assert.equal(workerConfig.runtime.maxConcurrent, worker.slots);
  assert.equal(workerConfig.delegation.canAssign, "none");
  assert.equal(workerConfig.instructions, pack.files.profiles.find(({ path }) => path === worker.profile)?.content);
  assert.deepEqual(workerConfig.tags, worker.capabilities);
  assert.deepEqual(workerConfig.tools, worker.tools?.map((tool) => ({ tool, mode: "allow" })));
  lead.runtime = "acp";
  assert.equal(seatToAgentConfig(pack, lead.name, []).runtime.adapter, "codex");
  lead.runtime = "fake";
  assert.equal(seatToAgentConfig(pack, lead.name, []).runtime.adapter, "fake");
  const software = load("software-team");
  const noOverrides = seatToAgentConfig(software, software.manifest.seats.find(({ tools }) => tools === undefined)!.name, []);
  assert.deepEqual(noOverrides.tags, []);
  assert.equal(noOverrides.tools, null);
});

test("imports every current registry pack without errors", (context) => {
  const storage = migratedStorage();
  context.after(() => storage.close());
  const errors: string[] = [];
  const packs = loadPackRegistry(fileURLToPath(packsDir), { onError: (message) => errors.push(message) });
  const results = importPacksToLibrary(storage.raw, packs, deps(), (key, message) => errors.push(`${key}: ${message}`));
  assert.deepEqual(errors, []);
  assert.ok(packs.some(({ key }) => key === "software-team"));
  assert.ok(packs.some(({ key }) => key === "design-team"));
  assert.deepEqual(results.map(({ templates }) => templates.length), packs.map(({ seats }) => seats.length));
});

test("reads schema-valid summaries, versioned skill content and template details", (context) => {
  const storage = migratedStorage();
  context.after(() => storage.close());
  const { raw } = storage;
  const pack = load("_template");
  const importDeps = deps();
  const first = importPackToLibrary(raw, pack, importDeps);
  const { skillId } = first.skills[0]!;
  const skillFile = pack.files.skills[0]!;
  const initial = skillFile.content;
  skillFile.content += "\nSecond version.";
  importPackToLibrary(raw, pack, importDeps);
  const library = libraryResponseSchema.parse(listLibrary(raw));
  assert.equal(library.skills[0]?.latestVersion, 2);
  assert.equal(library.skills[0]?.trust, "instructions");
  assert.equal(library.skills[0]?.source, `pack:${pack.manifest.key}`);
  const latest = skillVersionSchema.parse(getSkillVersion(raw, skillId, "latest"));
  assert.equal(latest.version, 2);
  assert.equal(latest.content, skillFile.content);
  assert.equal(getSkillVersion(raw, skillId, 1)?.content, initial);
  assert.equal(getSkillVersion(raw, skillId, 3), undefined);
  const { templateId } = first.templates[0]!;
  const detail = agentTemplateDetailSchema.parse(getTemplateDetail(raw, templateId));
  assert.deepEqual(detail.template.source, { packKey: pack.manifest.key, packVersion: pack.manifest.version });
  assert.deepEqual(detail.config.skills, [{ skillId, version: 1 }]);
  assert.deepEqual(getTemplateDetail(raw, templateId, 1), detail);
  assert.equal(getTemplateDetail(raw, templateId, 2), undefined);
});

test("library routes use the session guard and return validated details or 404", async (context) => {
  const storage = migratedStorage();
  const app = fastify();
  context.after(async () => { await app.close(); storage.close(); });
  const { skills, templates } = importPackToLibrary(storage.raw, load("software-team"), deps());
  let sessions = 0;
  registerLibraryRoutes(app, { session: async () => { sessions++; }, write: async () => {}, hostAllowed: () => true }, { raw: storage.raw });
  const library = await app.inject({ method: "GET", url: "/library" });
  assert.equal(library.statusCode, 200);
  assert.equal(libraryResponseSchema.parse(unwrap(library.json())).skills.length, skills.length);
  const skillUrl = `/library/skills/${skills[0]!.skillId}/versions`;
  const templateUrl = `/library/templates/${templates[0]!.templateId}`;
  const skill = await app.inject({ method: "GET", url: `${skillUrl}/latest` });
  assert.equal(skill.statusCode, 200);
  assert.equal(skillVersionSchema.parse(unwrap(skill.json())).version, 1);
  const template = await app.inject({ method: "GET", url: `${templateUrl}?revision=1` });
  assert.equal(template.statusCode, 200);
  assert.equal(agentTemplateDetailSchema.parse(unwrap(template.json())).revision, 1);
  const missing = ["/library/templates/unknown", `${templateUrl}?revision=-1`, `${templateUrl}?revision=2`,
    `${skillUrl}/1.0`, `${skillUrl}/2`];
  for (const url of missing) {
    const response = await app.inject({ method: "GET", url });
    assert.equal(response.statusCode, 404);
    assert.equal(failureResponseSchema.parse(response.json()).error.code, "not-found");
  }
  assert.equal(sessions, 3 + missing.length);
});

test("oversized skills are reported and skipped while valid skills are normalized and pinned", (context) => {
  const storage = migratedStorage();
  context.after(() => storage.close());
  const pack = load("software-team");
  pack.files.skills[0]!.content = "x".repeat(65_537);
  pack.files.skills[1]!.name = "-Upper_Case-";
  const errors: { key: string; message: string }[] = [];
  const [result] = importPacksToLibrary(storage.raw, [registryEntry(pack)], deps(), (key, message) => errors.push({ key, message }));
  assert.ok(result);
  assert.equal(result.skills.length, pack.files.skills.length - 1);
  assert.equal(result.skills[0]?.name, "upper-case");
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.key, pack.manifest.key);
  assert.match(errors[0]!.message, /skipped.*65,536/);
  const config = getTemplateDetail(storage.raw, result.templates[0]!.templateId)?.config;
  assert.deepEqual(config?.skills, result.skills.map(({ skillId, version }) => ({ skillId, version })));
});

test("a failing pack rolls back all its rows without stopping later imports", (context) => {
  const storage = migratedStorage();
  context.after(() => storage.close());
  const broken = load("software-team");
  broken.files.profiles.pop();
  const valid = load("design-team");
  const failures: string[] = [];
  const results = importPacksToLibrary(storage.raw, [registryEntry(broken), registryEntry(valid)], deps(), (key) => failures.push(key));
  assert.deepEqual(failures, [broken.manifest.key]);
  assert.equal(results.length, 1);
  assert.deepEqual(libraryCounts(storage.raw), [valid.files.skills.length, valid.files.skills.length, valid.manifest.seats.length, valid.manifest.seats.length]);
});

function unwrap(body: unknown): unknown {
  assert.ok(typeof body === "object" && body !== null);
  const { ok, apiVersion, ...rest } = body as Record<string, unknown>;
  assert.equal(ok, true); assert.equal(apiVersion, 1);
  return rest;
}
