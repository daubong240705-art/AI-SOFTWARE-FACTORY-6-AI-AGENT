#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { configPath, ConfigError, formatConfigError, loadConfig, resolveConfig, secretKey, type ConfigEnv, type ConfigIssue, type FactoryConfig } from "../config/index.js";
import { readConfigFile, serializeConfig } from "../config/file.js";
import { validModelUrl } from "../config/schema.js";
import { isLoopbackHost } from "../api/listen.js";
import { execDoctorCommand, runDoctor } from "../system/doctor.js";
import { probeModels } from "../system/model-probe.js";

const usage = "Dùng: factory setup [--non-interactive …] | factory doctor [--json] [--model] | factory config show|path";
const fail = (key: string, fix: string): never => {
  throw new ConfigError([{ code: "C-SETUP", key, message: "Không thể lưu thiết lập này.", fix }]);
};
const warn = (issues: ConfigIssue[]): void => {
  if (issues.length) process.stderr.write(`${formatConfigError(new ConfigError(issues))}\n`);
};

function showConfig(config: FactoryConfig, print: (line: string) => void): void {
  const secrets = Object.entries(config.env).filter(([key, value]) => secretKey(key) && value).map(([, value]) => value!);
  for (const key of Object.keys(config.env).sort()) {
    const value = config.env[key]!;
    const masked = secretKey(key) ? (value ? `••••${value.length > 4 ? value.slice(-4) : ""}` : "")
      : secrets.reduce((text, secret) => text.replaceAll(secret, "••••"), value);
    print(`${key}=${JSON.stringify(masked)} (${config.sources[key]})\n`);
  }
}

async function saveConfig(path: string, values: Record<string, string>, previous: string | undefined): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = await mkdtemp(join(dir, ".setup-"));
  try {
    const next = join(temp, "factory.env");
    await writeFile(next, serializeConfig(values), { flag: "wx", mode: 0o600 });
    if (previous !== undefined) {
      const backup = join(temp, "backup.env");
      await writeFile(backup, previous, { flag: "wx", mode: 0o600 });
      await rename(backup, `${path}.bak`);
    }
    await rename(next, path);
  } finally { await rm(temp, { recursive: true, force: true }); }
}

