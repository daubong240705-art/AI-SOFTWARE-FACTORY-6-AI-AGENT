import { createHash, randomBytes } from "node:crypto";
import { systemClock, type Clock } from "../ids.js";

export interface Session {
  readonly id: string;
  readonly csrfToken: string;
  /** Unix milliseconds from the injected Clock. */
  readonly createdAt: number;
  readonly lastSeenAt: number;
}

export interface SessionStore {
  create(): Session;
  get(id: string): Session | null;
  destroy(id: string): void;
  size(): number;
}

export interface SessionOptions {
  clock?: Clock;
  newToken?: () => string;
  idleMs?: number;
  absoluteMs?: number;
  maxSessions?: number;
}

export function createSessionStore({
  clock = systemClock,
  newToken = () => randomBytes(32).toString("base64url"),
  idleMs = 12 * 60 * 60 * 1000,
  absoluteMs = 7 * 24 * 60 * 60 * 1000,
  maxSessions = 20,
}: SessionOptions = {}): SessionStore {
  if (![idleMs, absoluteMs, maxSessions].every((value) => Number.isSafeInteger(value) && value > 0))
    throw new Error("Session limits must be positive integers");
  // M1 is single user: sessions live only in memory and disappear on Host restart.
  const sessions = new Map<string, Session>();
  const key = (id: string): string => createHash("sha256").update(id).digest("hex");
  const expired = (session: Session, now: number): boolean =>
    now - session.lastSeenAt >= idleMs || now - session.createdAt >= absoluteMs;
  const prune = (now: number): void => {
    for (const [digest, session] of sessions) if (expired(session, now)) sessions.delete(digest);
  };

  return {
    create() {
      const now = clock().getTime();
      const session: Session = { id: newToken(), csrfToken: newToken(), createdAt: now, lastSeenAt: now };
      const digest = key(session.id);
      prune(now);
      if (sessions.has(digest)) throw new Error("Session token generation failed");
      sessions.set(digest, session);
      if (sessions.size > maxSessions) {
        const oldest = sessions.keys().next().value;
        if (oldest !== undefined) sessions.delete(oldest);
      }
      return { ...session };
    },
    get(id) {
      const digest = key(id);
      const session = sessions.get(digest);
      if (!session) return null;
      const now = clock().getTime();
      if (expired(session, now)) { sessions.delete(digest); return null; }
      const refreshed = { ...session, lastSeenAt: now };
      sessions.set(digest, refreshed);
      return { ...refreshed };
    },
    destroy(id) { sessions.delete(key(id)); },
    size() { prune(clock().getTime()); return sessions.size; },
  };
}
