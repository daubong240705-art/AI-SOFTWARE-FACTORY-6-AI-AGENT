import type { Database } from "better-sqlite3";
import { workflowDefinitionSchema, type WorkflowDefinition } from "@factory/contracts";
import { registryPack, type RegistryPack } from "../org/registry.js";
import { workflowGraph } from "./graph.js";
import { validateWorkflowDefinition } from "./validate.js";

function parameterViews(parameters: WorkflowDefinition["parameters"]) {
  return parameters.map((parameter) => ({ name: parameter.name, type: parameter.type, default: parameter.default,
    options: parameter.type === "enum" ? parameter.values : null, min: null, max: null, label: null }));
}

export function matchWorkflowDefinitions(packs: readonly RegistryPack[], filter: { packKey?: string; definitionKey?: string }) {
  return packs.filter((entry) => filter.packKey === undefined || entry.key === filter.packKey)
    .flatMap((entry) => registryPack(entry).files.workflows
      .filter((file) => filter.definitionKey === undefined || file.definition.key === filter.definitionKey)
      .map((file) => ({ entry, definition: file.definition })));
}

export function listWorkflowDefinitions(raw: Database, projectId: string, packs: readonly RegistryPack[]) {
  const teamPacks = raw.prepare(`SELECT DISTINCT t.pack_key AS key, t.pack_version AS version
    FROM engagements e JOIN teams t ON t.id = e.team_id WHERE e.project_id = ? AND e.state = 'active'`)
    .all(projectId) as { key: string | null; version: string | null }[];
  const available = packs.filter((entry) => teamPacks.some((pack) => pack.key === entry.key && pack.version === entry.version));
  return matchWorkflowDefinitions(available, {}).flatMap(({ entry, definition: input }) => {
    const parsed = workflowDefinitionSchema.safeParse(input);
    if (!parsed.success || !validateWorkflowDefinition(parsed.data).ok) return [];
    const definition = parsed.data;
    return [{ key: definition.key, packKey: entry.key, packVersion: entry.version,
      revision: definition.revision, title: definition.title, domain: definition.domain ?? null,
      parameters: parameterViews(definition.parameters), phases: definition.phases, graph: workflowGraph(definition) }];
  }).sort((a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key)).slice(0, 50);
}
