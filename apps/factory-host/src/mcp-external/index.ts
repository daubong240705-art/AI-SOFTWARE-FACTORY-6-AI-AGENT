import type { TokenGrant } from "../proxy/tokens.js";
import type { ToolResult } from "../mcp/tools.js";
import type { ExternalDefinition, ExternalStatus } from "./client.js";

export interface ExternalTools {
  definitionsFor(grant: TokenGrant): Promise<ExternalDefinition[]>;
  call(grant: TokenGrant, name: string, args: unknown): Promise<ToolResult>;
  status(): ExternalStatus[];
  close(): void;
}
