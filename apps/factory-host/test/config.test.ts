import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { runFactory } from "../src/cli/factory.js";
import { configPath, loadConfig, resolveConfig } from "../src/config/index.js";
import { parseConfigFile } from "../src/config/file.js";

const sampleKey = "synthetic-config-test-key";

async function scratch(context: TestContext): Promise<string> {
  const dir = await mkdtemp(join(process.cwd(), ".config-test-"));
  context.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("config parser treats quotes, comments and command substitutions as literal text", () => {
  const parsed = parseConfigFile(`# comment\r\nFACTORY_PORT = 8787 # port\nFACTORY_STATE_DIR='/dir with # hash'\nFACTORY_LITERAL="$(touch should-not-exist) $HOME \\"quote\\""\nFACTORY_LITERAL_RAW=$(false)\nPATH=/bin\n`, 0o644);
  assert.deepEqual(parsed.values, { FACTORY_PORT: "8787", FACTORY_STATE_DIR: "/dir with # hash",
    FACTORY_LITERAL: '$(touch should-not-exist) $HOME "quote"', FACTORY_LITERAL_RAW: "$(false)" });
  assert.deepEqual(parsed.issues.map(({ code }) => code), ["C-KEY"]);
  assert.equal(parseConfigFile('FACTORY_PORT="missing quote', 0o600).issues[0]?.code, "C-SYNTAX");
});

test("config discovery, mode checks, precedence and legacy directories", async (context) => {
  const home = await scratch(context);
  const factoryHome = join(home, "custom");
  const file = configPath({ FACTORY_HOME: factoryHome }, home);
  assert.equal(file, join(factoryHome, "config/factory.env"));
  assert.equal(configPath({}, home), join(home, ".factory/config/factory.env"));
  const empty = loadConfig({ FACTORY_HOME: factoryHome }, home);
  assert.equal(empty.env.FACTORY_STATE_DIR, join(factoryHome, "state"));
  assert.equal(empty.model, null);
  await mkdir(join(home, "factory-v2/state"), { recursive: true });
  assert.equal(loadConfig({ FACTORY_HOME: factoryHome }, home).env.FACTORY_STATE_DIR, join(home, "factory-v2/state"));
  await mkdir(join(factoryHome, "config"), { recursive: true });
  await writeFile(file, `FACTORY_PORT=1234\nFACTORY_MODEL_API_KEY=${sampleKey}\nFACTORY_STATE_DIR=${join(home, "explicit")}\n`);
  await chmod(file, 0o644);
  assert.equal(loadConfig({ FACTORY_CONFIG: file }, home).issues[0]?.code, "C-PERM");
  await chmod(file, 0o600);
  const config = loadConfig({ FACTORY_CONFIG: file, FACTORY_PORT: "4321" }, home);
  assert.deepEqual(config.issues, []);
  assert.equal(config.env.FACTORY_PORT, "4321");
  assert.equal(config.env.FACTORY_STATE_DIR, join(home, "explicit"));
  assert.equal(config.sources.FACTORY_PORT, "env");
  assert.equal(config.sources.FACTORY_STATE_DIR, "file");
  assert.equal(config.sources.FACTORY_NODE_SLOTS, "default");
});

test("model aliases honor precedence and reject conflicting keys without exposing them", () => {
  const config = resolveConfig({ FACTORY_GATEWAY_URL: "https://env.example/v1", NINE_ROUTER_API_KEY: sampleKey },
    { FACTORY_MODEL_BASE_URL: "https://file.example/v1", FACTORY_MODEL_API_KEY: sampleKey }, "/unused");
  assert.equal(config.model?.baseUrl, "https://env.example/v1");
  assert.equal(config.sources.FACTORY_MODEL_BASE_URL, "env");
  assert.ok(config.model?.apiKey === sampleKey);
  assert.deepEqual(config.issues, []);
  const conflict = resolveConfig({ NINE_ROUTER_API_KEY: sampleKey }, { FACTORY_MODEL_API_KEY: "different-synthetic-key" }, "/unused");
  assert.equal(conflict.issues[0]?.code, "C-CONFLICT");
  assert.ok(!JSON.stringify(conflict.issues).includes(sampleKey));
});

test("the deprecated key needs an explicit model base URL", () => {
  const config = resolveConfig({ NINE_ROUTER_API_KEY: sampleKey }, {}, "/unused");
  assert.equal(config.model, null);
  assert.equal(config.env.FACTORY_MODEL_BASE_URL, undefined);
  assert.equal(config.env.FACTORY_MODEL_API_KEY, undefined);
  assert.equal(config.warnings.length, 1);
  assert.match(config.warnings[0]!.fix, /set FACTORY_MODEL_BASE_URL/);
  const configured = resolveConfig({ FACTORY_MODEL_BASE_URL: "https://gateway.example/v1", NINE_ROUTER_API_KEY: sampleKey }, {}, "/unused");
  assert.equal(configured.model?.baseUrl, "https://gateway.example/v1");
  assert.ok(configured.model?.apiKey === sampleKey);
  assert.equal(configured.warnings[0]?.code, "C-DEPRECATED");
  assert.equal(resolveConfig({ FACTORY_MODEL_API_KEY: sampleKey }, {}, "/unused").model, null);
  assert.equal(resolveConfig({ NINE_ROUTER_API_KEY: sampleKey, FACTORY_MODEL_PROVIDER: "none" }, {}, "/unused").model, null);
});

test("non-interactive setup checks models and creates a private config and backup", async (context) => {
  const dir = await scratch(context);
  const file = join(dir, "config/factory.env");
  const env = { PATH: process.env.PATH, HOME: dir, FACTORY_CONFIG: file, SETUP_TEST_KEY: sampleKey };
  context.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (url !== "http://127.0.0.1:9999/v1/models" || new Headers(init.headers).get("authorization") !== `Bearer ${sampleKey}`)
      return new Response(null, { status: 401 });
    return Response.json({ data: [{ id: "lead" }, { id: "agent" }] });
  });
  const setupArgs = ["setup", "--non-interactive", "--base-url", "http://127.0.0.1:9999/v1",
    "--api-key-env", "SETUP_TEST_KEY", "--lead-model", "lead", "--agent-models", "agent", "--listen", "192.0.2.10"];
  const output: string[] = [];
  const print = (line: string): void => { output.push(line); };
  assert.equal(await runFactory([...setupArgs, "--port", "4321"], env, print), 0);
  assert.ok(!output.join("").includes(sampleKey));
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const first = await readFile(file, "utf8");
  const config = loadConfig(env, dir);
  assert.equal(config.env.FACTORY_PORT, "4321");
  assert.equal(config.env.FACTORY_LEAD_MODEL, "lead");
  assert.equal(config.env.FACTORY_AGENT_MODELS, "agent");
  assert.ok((config.env.FACTORY_LOGIN_TOKEN?.length ?? 0) >= 24);
  assert.ok(config.env.FACTORY_MODEL_API_KEY === sampleKey);
  assert.equal(await runFactory(["config", "show"], env, print), 0);
  const shown = output.join("");
  assert.ok(!shown.includes(sampleKey) && !shown.includes(config.env.FACTORY_LOGIN_TOKEN!));
  assert.match(shown, /FACTORY_MODEL_API_KEY="••••-key" \(file\)/);
  assert.equal(await runFactory([...setupArgs, "--port", "4322"], env, print), 0);
  assert.equal((await stat(`${file}.bak`)).mode & 0o777, 0o600);
  assert.ok(await readFile(`${file}.bak`, "utf8") === first);
});
