import { API_VERSION } from "@factory/contracts";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, type preHandlerAsyncHookHandler } from "fastify";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createIdGenerator, systemClock, type Clock } from "../ids.js";
import type { BootstrapGate, Session, SessionStore } from "../identity/index.js";
import { clearSessionCookie, failure, parseCookies, sessionCookie } from "./http.js";

declare module "fastify" {
  interface FastifyRequest {
    session: Session | null;
  }
}

export interface ApiGuards {
  session: preHandlerAsyncHookHandler;
  write: preHandlerAsyncHookHandler;
}

export interface ApiServerOptions {
  origins: string[];
  gate: BootstrapGate;
  sessions: SessionStore;
  clock?: Clock;
  newId?: () => string;
  bodyLimit?: number;
  /** Single-user loopback mode: a request without a valid session gets one automatically (no sign-in token).
   * The Host allow-list, exact Origin and per-session CSRF token still apply to every write. */
  openLogin?: boolean;
  register?: (app: FastifyInstance, guards: ApiGuards) => void;
}

const bootstrapBody = z.strictObject({ token: z.string() });
const jsonContentType = /^application\/json(?:\s*;\s*charset\s*=\s*(?:[A-Za-z0-9._-]+|"[A-Za-z0-9._-]+"))?$/i;
const authenticationMessage = "Authentication required.";
const forbiddenMessage = "Request forbidden.";
const hash = (value: string): Buffer => createHash("sha256").update(value).digest();

function securityHeaders(reply: FastifyReply): void {
  reply.header("Cache-Control", reply.getHeader("Cache-Control") === "private, no-store" ? "private, no-store" : "no-store");
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Referrer-Policy", "no-referrer");
  reply.header("Cross-Origin-Resource-Policy", "same-origin");
  for (const name of Object.keys(reply.getHeaders())) {
    if (name.startsWith("access-control-")) reply.removeHeader(name);
  }
}

