import { stat } from "node:fs/promises";
import { newGameRequestSchema } from "@factory/contracts";
import type { FastifyInstance } from "fastify";
import type { ApiGuards } from "../api/server.js";
import { failure } from "../api/http.js";
import { createIdGenerator } from "../ids.js";
import { GameConflictError, type GameService } from "./create.js";

export function registerGameRoutes(app: FastifyInstance, guards: ApiGuards, deps: {
  starterDir?: string; games?: GameService;
}): void {
  const newId = createIdGenerator();
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
