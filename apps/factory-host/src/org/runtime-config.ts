import type { Database } from "better-sqlite3";
import type { HandlerMap } from "../commands/pipeline.js";
import { CommandError } from "../commands/errors.js";

export interface SeatRuntimeConfig {
  seat_id: string; revision: number; runtime: "native-opencode" | "acp";
  cli: "codex" | "claude" | null; model: string | null;
  effort: "low" | "medium" | "high" | "xhigh" | null;
  permission: "autonomous" | "workspace-write"; updated_at: string;
}
export const getSeatRuntimeConfig = (raw: Database, seatId: string): SeatRuntimeConfig | undefined =>
  raw.prepare("SELECT * FROM seat_runtime_config WHERE seat_id = ?").get(seatId) as SeatRuntimeConfig | undefined;

export const seatsSetRuntimeHandler: HandlerMap["seats.set-runtime"] = ({ raw, clock }, { projectId, payload }) => {
  if (!raw.prepare("SELECT id FROM projects WHERE id = ?").get(projectId))
    throw new CommandError("not-found", "project not found", "correct-input");
  const seat = raw.prepare("SELECT revision FROM seats WHERE id = ?").get(payload.seatId) as { revision: number } | undefined;
  if (!seat) throw new CommandError("not-found", "seat not found", "correct-input");
  const previous = getSeatRuntimeConfig(raw, payload.seatId);
  if ((previous?.revision ?? null) !== payload.expectedRevision)
    throw new CommandError("conflict", "runtime configuration revision changed", "refresh",
      { currentRevision: previous?.revision ?? 0 });
  // Lead seats can use this configuration for attempts. Lead chat still uses the gateway.
  if (payload.runtime === "inherit") raw.prepare("DELETE FROM seat_runtime_config WHERE seat_id = ?").run(payload.seatId);
  else raw.prepare(`INSERT INTO seat_runtime_config (seat_id,revision,runtime,cli,model,effort,permission,updated_at)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(seat_id) DO UPDATE SET revision=excluded.revision,
    runtime=excluded.runtime,cli=excluded.cli,model=excluded.model,effort=excluded.effort,
    permission=excluded.permission,updated_at=excluded.updated_at`).run(payload.seatId, (previous?.revision ?? 0) + 1,
      payload.runtime, payload.cli ?? null, payload.model ?? null, payload.effort ?? null,
      payload.permission ?? "autonomous", clock().toISOString());
  raw.prepare("UPDATE seats SET revision = revision + 1 WHERE id = ?").run(payload.seatId);
  return { effects: [{ kind: "seat", id: payload.seatId, revision: seat.revision + 1 }] };
};
