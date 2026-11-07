import { parseEnv, startHost } from "./host.js";
import { createChatCompletionsGateway } from "./models/index.js";
import { DEFAULT_BUDGET_CONFIG } from "./policy/index.js";
import { reasoningEffortSchema } from "@factory/contracts";
import type { LeadConfig } from "./lead/runner.js";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

function budgetTokens(name: string, input: string | undefined, fallback: number): number {
  if (input === undefined) return fallback;
  if (!/^[0-9]+$/.test(input) || !Number.isSafeInteger(Number(input)) || Number(input) < 1)
    throw new Error(`${name} must be a positive safe integer`);
  return Number(input);
}

try {
  const { dispatch, ...hostOptions } = parseEnv(process.env);
  const lead: Partial<LeadConfig> = {};
  if (process.env.FACTORY_LEAD_MODEL !== undefined) {
    if (!process.env.FACTORY_LEAD_MODEL.trim()) throw new Error("FACTORY_LEAD_MODEL must be a non-empty string");
    lead.model = process.env.FACTORY_LEAD_MODEL;
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
  let uiDir = process.env.FACTORY_UI_DIR;
  if (uiDir === undefined) {
    const defaultUiDir = fileURLToPath(new URL("../../factory-ui/dist/", import.meta.url));
    try { if ((await stat(defaultUiDir)).isDirectory()) uiDir = defaultUiDir; } catch { /* UI build is optional. */ }
  }
  const host = await startHost({ ...hostOptions, dispatch, modelGateway, budgetConfig, lead,
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
