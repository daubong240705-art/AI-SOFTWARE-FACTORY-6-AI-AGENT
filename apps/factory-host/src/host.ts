import type { FastifyInstance } from "fastify";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { isAbsolute, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiServer, createRoutes, listenLoopback, originsFor } from "./api/index.js";
import { createCommandPipeline } from "./commands/pipeline.js";
import { EventHub } from "./events/hub.js";
import { createBootstrapGate, createSessionStore } from "./identity/index.js";
import { systemClock, type Clock } from "./ids.js";
import { openStorage, type Storage } from "./storage/database.js";

export function parseEnv(env: Readonly<Record<string, string | undefined>>): {
  stateDir: string; port: number; backupDir?: string;
} {
  const input = env.FACTORY_PORT ?? "8787";
  if (!/^[0-9]+$/.test(input) || !Number.isSafeInteger(Number(input)) || Number(input) < 1 || Number(input) > 65_535)
    throw new Error("FACTORY_PORT must be an integer from 1 to 65535");
  return {
    stateDir: env.FACTORY_STATE_DIR ?? join(homedir(), "factory-v2", "state"), port: Number(input),
    ...(env.FACTORY_BACKUP_DIR === undefined ? {} : { backupDir: env.FACTORY_BACKUP_DIR }),
  };
}

async function freeLoopbackPort(): Promise<number> {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Loopback listener has no TCP address");
    return address.port;
  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

export async function startHost(options: {
  stateDir: string; port: number; backupDir?: string; migrationsDir?: string; clock?: Clock;
  onBootstrapToken: (token: string) => void; keepAliveMs?: number;
}): Promise<{
  app: FastifyInstance; port: number; origins: string[]; storage: Storage; hub: EventHub; close(): Promise<void>;
}> {
  // Check POSIX spelling too, including when validating a WSL path on Windows.
  const normalized = posix.normalize(options.stateDir.replaceAll("\\", "/"));
  if (normalized === "/mnt" || normalized.startsWith("/mnt/"))
    throw new Error("State directory must not be on a /mnt/ Windows-drive mount; SQLite WAL requires a local filesystem");
  if (!isAbsolute(options.stateDir)) throw new Error("State directory must be an absolute path");
  const stateDir = resolve(options.stateDir);
  if (!Number.isSafeInteger(options.port) || options.port < 0 || options.port > 65_535)
    throw new Error("Host port must be an integer from 0 to 65535");
  const clock = options.clock ?? systemClock;
  let storage: Storage | undefined;
  let app: FastifyInstance | undefined;
  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      try { await app?.close(); } finally { storage?.close(); }
    })();
    return closePromise;
  };
  try {
    storage = openStorage(join(stateDir, "host.db"));
    storage.migrate({
      migrationsDir: options.migrationsDir ?? fileURLToPath(new URL("../migrations/", import.meta.url)),
      backupDir: options.backupDir ?? join(stateDir, "backups"), now: clock,
    });
    const hub = new EventHub(storage.raw, { clock });
    const pipeline = createCommandPipeline({ storage, hub, clock });
    const gate = createBootstrapGate({ clock });
    const sessions = createSessionStore({ clock });
    const port = options.port === 0 ? await freeLoopbackPort() : options.port;
    const origins = originsFor(port);
    app = createApiServer({ origins, gate, sessions, clock, register: createRoutes({ storage, hub, pipeline,
      ...(options.keepAliveMs === undefined ? {} : { keepAliveMs: options.keepAliveMs }),
    }) });
    await listenLoopback(app, port);
    const token = gate.token;
    if (token === undefined) throw new Error("Bootstrap token unavailable");
    options.onBootstrapToken(token);
    return { app, port, origins, storage, hub, close };
  } catch (error) {
    try { await close(); } catch { /* Preserve the original startup failure. */ }
    throw error;
  }
}
