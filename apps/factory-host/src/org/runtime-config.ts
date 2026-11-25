import type { Database } from "better-sqlite3";

export interface SeatRuntimeConfig {
  seat_id: string; revision: number; runtime: "native-opencode" | "acp";
  cli: "codex" | "claude" | null; model: string | null;
  effort: "low" | "medium" | "high" | "xhigh" | null;
  permission: "autonomous" | "workspace-write"; updated_at: string;
}
export const getSeatRuntimeConfig = (raw: Database, seatId: string): SeatRuntimeConfig | undefined =>
  raw.prepare("SELECT * FROM seat_runtime_config WHERE seat_id = ?").get(seatId) as SeatRuntimeConfig | undefined;
