import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_LEAD_CONFIG } from "../lead/runner.js";
import { DEFAULT_BUDGET_CONFIG } from "../policy/budget.js";
import { readConfigFile } from "./file.js";
import { configKey, validateConfig, type ConfigEnv, type ConfigIssue } from "./schema.js";

export { ConfigError, configError, formatConfigError, secretKey } from "./schema.js";
export type { ConfigEnv, ConfigIssue } from "./schema.js";

export type ConfigSource = "env" | "file" | "default";
export interface ModelProvider { baseUrl: string; apiKey?: string; legacy: boolean; providerId: "openai-compatible" | "9router" }
export interface FactoryConfig {
  path: string; env: ConfigEnv; sources: Readonly<Record<string, ConfigSource>>;
  model: ModelProvider | null; issues: ConfigIssue[]; warnings: ConfigIssue[];
}

export function configPath(env: ConfigEnv = process.env, home = homedir()): string {
  return resolve(env.FACTORY_CONFIG ?? join(env.FACTORY_HOME ?? join(home, ".factory"), "config", "factory.env"));
}

export function directoryDefaults(env: ConfigEnv, home = homedir()): Record<string, string> {
  const factoryHome = env.FACTORY_HOME ?? join(home, ".factory");
  const legacyRoot = join(home, "factory-v2");
  const legacy = existsSync(join(legacyRoot, "state"));
  const root = legacy ? legacyRoot : factoryHome;
  const state = env.FACTORY_STATE_DIR ?? join(root, "state");
  return {
    FACTORY_HOME: factoryHome, FACTORY_STATE_DIR: state,
    FACTORY_PROJECTS_ROOT: legacy && existsSync("/srv/factory/workspaces") ? "/srv/factory/workspaces" : join(root, "workspaces"),
    FACTORY_WORKTREES_ROOT: join(root, "worktrees"),
    FACTORY_MIGRATION_BACKUP_DIR: join(state, "backups"),
    FACTORY_BACKUP_DIR: legacy && existsSync("/mnt/d") ? "/mnt/d/factory-backup" : join(state, "backups", "periodic"),
    FACTORY_DOC_WORKER_PYTHON: join(root, "doc-worker", "venv", "bin", "python"),
    FACTORY_UI_DIR: fileURLToPath(new URL("../../../factory-ui/dist/", import.meta.url)),
  };
}

export function applyLegacyNineRouterLeadDefault(env: ConfigEnv, warnings: ConfigIssue[]): string | undefined {
  if (!env.NINE_ROUTER_API_KEY || env.FACTORY_MODEL_BASE_URL !== undefined || env.FACTORY_MODEL_PROVIDER === "none") return undefined;
  warnings.push({ code: "C-DEPRECATED", key: "NINE_ROUTER_API_KEY", message: "Đang dùng địa chỉ mặc định cũ của 9Router.",
    fix: "Hãy đặt FACTORY_MODEL_BASE_URL (set FACTORY_MODEL_BASE_URL)." });
  return "https://ai.lazy.local/v1";
}