async function setup(args: string[], env: ConfigEnv, print: (line: string) => void): Promise<void> {
  const { values: flags } = parseArgs({ args, options: {
    "non-interactive": { type: "boolean" }, "base-url": { type: "string" }, "api-key-env": { type: "string" },
    "lead-model": { type: "string" }, "agent-models": { type: "string" }, port: { type: "string" }, listen: { type: "string" },
  } });
  const path = configPath(env);
  const previous = readConfigFile(path);
  if (previous.issues.length) throw new ConfigError(previous.issues);
  const existing = resolveConfig(env, previous.values, path);
  const values = { ...previous.values };
  const interactive = !flags["non-interactive"];
  if (interactive && !process.stdin.isTTY) fail("FACTORY_CONFIG", "Dùng terminal tương tác hoặc cờ --non-interactive.");
  let hidden = false;
  const output = new Writable({ write(chunk: Buffer, _encoding, done) {
    if (!hidden) process.stdout.write(chunk);
    done();
  } });
  const reader = interactive ? createInterface({ input: process.stdin, output, terminal: true, historySize: 0 }) : undefined;
  const cancelled = new AbortController();
  reader?.on("close", () => cancelled.abort());
  reader?.on("SIGINT", () => reader.close());
  const ask = async (prompt: string, fallback = ""): Promise<string> => {
    if (!reader) return fallback;
    return (await reader.question(`${prompt}${fallback ? ` [${fallback}]` : ""}: `, { signal: cancelled.signal })).trim() || fallback;
  };
  const askKey = async (): Promise<string | undefined> => {
    if (!reader) return previous.values.FACTORY_MODEL_API_KEY ?? previous.values.NINE_ROUTER_API_KEY;
    process.stdout.write("API key (ẩn; Enter để giữ key hiện tại hoặc tiếp tục mà không dùng key): ");
    hidden = true;
    try { return await reader.question("", { signal: cancelled.signal }) || previous.values.FACTORY_MODEL_API_KEY || previous.values.NINE_ROUTER_API_KEY; }
    finally { hidden = false; process.stdout.write("\n"); }
  };
  try {
    const answer = flags["base-url"] ?? await ask("URL model provider (none để bỏ qua)", existing.model?.legacy ? "" : existing.model?.baseUrl);
    const base = answer === "none" ? "" : answer;
    for (const key of ["FACTORY_MODEL_BASE_URL", "FACTORY_GATEWAY_URL", "FACTORY_MODEL_API_KEY", "NINE_ROUTER_API_KEY", "FACTORY_LEAD_MODEL", "FACTORY_AGENT_MODELS"])
      delete values[key];
    values.FACTORY_MODEL_PROVIDER = base ? "openai-compatible" : "none";
    if (base) {
      if (!validModelUrl(base)) fail("FACTORY_MODEL_BASE_URL", "Dùng URL HTTPS hoặc HTTP loopback không kèm thông tin đăng nhập.");
      let storedKey: string | undefined;
      const keyEnv = flags["api-key-env"];
      if (keyEnv !== undefined) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(keyEnv) || !env[keyEnv]) fail("FACTORY_MODEL_API_KEY", "Đặt API key trong biến môi trường chỉ định bởi --api-key-env.");
        storedKey = env[keyEnv];
      } else storedKey = await askKey();
      const key = storedKey ?? env.FACTORY_MODEL_API_KEY ?? env.NINE_ROUTER_API_KEY;
      if (key && /[\s\p{Cc}]/u.test(key)) fail("FACTORY_MODEL_API_KEY", "Dùng API key không chứa khoảng trắng hay ký tự điều khiển.");
      const models = await probeModels(base, key).catch(() => fail("FACTORY_MODEL_BASE_URL", "Kiểm tra /models, API key, CA và kết nối mạng rồi thử lại."));
      if (!models.length) fail("FACTORY_MODEL_BASE_URL", "Model provider phải trả về ít nhất một model qua /models.");
      if (interactive) process.stdout.write(`${models.map((name, index) => `${index + 1}. ${name}`).join("\n")}\n`);
      const pick = (answer: string): string => models.includes(answer) ? answer : /^\d+$/.test(answer) ? models[Number(answer) - 1] ?? answer : answer;
      const lead = pick(flags["lead-model"] ?? await ask("Model Lead (số hoặc mã)", models[0]!));
      const agents = (flags["agent-models"] ?? await ask("Model api-agent (số hoặc mã, phân cách bằng dấu phẩy; Enter để bỏ qua)"))
        .split(",").map((name) => name.trim()).filter(Boolean).map(pick);
      if (!models.includes(lead) || agents.some((name) => !models.includes(name))) fail("FACTORY_LEAD_MODEL / FACTORY_AGENT_MODELS", "Chọn các model có trong danh sách /models.");
      values.FACTORY_MODEL_BASE_URL = base;
      if (storedKey) values.FACTORY_MODEL_API_KEY = storedKey;
      values.FACTORY_LEAD_MODEL = lead;
      if (agents.length) values.FACTORY_AGENT_MODELS = agents.join(",");
      delete values.FACTORY_LEAD_CLI;
    } else if (flags["api-key-env"] || flags["lead-model"] || flags["agent-models"]) {
      fail("FACTORY_MODEL_BASE_URL", "Cần --base-url khi chọn API key hoặc model.");
    }
    values.FACTORY_PORT = flags.port ?? await ask("Cổng Host", existing.env.FACTORY_PORT);
    const listen = (flags.listen ?? await ask("Địa chỉ nghe", existing.env.FACTORY_LISTEN_HOST)).trim() || "127.0.0.1";
    values.FACTORY_LISTEN_HOST = listen;
    if (!isLoopbackHost(listen)) {
      if (!values.FACTORY_LOGIN_TOKEN) values.FACTORY_LOGIN_TOKEN = randomBytes(24).toString("base64url");
      values.FACTORY_OPEN_LOGIN = "0";
    } else values.FACTORY_OPEN_LOGIN ??= values.FACTORY_LOGIN_TOKEN ? "0" : "1";
    const commands = await Promise.all(["codex", "claude"].map(async (cli) => ({ cli, result: await execDoctorCommand(cli, ["--version"]) })));
    const available = commands.filter(({ result }) => result.code === 0).map(({ cli }) => cli);
    if (available.length || interactive) {
      const selected = await ask(`CLI agent mặc định (${[...available, "none"].join(" / ")})`, available[0] ?? "none");
      if (selected !== "none" && !available.includes(selected)) fail("FACTORY_DEFAULT_AGENT_CLI", "Chọn CLI đã cài trong PATH hoặc none.");
      values.FACTORY_LOCAL_CLI = selected === "none" ? "0" : "1";
      if (selected === "none") delete values.FACTORY_DEFAULT_AGENT_CLI;
      else values.FACTORY_DEFAULT_AGENT_CLI = selected;
    }
    const proposed = resolveConfig({ FACTORY_HOME: env.FACTORY_HOME }, values, path);
    const effective = resolveConfig(env, values, path);
    if (proposed.issues.length || effective.issues.length) throw new ConfigError(proposed.issues.length ? proposed.issues : effective.issues);
    await saveConfig(path, values, previous.text).catch(() => fail("FACTORY_CONFIG", "Kiểm tra quyền ghi thư mục cấu hình và file .bak."));
    print("Đã lưu cấu hình Factory (mode 600).\n");
  } finally { reader?.close(); }
}