export function createApiServer(options: ApiServerOptions): FastifyInstance {
  const origins = new Set(options.origins);
  const hosts = new Set(options.origins.map((origin) => new URL(origin).host));
  const newId = options.newId ?? createIdGenerator(options.clock ?? systemClock);
  const checkRequest = (request: FastifyRequest, reply: FastifyReply): FastifyReply | undefined => {
    const host = request.headers.host;
    if (typeof host !== "string" || !hosts.has(host))
      return failure(reply, 403, "forbidden", forbiddenMessage, "correct-input", newId);
    if (request.method === "OPTIONS")
      return failure(reply, 405, "unsupported", "Method not allowed.", "correct-input", newId);
    if (request.method === "POST") {
      const contentType = request.headers["content-type"];
      const documentUpload = request.routeOptions.url === "/projects/:projectId/documents";
      if (documentUpload && (typeof contentType !== "string" || !/^application\/octet-stream(?:\s*;.*)?$/i.test(contentType.trim())))
        return failure(reply, 415, "validation", "Content-Type must be application/octet-stream.", "correct-input", newId);
      if (!documentUpload && (typeof contentType !== "string" || !jsonContentType.test(contentType.trim())))
        return failure(reply, 415, "validation", "Content-Type must be application/json.", "correct-input", newId);
    }
    return undefined;
  };
  const app = Fastify({
    logger: false, trustProxy: false, bodyLimit: options.bodyLimit ?? 262_144,
    frameworkErrors(error, request, reply) {
      // Router failures precede hooks; apply the same Host check and never echo the URL.
      securityHeaders(reply);
      const rejected = checkRequest(request, reply);
      if (rejected) return;
      if (error.code === "FST_ERR_BAD_URL" || error.code === "FST_ERR_MAX_PARAM_LENGTH") {
        failure(reply, error.code === "FST_ERR_MAX_PARAM_LENGTH" ? 414 : 400,
          "validation", "Invalid request.", "correct-input", newId);
      } else failure(reply, 500, "internal", "Internal server error.", "contact-host", newId);
    },
  });
  app.decorateRequest("session", null);

  // This is the first request hook, including for unknown routes and preflight requests.
  app.addHook("onRequest", async (request, reply) => checkRequest(request, reply));

  app.addHook("onSend", async (_request, reply, payload) => {
    securityHeaders(reply);
    return payload;
  });

  const authenticate = (request: FastifyRequest, reply: FastifyReply): Session | null => {
    const header = request.headers.cookie;
    const id = parseCookies(header).get("factory_session");
    let current = id === undefined ? null : options.sessions.get(id);
    if (!current && options.openLogin) {
      current = options.sessions.create();
      reply.header("Set-Cookie", sessionCookie(current.id, { maxAgeSec: 7 * 24 * 60 * 60 }));
    }
    if (!current) {
      const present = header?.split(";").some((part) => part.trim().split("=")[0]?.trim() === "factory_session");
      if (present) reply.header("Set-Cookie", clearSessionCookie());
      failure(reply, 401, "needs-auth", authenticationMessage, "authenticate", newId);
      return null;
    }
    request.session = current;
    return current;
  };
  const guards: ApiGuards = {
    session: async (request, reply) => {
      if (!authenticate(request, reply)) return reply;
    },
    write: async (request, reply) => {
      const current = authenticate(request, reply);
      if (!current) return reply;
      const origin = request.headers.origin;
      if (typeof origin !== "string" || !origins.has(origin))
        return failure(reply, 403, "forbidden", forbiddenMessage, "correct-input", newId);
      const csrfToken = request.headers["x-csrf-token"];
      const matches = timingSafeEqual(hash(typeof csrfToken === "string" ? csrfToken : ""), hash(current.csrfToken));
      if (!matches || typeof csrfToken !== "string")
        return failure(reply, 403, "forbidden", forbiddenMessage, "correct-input", newId);
    },
  };

  app.setErrorHandler((error, _request, reply) => {
    const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "";
    const validation = typeof error === "object" && error !== null && "validation" in error && Boolean(error.validation);
    if (code === "FST_ERR_CTP_BODY_TOO_LARGE")
      return failure(reply, 413, "validation", "Request body too large.", "correct-input", newId);
    if (code === "FST_ERR_CTP_INVALID_MEDIA_TYPE")
      return failure(reply, 415, "validation", "Content-Type must be application/json.", "correct-input", newId);
    if (validation || code === "FST_ERR_VALIDATION" || code.startsWith("FST_ERR_CTP_"))
      return failure(reply, 400, "validation", "Invalid request.", "correct-input", newId);
    return failure(reply, 500, "internal", "Internal server error.", "contact-host", newId);
  });
  app.setNotFoundHandler((_request, reply) =>
    failure(reply, 404, "not-found", "Route not found.", "correct-input", newId));

  app.get("/health", async () => ({ ok: true, apiVersion: API_VERSION }));
  app.post("/auth/bootstrap", {
    onRequest: async (request, reply) => {
      const origin = request.headers.origin;
      if (typeof origin !== "string" || !origins.has(origin))
        return failure(reply, 403, "forbidden", forbiddenMessage, "correct-input", newId);
    },
  }, async (request, reply) => {
    const body = bootstrapBody.safeParse(request.body);
    if (!body.success)
      return failure(reply, 400, "validation", "Invalid request.", "correct-input", newId);
    const result = options.gate.consume(body.data.token);
    if (result === "locked")
      return failure(reply, 429, "resource-exhausted", "Authentication temporarily unavailable.", "wait", newId);
    if (result !== "ok")
      return failure(reply, 401, "needs-auth", authenticationMessage, "authenticate", newId);
    const current = options.sessions.create();
    reply.header("Set-Cookie", sessionCookie(current.id, { maxAgeSec: 7 * 24 * 60 * 60 }));
    return { ok: true, apiVersion: API_VERSION, csrfToken: current.csrfToken };
  });
  // Lets the UI recover its CSRF token after a page reload (the cookie is HttpOnly). Another site cannot
  // read this response: the Host sends no CORS headers and the cookie is SameSite=Strict.
  app.get("/auth/session", { preHandler: guards.session }, async (request) => ({
    ok: true, apiVersion: API_VERSION, csrfToken: request.session?.csrfToken,
  }));
  app.post("/auth/logout", { preHandler: guards.write }, async (request, reply) => {
    if (request.session) options.sessions.destroy(request.session.id);
    reply.header("Set-Cookie", clearSessionCookie());
    return { ok: true, apiVersion: API_VERSION };
  });

  options.register?.(app, guards);
  return app;
}
