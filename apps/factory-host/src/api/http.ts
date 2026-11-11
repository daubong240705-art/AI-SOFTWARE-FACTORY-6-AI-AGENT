import { API_VERSION, failureResponseSchema, type ApiError } from "@factory/contracts";
import type { FastifyReply } from "fastify";

export const STATUS_BY_CODE = {
  validation: 400,
  "needs-auth": 401,
  forbidden: 403,
  "not-found": 404,
  conflict: 409,
  "resource-exhausted": 429,
  unsupported: 501,
  internal: 500,
  "outcome-unknown": 500,
  "runtime-unavailable": 503,
  "permission-configuration": 403,
} as const satisfies Record<ApiError["code"], number>;

const invalidCookieName = /[^!#$%&'*+\-.^_`|~0-9A-Za-z]/;
const invalidCookieValue = /[^\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]/;

export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  const seen = new Set<string>();
  for (const part of header?.split(";") ?? []) {
    const pair = part.replace(/^[\t ]+|[\t ]+$/g, "");
    const separator = pair.indexOf("=");
    const name = separator < 0 ? pair : pair.slice(0, separator);
    if (name.length === 0 || invalidCookieName.test(name)) continue;
    if (seen.has(name)) { cookies.delete(name); continue; }
    seen.add(name);
    if (separator < 0) continue;
    let value = pair.slice(separator + 1);
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!invalidCookieValue.test(value)) cookies.set(name, value);
  }
  return cookies;
}

export function sessionCookie(id: string, { maxAgeSec }: { maxAgeSec: number }): string {
  if (id.length === 0 || /[^A-Za-z0-9_-]/.test(id) || !Number.isSafeInteger(maxAgeSec) || maxAgeSec < 0)
    throw new Error("Invalid session cookie parameters");
  // The Host serves HTTP on loopback, so Secure would prevent the cookie being sent.
  return `factory_session=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}`;
}

export function clearSessionCookie(): string {
  return "factory_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0";
}

export function failure(
  reply: FastifyReply,
  status: number,
  code: ApiError["code"],
  message: string,
  nextAction: ApiError["nextAction"],
  newId: () => string,
  extra: Pick<ApiError, "currentRevision" | "fields"> = {},
): FastifyReply {
  const body = failureResponseSchema.parse({
    apiVersion: API_VERSION,
    ok: false,
    error: { ...extra, code, message, nextAction, correlationId: newId() },
  });
  return reply.code(status).send(body);
}
