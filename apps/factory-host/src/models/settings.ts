import type { Database } from "better-sqlite3";
import { modelSettingsSetSchema } from "@factory/contracts";
import type { HandlerMap } from "../commands/pipeline.js";
import { CommandError } from "../commands/errors.js";
import type { ReasoningEffort } from "./gateway.js";

export interface ModelSettings { leadModel: string; leadEffort: ReasoningEffort; agentModels: string[]; revision: number | null; source: "database" | "environment" }
export interface ModelSettingsSeed { leadModel: string; leadEffort: ReasoningEffort; agentModels: string[] }

export function readModelSettings(raw: Database, seed: ModelSettingsSeed): ModelSettings {
  const row = raw.prepare("SELECT lead_model, lead_effort, agent_models, revision FROM model_settings WHERE id = 1").get() as
    { lead_model: string; lead_effort: ReasoningEffort; agent_models: string; revision: number } | undefined;
  if (!row) return { ...seed, agentModels: [...seed.agentModels], revision: null, source: "environment" };
  const agentModels = JSON.parse(row.agent_models) as string[];
  return { leadModel: row.lead_model, leadEffort: row.lead_effort, agentModels: [...agentModels], revision: row.revision, source: "database" };
}

export const modelsSetHandler: HandlerMap["models.set"] = ({ raw, clock }, { projectId, payload }) => {
  if (!modelSettingsSetSchema.safeParse(payload).success)
    throw new CommandError("validation", "Invalid model settings.", "correct-input");
  if (!raw.prepare("SELECT id FROM projects WHERE id = ?").get(projectId))
    throw new CommandError("not-found", "project not found", "correct-input");
  const row = raw.prepare("SELECT revision FROM model_settings WHERE id = 1").get() as { revision: number } | undefined;
  if (row && payload.expectedRevision !== row.revision)
    throw new CommandError("conflict", "model settings revision changed", "refresh", { currentRevision: row.revision });
  if (!row && payload.expectedRevision !== null)
    throw new CommandError("conflict", "model settings do not exist", "refresh");
  const revision = row ? row.revision + 1 : 1;
  raw.prepare(`INSERT INTO model_settings (id,lead_model,lead_effort,agent_models,revision,updated_at) VALUES (1,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET lead_model=excluded.lead_model,lead_effort=excluded.lead_effort,agent_models=excluded.agent_models,revision=excluded.revision,updated_at=excluded.updated_at`)
    .run(payload.leadModel, payload.leadEffort, JSON.stringify(payload.agentModels), revision, clock().toISOString());
  return { effects: [{ kind: "model-settings", id: "00000000-0000-0000-0000-000000000000", revision }] };
};