export function resolveConfig(realEnv: ConfigEnv, file: Readonly<Record<string, string>>, path: string, home = homedir()): FactoryConfig {
  const env: Record<string, string> = {};
  const sources: Record<string, ConfigSource> = {};
  const issues: ConfigIssue[] = [];
  const warnings: ConfigIssue[] = [];
  const put = (key: string, value: string, source: ConfigSource): void => { env[key] = value; sources[key] = source; };
  for (const [key, value] of Object.entries(file)) if (configKey(key)) put(key, value, "file");
  for (const [key, value] of Object.entries(realEnv)) if (configKey(key) && value !== undefined) put(key, value, "env");
  if (env.FACTORY_MODEL_API_KEY !== undefined && env.NINE_ROUTER_API_KEY !== undefined && env.FACTORY_MODEL_API_KEY !== env.NINE_ROUTER_API_KEY)
    issues.push({ code: "C-CONFLICT", key: "FACTORY_MODEL_API_KEY", message: "API key mới và cũ không trùng nhau.",
      fix: "Chỉ đặt một trong FACTORY_MODEL_API_KEY hoặc NINE_ROUTER_API_KEY, hoặc đặt cùng giá trị." });
  const alias = (canonical: string, legacy: string): void => {
    const selected = env[canonical] !== undefined && (sources[legacy] !== "env" || sources[canonical] === "env") ? canonical : legacy;
    const value = env[selected];
    if (value !== undefined) { put(canonical, value, sources[selected]!); put(legacy, value, sources[selected]!); }
  };
  const usesLegacyNames = env.FACTORY_MODEL_BASE_URL === undefined && env.FACTORY_MODEL_API_KEY === undefined && Boolean(env.NINE_ROUTER_API_KEY);
  alias("FACTORY_MODEL_BASE_URL", "FACTORY_GATEWAY_URL");
  const compatUrl = applyLegacyNineRouterLeadDefault(env, warnings);
  alias("FACTORY_MODEL_API_KEY", "NINE_ROUTER_API_KEY");
  if (compatUrl !== undefined) put("FACTORY_MODEL_BASE_URL", compatUrl, "default");
  const baseUrl = env.FACTORY_MODEL_BASE_URL ?? compatUrl;
  const providerSource = sources.FACTORY_MODEL_PROVIDER;
  for (const [key, value] of Object.entries({
    ...directoryDefaults(env, home), FACTORY_CONFIG: path, FACTORY_PORT: "8787", FACTORY_LISTEN_HOST: "127.0.0.1",
    FACTORY_RUNTIME: "fake", FACTORY_BACKUP_INTERVAL_MINUTES: "60", FACTORY_NODE_SLOTS: "2",
    FACTORY_DEFAULT_PACK: "software-team", FACTORY_LOCAL_CLI: "0", FACTORY_OPEN_LOGIN: "0",
    FACTORY_LEAD_MODEL: DEFAULT_LEAD_CONFIG.model, FACTORY_LEAD_EFFORT: DEFAULT_LEAD_CONFIG.effort ?? "medium",
    FACTORY_BUDGET_TASK_TOKENS: String(DEFAULT_BUDGET_CONFIG.defaultTaskTokens), FACTORY_BUDGET_DAY_TOKENS: String(DEFAULT_BUDGET_CONFIG.defaultDayTokens),
    FACTORY_MODEL_PROVIDER: baseUrl === undefined ? "none" : "openai-compatible",
  })) if (env[key] === undefined) put(key, value, "default");
  put("FACTORY_CONFIG", path, realEnv.FACTORY_CONFIG === undefined ? "default" : "env");
  if (providerSource && env.FACTORY_MODEL_PROVIDER === "openai-compatible" && baseUrl === undefined)
    issues.push({ code: "C-VALUE", key: "FACTORY_MODEL_BASE_URL", message: "Thiếu địa chỉ model provider.",
      fix: "Đặt FACTORY_MODEL_BASE_URL hoặc dùng FACTORY_MODEL_PROVIDER=none." });
  const model: ModelProvider | null = env.FACTORY_MODEL_PROVIDER === "openai-compatible" && baseUrl ? {
    baseUrl, ...(env.FACTORY_MODEL_API_KEY ? { apiKey: env.FACTORY_MODEL_API_KEY } : {}), legacy: compatUrl !== undefined,
    providerId: usesLegacyNames ? "9router" : "openai-compatible",
  } : null;
  return { path, env, sources, model, issues: [...issues, ...validateConfig(env)], warnings };
}

export function loadConfig(realEnv: ConfigEnv = process.env, home = homedir()): FactoryConfig {
  const path = configPath(realEnv, home);
  const parsed = readConfigFile(path);
  const config = resolveConfig(realEnv, parsed.values, path, home);
  config.issues.unshift(...parsed.issues);
  return config;
}

