import { integrationSpecSchema, sensitiveIntegrationName, type IntegrationSpec } from "@factory/contracts";
import type { Database } from "better-sqlite3";
import { isCliServer, type McpServersConfig } from "../mcp-external/config.js";
import type { IntegrationStore } from "./store.js";

export function importLegacy(raw: Database, store: IntegrationStore, legacy: McpServersConfig, newId: () => string,
  env: Readonly<Record<string, string | undefined>> = process.env) {
  return raw.transaction(() => {
    const imported: string[] = [];
    const readEnv = (name: string) => {
      if (/^(FACTORY_(?:SECRET_KEY|MODEL_API_KEY|MCP_TOKEN|LOGIN_TOKEN)|NINE_ROUTER_API_KEY)$/i.test(name))
        throw new Error("Legacy integration cannot import a Host-only credential");
      return env[name];
    };
    for (const server of legacy.servers) {
      if (raw.prepare("SELECT 1 FROM integrations WHERE scope_group_id IS NULL AND name=?").get(server.name)) continue;
      const id = newId();
      const base = { name: server.name, scopeGroupId: null };
      const credential = (name: string, value: string) => {
        const credentialId = newId();
        store.createCredential(credentialId, `${server.name}: ${name}`.slice(0, 160), null, value);
        return { credential: credentialId };
      };
      const convert = (name: string, input: string, force = false) => sensitiveIntegrationName(name) || force
        || /^(?:Bearer\s|Basic\s|sk-|gh[pousr]_|github_pat_|xox[baprs]-|eyJ)/i.test(input) || /^[a-z\d_+\/=.-]{32,}$/i.test(input)
        ? credential(name, input) : { value: input };
      let spec: IntegrationSpec;
      if (isCliServer(server)) {
        const entries = Object.entries(server.env ?? {}).map(([name, value]) => [name, convert(name, value)]);
        for (const name of server.envNames) {
          const value = readEnv(name);
          if (value !== undefined && !Object.hasOwn(server.env ?? {}, name)) entries.push([name, convert(name, value, true)]);
        }
        spec = { ...base, kind: "mcp-stdio", config: { command: server.command, args: server.args, env: Object.fromEntries(entries) } };
      } else {
        const headers = Object.entries(server.headers ?? {}).flatMap(([name, input]) => {
          const reference = input.startsWith("env:");
          const value = reference ? readEnv(input.slice(4)) : input;
          return value === undefined ? [] : [[name, convert(name, value, reference)]];
        });
        spec = { ...base, kind: "mcp-http", config: { url: server.url, headers: Object.fromEntries(headers) } };
      }
      const parsed = integrationSpecSchema.safeParse(spec);
      if (!parsed.success) throw new Error("Invalid legacy integration configuration");
      store.save(id, parsed.data);
      imported.push(id);
    }
    return imported;
  })();
}
