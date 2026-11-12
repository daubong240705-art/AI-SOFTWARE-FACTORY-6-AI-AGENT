import { parseEnv, startHost } from "./host.js";
import { createChatCompletionsGateway } from "./models/index.js";
import { DEFAULT_BUDGET_CONFIG } from "./policy/index.js";
import { reasoningEffortSchema } from "@factory/contracts";
import type { LeadConfig } from "./lead/runner.js";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { isSandboxAvailable } from "./sandbox/index.js";
import { createOpenCodeRuntime } from "./runtimes/index.js";
import { validateRoots } from "./workspace/paths.js";

function budgetTokens(name: string, input: string | undefined, fallback: number): number {
  if (input === undefined) return fallback;
  if (!/^[0-9]+$/.test(input) || !Number.isSafeInteger(Number(input)) || Number(input) < 1)
    throw new Error(`${name} must be a positive safe integer`);
  return Number(input);
}

try {
  const { dispatch, workspace, agentProxy, opencode, pushRemotes, pushSshCommand, ...hostOptions } = parseEnv(process.env);
  if (opencode && !await isSandboxAvailable())
    throw new Error("FACTORY_RUNTIME=opencode requires working bubblewrap on Linux");
  if (opencode) {
    try { validateRoots(workspace); }
    catch { throw new Error("FACTORY_PROJECTS_ROOT and FACTORY_WORKTREES_ROOT must be available for FACTORY_RUNTIME=opencode"); }
    for (const [name, path] of [["FACTORY_PROJECTS_ROOT", workspace.projectsRoot], ["FACTORY_WORKTREES_ROOT", workspace.worktreesRoot]] as const) {
      try { await access(path, constants.R_OK | constants.W_OK | constants.X_OK); }
      catch { throw new Error(`${name} must be readable and writable for FACTORY_RUNTIME=opencode`); }
    }
    try { await access(`${opencode.dir}/bin/opencode`, constants.R_OK | constants.X_OK); }
    catch { throw new Error("FACTORY_OPENCODE_DIR must contain an executable bin/opencode"); }
  }
  const runtimes = opencode ? [createOpenCodeRuntime({
    roots: { ...workspace, stateDir: hostOptions.stateDir }, opencodeDir: opencode.dir,
  })] : [];
  const lead: Partial<LeadConfig> = {};
  if (process.env.FACTORY_LEAD_MODEL !== undefined) {
    if (!process.env.FACTORY_LEAD_MODEL.trim()) throw new Error("FACTORY_LEAD_MODEL must be a non-empty string");
    lead.model = process.env.FACTORY_LEAD_MODEL;
  }
  if (process.env.FACTORY_LEAD_MAX_OUTPUT_TOKENS !== undefined) {
    const value = process.env.FACTORY_LEAD_MAX_OUTPUT_TOKENS;
    if (!/^[0-9]+$/.test(value) || Number(value) < 256 || Number(value) > 131072)
      throw new Error("FACTORY_LEAD_MAX_OUTPUT_TOKENS must be an integer from 256 to 131072");
    lead.maxOutputTokens = Number(value);
  }
  if (process.env.FACTORY_LEAD_EFFORT !== undefined) {
    const parsed = reasoningEffortSchema.safeParse(process.env.FACTORY_LEAD_EFFORT);
    if (!parsed.success) throw new Error("FACTORY_LEAD_EFFORT must be one of low, medium, high, xhigh");
    lead.effort = parsed.data;
  }
  const budgetConfig = { ...DEFAULT_BUDGET_CONFIG,
    defaultTaskTokens: budgetTokens("FACTORY_BUDGET_TASK_TOKENS", process.env.FACTORY_BUDGET_TASK_TOKENS, DEFAULT_BUDGET_CONFIG.defaultTaskTokens),
    defaultDayTokens: budgetTokens("FACTORY_BUDGET_DAY_TOKENS", process.env.FACTORY_BUDGET_DAY_TOKENS, DEFAULT_BUDGET_CONFIG.defaultDayTokens),
  };
  const apiKey = process.env.NINE_ROUTER_API_KEY;
  const modelGateway = apiKey === undefined ? null : createChatCompletionsGateway({
    baseUrl: process.env.FACTORY_GATEWAY_URL ?? "https://ai.lazy.local/v1", apiKey,
  });
  const modelProxy = apiKey && process.env.FACTORY_GATEWAY_URL && agentProxy ? {
    // Includes the optional FACTORY_PROXY_SOCKET selected by parseEnv.
    ...agentProxy, upstream: { apiKey, baseUrl: process.env.FACTORY_GATEWAY_URL },
  } : null;
  let uiDir = process.env.FACTORY_UI_DIR;
  if (uiDir === undefined) {
    const defaultUiDir = fileURLToPath(new URL("../../factory-ui/dist/", import.meta.url));
    try { if ((await stat(defaultUiDir)).isDirectory()) uiDir = defaultUiDir; } catch { /* UI build is optional. */ }
  }
  const host = await startHost({ ...hostOptions, dispatch, workspace, modelGateway, modelProxy, budgetConfig, lead, runtimes, pushRemotes,
    ...(agentProxy === undefined ? {} : { agentModels: agentProxy.approvedModels }),
    ...(pushSshCommand === undefined ? {} : { pushSshCommand }),
    ...(uiDir === undefined ? {} : { uiDir }), onBootstrapToken(token) {
    process.stdout.write(`One-time bootstrap token: ${token}\n`);
  } });
  process.stdout.write(`Factory Host listening on http://127.0.0.1:${host.port}\n`);
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    void host.close().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; });
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Host startup failed"}\n`);
  process.exitCode = 1;
}
