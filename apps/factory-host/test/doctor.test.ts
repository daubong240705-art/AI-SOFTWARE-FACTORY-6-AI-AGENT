import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createApiServer } from "../src/api/server.js";
import { createBootstrapGate, createSessionStore } from "../src/identity/index.js";
import { registerDoctorRoute } from "../src/system/doctor-route.js";
import { doctorResponseSchema, execDoctorCommand, runDoctor, type DoctorExec, type DoctorReport } from "../src/system/doctor.js";

const dummyKey = "synthetic-model-test-key";
const modelEnv = { FACTORY_MODEL_BASE_URL: "https://provider.example/v1", FACTORY_MODEL_API_KEY: dummyKey,
  FACTORY_LEAD_MODEL: "lead", FACTORY_AGENT_MODELS: "agent" };
const result = (code: number, stdout = "", stderr = "") => ({ code, stdout, stderr });
const check = (report: DoctorReport, id: string) => report.checks.find((item) => item.id === id)!;
const models = () => Response.json({ data: [{ id: "lead" }, { id: "agent" }] });
const completed = () => Response.json({ choices: [{ message: { content: "Hi" } }] });
const exec: DoctorExec = async (command, args) => command === process.execPath ? execDoctorCommand(command, args)
  : command === "claude" && args?.[0] === "auth" ? result(1, "", "unknown command") : result(0, "available");

async function scratch(context: TestContext): Promise<string> {
  const dir = await mkdtemp(join(process.cwd(), ".doctor-test-"));
  context.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("doctor checks real Node and SQLite WAL, and validates models and CLI login", async (context) => {
  const dir = await scratch(context);
  await writeFile(join(dir, "index.html"), "<html></html>");
  const methods: string[] = [];
  const fetchImpl: typeof fetch = async (url, options) => {
    assert.ok(new Headers(options?.headers).get("authorization") === `Bearer ${dummyKey}`);
    assert.equal(options?.redirect, "manual");
    methods.push(options?.method ?? "");
    if (String(url).endsWith("/models")) return models();
    assert.equal(String(url), "https://provider.example/v1/chat/completions");
    assert.equal(JSON.parse(String(options?.body)).max_tokens, 1);
    return completed();
  };
  const report = await runDoctor({ config: modelEnv, stateDir: dir, uiDir: dir, port: 1234, running: true,
    checkModel: true, fetch: fetchImpl, exec });
  assert.equal(report.ok, true);
  for (const id of ["D-NODE", "D-STATE", "D-MODEL", "D-CODEX"]) assert.equal(check(report, id).status, "pass");
  assert.equal(check(report, "D-CLAUDE").status, "skip");
  assert.deepEqual(methods, ["GET", "POST", "POST"]); // one 1-token call per selected model (lead, agent)
  assert.ok(!(await readdir(dir)).some((file) => file.startsWith(".doctor-")));
  assert.ok(!JSON.stringify(report).includes(dummyKey));
});

test("doctor reports a model missing from the provider and a CLI that is not logged in", async (context) => {
  const dir = await scratch(context);
  const report = await runDoctor({ config: { ...modelEnv, FACTORY_LEAD_MODEL: "missing", FACTORY_BACKUP_DIR: dir },
    stateDir: "/mnt/factory-doctor-not-written", port: 1234, running: true, fetch: async () => models(),
    exec: async (command, args) => command === "codex" && args?.[0] === "login" ? result(1, "Not logged in") : exec(command, args) });
  assert.equal(report.ok, false);
  for (const id of ["D-STATE", "D-MODEL", "D-CODEX"]) {
    assert.equal(check(report, id).status, "fail");
    assert.ok(check(report, id).fix);
  }
  // An unlisted model is only a warning: some gateways serve models they do not list.
  assert.equal(check(report, "D-MODEL").level, "warning");
});

test("doctor HTTP route requires a session and only completes when model=1", async (context) => {
  const dir = await scratch(context);
  let completions = 0;
  const sessions = createSessionStore();
  const app = createApiServer({ origins: ["http://localhost:8787"], gate: createBootstrapGate(), sessions, register(app, guards) {
    registerDoctorRoute(app, guards, 1, () => ({ config: modelEnv, stateDir: dir, port: 8787, running: true, exec,
      fetch: async (_url, options) => {
        if (options?.method === "POST") { completions++; return completed(); }
        return models();
      } }));
  } });
  context.after(() => app.close());
  const host = { host: "localhost:8787" };
  assert.equal((await app.inject({ url: "/system/doctor?model=1", headers: host })).statusCode, 401);
  const headers = { ...host, cookie: `factory_session=${sessions.create().id}` };
  const baseline = await app.inject({ url: "/system/doctor", headers });
  assert.equal(baseline.statusCode, 200);
  assert.equal(completions, 0);
  const response = await app.inject({ url: "/system/doctor?model=1", headers });
  assert.equal(response.statusCode, 200);
  assert.equal(completions, 2);
  assert.equal(check(doctorResponseSchema.parse(response.json()).report, "D-PORT").status, "pass");
  assert.ok(!response.body.includes(dummyKey));
});
