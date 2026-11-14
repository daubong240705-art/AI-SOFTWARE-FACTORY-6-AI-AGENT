import { stat } from "node:fs/promises";
import { idSchema, newGameRequestSchema } from "@factory/contracts";
import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import type { ApiGuards } from "../api/server.js";
import { failure } from "../api/http.js";
import { createIdGenerator } from "../ids.js";
import { GameConflictError, type GameService } from "./create.js";
import { listGameSummaries } from "./summary.js";
import { gameReport } from "./report.js";

export function registerGameRoutes(app: FastifyInstance, guards: ApiGuards, deps: {
  raw: Database; publicUrl?: string | null; starterDir?: string; games?: GameService;
}): void {
  const newId = createIdGenerator();
  app.get("/games", { preHandler: guards.session }, async () => listGameSummaries(deps.raw, deps.publicUrl ?? null));
  app.get<{ Params: { projectId: string } }>("/projects/:projectId/game-report", { preHandler: guards.session }, async (request, reply) => {
    const id = request.params.projectId;
    if (!idSchema.safeParse(id).success || !deps.raw.prepare("SELECT 1 FROM projects WHERE id=?").get(id))
      return failure(reply, 404, "not-found", "Project not found.", "correct-input", newId);
    return gameReport(deps.raw, id);
  });
  app.post("/games", { preHandler: guards.write }, async (request, reply) => {
    let enabled = false;
    try { enabled = Boolean(deps.starterDir && (await stat(deps.starterDir)).isDirectory()); } catch { /* Optional starter unavailable. */ }
    if (!enabled || !deps.games) return failure(reply, 404, "not-found", "Route not found.", "correct-input", newId);
    const parsed = newGameRequestSchema.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, "validation", "Invalid new game request.", "correct-input", newId);
    try { return reply.send(await deps.games.create(parsed.data)); }
    catch (error) {
      if (error instanceof GameConflictError) return failure(reply, 409, "conflict", "Game already exists.", "correct-input", newId);
      console.error("New game creation failed:", error);
      return failure(reply, 500, "internal", "Could not create game.", "contact-host", newId);
    }
  });
}
