import { createHash } from "node:crypto";
import type { Database } from "better-sqlite3";
import type { z } from "zod";
import {
  API_VERSION, commandSchema, commandResponseSchema, failureResponseSchema, idSchema,
  receiptSchema, successResponseSchema, type ApiError, type Command, type CommandReceipt, type EntityRef, type FactoryEvent,
} from "@factory/contracts";
import { STATUS_BY_CODE } from "../api/http.js";
import type { EventHub } from "../events/hub.js";
import { createIdGenerator, systemClock, type Clock } from "../ids.js";
import { projectsCreateHandler } from "../projects/service.js";
import type { Storage } from "../storage/database.js";
import { CommandError } from "./errors.js";

export interface HandlerContext { raw: Database; hub: EventHub; clock: Clock; newId: () => string; actorId: string }
export type HandlerResult = { effects: EntityRef[]; events?: FactoryEvent["payload"][] };
export type HandlerMap = {
  [T in Command["type"]]: (ctx: HandlerContext, command: Extract<Command, { type: T }>) => HandlerResult;
};
export type PipelineResult = { status: number; body: z.infer<typeof commandResponseSchema>; replayed: boolean };

// Build JSON directly so even integer-like keys follow lexical order.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) as string;
}

interface ReceiptRow { fingerprint: string; state: CommandReceipt["state"]; response_json: string }

export function createCommandPipeline(options: {
  storage: Storage; hub: EventHub; clock?: Clock; newId?: () => string; handlers?: Partial<HandlerMap>;
}): { execute(rawBody: unknown, actorId?: string): PipelineResult } {
  const { storage, hub } = options;
  const raw = storage.raw;
  const clock = options.clock ?? systemClock;
  const newId = options.newId ?? createIdGenerator(clock);
  const handlers: Partial<HandlerMap> = { "projects.create": projectsCreateHandler, ...options.handlers };
  const result = (status: number, body: unknown, replayed = false): PipelineResult => ({
    status, body: commandResponseSchema.parse(body), replayed,
  });
  const failure = (error: ApiError, commandId?: string) => failureResponseSchema.parse({
    apiVersion: API_VERSION, ok: false, ...(commandId === undefined ? {} : { commandId }), error,
  });

  return {
    execute(rawBody, actorId = "operator") {
      const context: HandlerContext = { raw, hub, clock, newId, actorId };
      return hub.transaction(() => {
        const parsed = commandSchema.safeParse(rawBody);
        if (!parsed.success) {
          const candidate = typeof rawBody === "object" && rawBody !== null && "commandId" in rawBody
            ? idSchema.safeParse(rawBody.commandId) : null;
          return result(400, failure({
            code: "validation", message: "Invalid command.", nextAction: "correct-input", correlationId: newId(),
            fields: parsed.error.issues.slice(0, 50).map((issue) => ({
              path: issue.path.map(String).join(".").slice(0, 256),
              // Zod's unknown-key message includes attacker-controlled key names.
              message: (issue.code === "unrecognized_keys" ? "Unrecognized fields." : issue.message).slice(0, 500),
            })),
          }, candidate?.success ? candidate.data : undefined));
        }
        const command = parsed.data;
        const fingerprint = createHash("sha256").update(canonicalJson({
          type: command.type, projectId: command.projectId, payload: command.payload,
        })).digest("hex");
        const stored = raw.prepare("SELECT fingerprint, state, response_json FROM command_receipts WHERE command_id = ?")
          .get(command.commandId) as ReceiptRow | undefined;
        if (stored) {
          if (stored.fingerprint !== fingerprint) return result(409, failure({
            code: "conflict", message: "commandId was already used for a different command",
            nextAction: "correct-input", correlationId: newId(),
          }, command.commandId));
          const body = commandResponseSchema.parse(JSON.parse(stored.response_json));
          if (stored.state === "completed") return result(200, body, true);
          const error = body.ok ? body.receipt.error : body.error;
          if (!error) throw new Error("Stored rejected receipt has no error");
          return result(STATUS_BY_CODE[error.code], body, true);
        }

        let effects: EntityRef[] = [];
        let events: FactoryEvent["payload"][] = [];
        let error: ApiError | undefined;
        // The indexed handler and command share the same discriminant.
        const handler = handlers[command.type] as ((ctx: HandlerContext, command: Command) => HandlerResult) | undefined;
        if (!handler) {
          error = { code: "unsupported", message: "Command is not supported.", nextAction: "contact-host", correlationId: newId() };
        } else {
          try {
            const handled = raw.transaction(() => handler(context, command))();
            effects = handled.effects;
            events = handled.events ?? [];
          } catch (caught) {
            if (!(caught instanceof CommandError)) throw caught;
            error = { ...caught.extra, code: caught.code, message: caught.message,
              nextAction: caught.nextAction, correlationId: newId() };
          }
        }
        const receipt = receiptSchema.parse({
          commandId: command.commandId, projectId: command.projectId,
          state: error ? "rejected" : "completed", effects, ...(error ? { error } : {}),
        });
        const body = error ? failure(error, command.commandId)
          : successResponseSchema.parse({ apiVersion: API_VERSION, ok: true, receipt });
        raw.prepare(`INSERT INTO command_receipts
          (command_id, project_id, actor_id, fingerprint, state, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(command.commandId, command.projectId, actorId, fingerprint, receipt.state, JSON.stringify(body), clock().toISOString());
        if (hub.currentCursor(command.projectId) !== null) {
          const causation = { projectId: command.projectId, causationId: command.commandId, rootCausationId: command.commandId };
          for (const entity of receipt.effects) hub.append({ ...causation, payload: { type: "entity.changed", entity } });
          if (!error) for (const payload of events) hub.append({ ...causation, payload });
          hub.append({ ...causation, payload: { type: "command.receipted", receipt } });
        }
        return result(error ? STATUS_BY_CODE[error.code] : 200, body);
      });
    },
  };
}
