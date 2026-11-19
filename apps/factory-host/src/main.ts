import { parseEnv, startHost } from "./host.js";
import { createChatCompletionsGateway, createClaudeCliGateway } from "./models/index.js";
import { DEFAULT_BUDGET_CONFIG } from "./policy/index.js";
import { reasoningEffortSchema } from "@factory/contracts";
import type { LeadConfig } from "./lead/runner.js";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { randomBytes } from "node:crypto";
import { isSandboxAvailable } from "./sandbox/index.js";
import { createOpenCodeRuntime } from "./runtimes/index.js";
import { validateRoots } from "./workspace/paths.js";
import { portalConfig } from "./publish/service.js";
import { notificationConfig } from "./notify/channels.js";
import { ConfigError, configError, formatConfigError, loadConfig, type ConfigEnv, type ModelProvider } from "./config/index.js";
import { allowedHosts } from "./config/schema.js";

const hostOnly = new Set(["FACTORY_LOGIN_TOKEN", "FACTORY_PORTAL_TOKEN", "FACTORY_TELEGRAM_BOT_TOKEN", "FACTORY_TELEGRAM_CHAT_ID",
  "FACTORY_TELEGRAM_ALLOWED_USERS", "FACTORY_DISCORD_WEBHOOK_URL", "FACTORY_NOTIFY_BASE_URL"]);

function upstreamOptions(model: ModelProvider) {
  const { providerId } = model;
  if (model.apiKey) return { baseUrl: model.baseUrl, apiKey: model.apiKey, providerId };
  const fetchImpl: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.delete("authorization");
    return fetch(input, { ...init, headers });
  };
  return { baseUrl: model.baseUrl, apiKey: randomBytes(24).toString("base64url"), providerId, fetchImpl };
}

function parsePortal(env: ConfigEnv) {
  try {
    return portalConfig({
      ...(env.FACTORY_PORTAL_URL === undefined ? {} : { url: env.FACTORY_PORTAL_URL }),
      ...(env.FACTORY_PORTAL_TOKEN === undefined ? {} : { token: env.FACTORY_PORTAL_TOKEN }),
      ...(env.FACTORY_PORTAL_PUBLIC_URL === undefined ? {} : { publicUrl: env.FACTORY_PORTAL_PUBLIC_URL }),
      allowPrivateHttp: env.FACTORY_PORTAL_ALLOW_PRIVATE_HTTP === "1",
    });
  } catch { throw configError("FACTORY_PORTAL_URL / FACTORY_PORTAL_TOKEN / FACTORY_PORTAL_PUBLIC_URL"); }
}

function parseNotifications(env: ConfigEnv) {
  try {
    return notificationConfig({
      ...(env.FACTORY_TELEGRAM_BOT_TOKEN === undefined ? {} : { botToken: env.FACTORY_TELEGRAM_BOT_TOKEN }),
      ...(env.FACTORY_TELEGRAM_CHAT_ID === undefined ? {} : { chatId: env.FACTORY_TELEGRAM_CHAT_ID }),
      ...(env.FACTORY_TELEGRAM_ALLOWED_USERS === undefined ? {} : { allowedUsers: env.FACTORY_TELEGRAM_ALLOWED_USERS }),
      ...(env.FACTORY_DISCORD_WEBHOOK_URL === undefined ? {} : { webhookUrl: env.FACTORY_DISCORD_WEBHOOK_URL }),
      ...(env.FACTORY_NOTIFY_BASE_URL === undefined ? {} : { baseUrl: env.FACTORY_NOTIFY_BASE_URL }),
    });
  } catch { throw configError("FACTORY_TELEGRAM_* / FACTORY_DISCORD_WEBHOOK_URL / FACTORY_NOTIFY_BASE_URL"); }
}

