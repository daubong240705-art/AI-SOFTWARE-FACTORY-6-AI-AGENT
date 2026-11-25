import { SYSTEM_SCOPE_ID, type AgentConfig, type Integration } from "@factory/contracts";
import type { HandlerContext, HandlerMap, HandlerResult } from "../commands/pipeline.js";
import { CommandError } from "../commands/errors.js";
import { currentAgentConfig } from "../org/agents.js";
import { integrationToolPattern, type IntegrationStore } from "./store.js";

export const INTEGRATION_CONFIG_COMMANDS = ["integrations.create", "integrations.update", "integrations.delete", "integrations.test",
  "credentials.create", "credentials.replace", "credentials.delete"] as const;
type CommandName = typeof INTEGRATION_CONFIG_COMMANDS[number];
export function createIntegrationCommands(store: IntegrationStore, check: (integration: Integration) => Promise<void>): Pick<HandlerMap, CommandName> {
  const scope = (id: string) => {
    if (id !== SYSTEM_SCOPE_ID) throw new CommandError("validation", "Integration commands require system scope", "correct-input");
  };
  const done = () => ({ effects: [] });
  return {
    "integrations.create": (_, { projectId, payload }) => { scope(projectId); store.save(payload.id, payload); return done(); },
    "integrations.update": (_, { projectId, payload }) => { scope(projectId); store.save(payload.id, payload, payload.expectedRevision); return done(); },
    "integrations.delete": (_, { projectId, payload }) => { scope(projectId); store.remove(payload.id, payload.expectedRevision); return done(); },
    "integrations.test": (_, { projectId, payload }) => {
      scope(projectId);
      const integration = store.startCheck(payload.id, payload.expectedRevision);
      queueMicrotask(() => { if (store.get(integration.id)?.revision === integration.revision) void check(integration).catch(() => {}); });
      return done();
    },
    "credentials.create": (_, { projectId, payload }) => {
      scope(projectId); store.createCredential(payload.id, payload.name, payload.scopeGroupId, payload.value); return done();
    },
    "credentials.replace": (_, { projectId, payload }) => {
      scope(projectId); store.replaceCredential(payload.id, payload.expectedRevision, payload.value); return done();
    },
    "credentials.delete": (_, { projectId, payload }) => { scope(projectId); store.deleteCredential(payload.id, payload.expectedRevision); return done(); },
  };
}

export function validateIntegrationGrants(store: IntegrationStore, projectId: string, tools: AgentConfig["tools"]) {
  const visible = store.forProject(projectId);
  for (const grant of tools ?? []) {
    if (!/^(ext|http)\./.test(grant.tool)) continue;
    const match = integrationToolPattern.exec(grant.tool);
    const integration = visible.find((entry) => entry.name === match?.[2] && (entry.kind === "http-api") === (match?.[1] === "http"));
    if (!integration || (match?.[3] !== "*" && !integration.tools.some((tool) => tool.name === match?.[3])))
      throw new CommandError("validation", "Granted integration tool is not available in this project scope", "correct-input");
  }
}

export function withIntegrationGrants<Command extends { projectId: string; payload: { agentId: string } }>(store: IntegrationStore,
  handler: (ctx: HandlerContext, command: Command) => HandlerResult) {
  return (ctx: HandlerContext, command: Command): HandlerResult => {
    const result = handler(ctx, command);
    validateIntegrationGrants(store, command.projectId, currentAgentConfig(ctx.raw, command.payload.agentId)?.config.tools ?? null);
    return result;
  };
}
