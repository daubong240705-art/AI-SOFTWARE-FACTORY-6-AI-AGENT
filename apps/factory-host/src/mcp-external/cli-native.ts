import type { Database } from "better-sqlite3";
import { getSeatTools } from "../instructions/snapshot.js";
import { cliServers, type CliServerConfig, type McpServersConfig } from "./config.js";

/**
 * MCP servers a seat's local CLI launches itself (stdio), plus whether the CLI must ignore the operator's own
 * MCP configuration. Seats opt in exactly as for Host-proxied servers: through their pinned `tools` list
 * (`ext.<server>.*` or `ext.<server>.<tool>`). A seat with a pinned list is isolated: its CLI sees the Factory
 * server and its assigned servers only. Seats without a list keep the CLI's own configuration, as before.
 */
export interface CliMcpAssignment { isolated: boolean; servers: CliServerConfig[] }

export function createCliMcpResolver(raw: Database, config: McpServersConfig | undefined): (seatId: string) => CliMcpAssignment {
  const servers = config === undefined ? [] : cliServers(config);
  return (seatId) => {
    let tools: string[] | null;
    try { tools = getSeatTools(raw, { seatId }); } catch { tools = null; }
    if (tools === null) return { isolated: false, servers: [] };
    const pinned = tools;
    return { isolated: true, servers: servers.filter((server) => pinned.some((tool) => tool.startsWith(`ext.${server.name}.`))) };
  };
}

/** Every environment variable a CLI-native server needs must already be passed to the CLIs (FACTORY_CLI_PASS_ENV). */
export function assertCliServerEnvironment(config: McpServersConfig | undefined, passEnv: readonly string[] | undefined): void {
  const allowed = new Set(passEnv ?? []);
  for (const server of config === undefined ? [] : cliServers(config))
    for (const name of server.envNames)
      if (!allowed.has(name)) throw new Error(`MCP server ${server.name} needs ${name} in FACTORY_CLI_PASS_ENV`);
}
