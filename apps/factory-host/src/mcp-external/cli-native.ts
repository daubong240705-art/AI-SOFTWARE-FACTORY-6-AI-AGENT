import type { Database } from "better-sqlite3";
import type { AttemptContext } from "../dispatch/runtime.js";
import { getSeatTools } from "../instructions/snapshot.js";

export function createCliMcpResolver(raw: Database): (seatId: string) => NonNullable<AttemptContext["mcp"]> {
  return (seatId) => {
    try { return { isolated: getSeatTools(raw, { seatId }) !== null, servers: [] }; }
    catch { return { isolated: true, servers: [] }; }
  };
}