export async function runFactory(args: string[], env: ConfigEnv = process.env, print = (line: string): void => { process.stdout.write(line); }): Promise<number> {
  const [command, subcommand] = args;
  if (command === "config" && args.length === 2 && subcommand === "path") { print(`${configPath(env)}\n`); return 0; }
  if (command === "config" && args.length === 2 && subcommand === "show") {
    const config = loadConfig(env);
    if (config.issues.length) throw new ConfigError(config.issues);
    warn(config.warnings);
    showConfig(config, print);
    return 0;
  }
  if (command === "doctor") {
    const { values } = parseArgs({ args: args.slice(1), options: { json: { type: "boolean" }, model: { type: "boolean" } } });
    const config = loadConfig(env);
    warn(config.warnings);
    const issues = config.issues.filter(({ code, key }) => !["FACTORY_LOGIN_TOKEN", "FACTORY_STATE_DIR", "FACTORY_LISTEN_HOST", "FACTORY_OPEN_LOGIN"].includes(key) || code !== "C-VALUE");
    if (issues.length) throw new ConfigError(issues);
    const report = await runDoctor({ config: config.env, stateDir: config.env.FACTORY_STATE_DIR!, port: Number(config.env.FACTORY_PORT),
      ...(config.env.FACTORY_UI_DIR === undefined ? {} : { uiDir: config.env.FACTORY_UI_DIR }), checkModel: values.model === true });
    if (values.json) print(`${JSON.stringify(report)}\n`);
    else for (const check of report.checks) {
      const mark = { pass: "✔", fail: "✖", skip: "–" }[check.status];
      print(`${mark}  ${check.id}  ${check.summary}${check.detail ? ` ${check.detail}` : ""}\n`);
      if (check.fix) print(`   Cách sửa: ${check.fix}\n`);
    }
    return report.ok ? 0 : 1;
  }
  if (command === "setup") { await setup(args.slice(1), env, print); return 0; }
  process.stderr.write(`${usage}\n`);
  return 1;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await runFactory(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(`${error instanceof ConfigError ? formatConfigError(error) : usage}\n`);
    process.exitCode = 1;
  }
}