try {
  const config = loadConfig();
  if (config.issues.length) throw new ConfigError(config.issues);
  if (config.warnings.length) process.stderr.write(`${formatConfigError(new ConfigError(config.warnings))}\n`);
  const { env } = config;
  const portal = parsePortal(env);
  const notify = parseNotifications(env);
  const { dispatch, workspace, agentProxy, opencode, pushRemotes, pushSshCommand, localCli, cliPassEnv, ...hostOptions } = parseEnv(env);
  const passEnv = cliPassEnv?.filter((key) => !hostOnly.has(key));
  if (opencode && (!config.model || config.model.legacy)) throw configError("FACTORY_RUNTIME / FACTORY_MODEL_BASE_URL");
  if (opencode && !await isSandboxAvailable()) throw new ConfigError([{ code: "C-RUNTIME", key: "FACTORY_RUNTIME",
    message: "OpenCode cần bubblewrap hoạt động trên Linux.", fix: "Chạy factory doctor để kiểm tra D-BWRAP hoặc tắt runtime OpenCode." }]);
  if (opencode) {
    try { validateRoots(workspace); }
    catch { throw configError("FACTORY_PROJECTS_ROOT / FACTORY_WORKTREES_ROOT"); }
    for (const [name, path] of [["FACTORY_PROJECTS_ROOT", workspace.projectsRoot], ["FACTORY_WORKTREES_ROOT", workspace.worktreesRoot]] as const) {
      try { await access(path, constants.R_OK | constants.W_OK | constants.X_OK); }
      catch { throw configError(name); }
    }
    try { await access(`${opencode.dir}/bin/opencode`, constants.R_OK | constants.X_OK); }
    catch { throw configError("FACTORY_OPENCODE_DIR"); }
  }
  const runtimes = opencode ? [createOpenCodeRuntime({ roots: { ...workspace, stateDir: hostOptions.stateDir }, opencodeDir: opencode.dir })] : [];
  const lead: Partial<LeadConfig> = {};
  if (env.FACTORY_LEAD_MODEL !== undefined) lead.model = env.FACTORY_LEAD_MODEL;
  if (env.FACTORY_LEAD_MAX_OUTPUT_TOKENS !== undefined) lead.maxOutputTokens = Number(env.FACTORY_LEAD_MAX_OUTPUT_TOKENS);
  else if (env.FACTORY_LEAD_CLI === "claude") lead.maxOutputTokens = 16_384;
  if (env.FACTORY_LEAD_TIMEOUT_SECONDS !== undefined) lead.timeoutMs = Number(env.FACTORY_LEAD_TIMEOUT_SECONDS) * 1000;
  if (env.FACTORY_LEAD_EFFORT !== undefined) lead.effort = reasoningEffortSchema.parse(env.FACTORY_LEAD_EFFORT);
  const budgetConfig = { ...DEFAULT_BUDGET_CONFIG,
    defaultTaskTokens: Number(env.FACTORY_BUDGET_TASK_TOKENS ?? DEFAULT_BUDGET_CONFIG.defaultTaskTokens),
    defaultDayTokens: Number(env.FACTORY_BUDGET_DAY_TOKENS ?? DEFAULT_BUDGET_CONFIG.defaultDayTokens),
  };
  const upstream = config.model ? upstreamOptions(config.model) : null;
  const modelGateway = env.FACTORY_LEAD_CLI === "claude" ? createClaudeCliGateway({ ...(passEnv === undefined ? {} : { passEnv }) })
    : upstream === null ? null : createChatCompletionsGateway(upstream);
  const modelProxy = upstream && !config.model?.legacy && agentProxy ? { ...agentProxy, upstream } : null;
  let uiDir = env.FACTORY_UI_DIR;
  if (uiDir && config.sources.FACTORY_UI_DIR === "default") {
    try { if (!(await stat(uiDir)).isDirectory()) uiDir = undefined; } catch { uiDir = undefined; }
  }
  const listenHost = env.FACTORY_LISTEN_HOST?.trim() || "127.0.0.1";
  const loginToken = env.FACTORY_LOGIN_TOKEN || undefined;
  const host = await startHost({ ...hostOptions, config: env, portal, portalConfigured: Boolean(env.FACTORY_PORTAL_URL), notify,
    listenHost, allowedHosts: allowedHosts(env), ...(loginToken === undefined ? {} : { loginToken }), dispatch, workspace, modelGateway, modelProxy,
    budgetConfig, lead, runtimes, pushRemotes, localCli: { enabled: localCli, ...(passEnv === undefined ? {} : { passEnv }) },
    ...(agentProxy === undefined ? {} : { agentModels: agentProxy.approvedModels }),
    ...(pushSshCommand === undefined ? {} : { pushSshCommand }),
    ...(uiDir === undefined ? {} : { uiDir }), openLogin: env.FACTORY_OPEN_LOGIN === "1", onBootstrapToken(token) {
      // The one-time sign-in token is how a fresh install signs in (unchanged behaviour); it is single use.
      if (env.FACTORY_OPEN_LOGIN !== "1") process.stdout.write(`One-time bootstrap token: ${token}\n`);
    } });
  process.stdout.write(`Factory Host listening on http://${listenHost}:${host.port}\n`);
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    void host.close().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; });
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} catch (error) {
  process.stderr.write(`${error instanceof ConfigError ? formatConfigError(error) : "Không khởi động được Factory Host. Chạy factory doctor để kiểm tra."}\n`);
  process.exitCode = 1;
}
