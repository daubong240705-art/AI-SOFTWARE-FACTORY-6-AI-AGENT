import type { FastifyInstance } from "fastify";
import { createServer } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiServer, createRoutes, listenLoopback, originsFor, registerStaticUi } from "./api/index.js";
import { createCommandPipeline } from "./commands/pipeline.js";
import { chatSendHandler, conversationsCreateHandler } from "./chat/index.js";
import { EventHub } from "./events/hub.js";
import { createBootstrapGate, createSessionStore } from "./identity/index.js";
import { systemClock, type Clock } from "./ids.js";
import { createLeadRunner, type LeadConfig, type LeadRunner } from "./lead/runner.js";
import type { ModelGateway } from "./models/index.js";
import { loadPack } from "./org/index.js";
import { budgetsSetHandler, DEFAULT_BUDGET_CONFIG, type BudgetConfig } from "./policy/index.js";
import { createProjectsCreateHandler } from "./projects/service.js";
import { openStorage, type Storage } from "./storage/database.js";
import { tasksCreateHandler, tasksTransitionHandler } from "./work/service.js";
import { createBackupService, type BackupKeep, type BackupService, type BackupStatus } from "./backup/service.js";
import { startBackupScheduler } from "./backup/scheduler.js";
import { lockStateDirectory } from "./backup/lock.js";

export function parseEnv(env: Readonly<Record<string, string | undefined>>): {
  stateDir: string; port: number; backupDir?: string;
  periodicBackup: { dir: string; intervalMs: number };
} {
  const input = env.FACTORY_PORT ?? "8787";
  if (!/^[0-9]+$/.test(input) || !Number.isSafeInteger(Number(input)) || Number(input) < 1 || Number(input) > 65_535)
    throw new Error("FACTORY_PORT must be an integer from 1 to 65535");
  const minutes = env.FACTORY_BACKUP_INTERVAL_MINUTES ?? "60";
  if (!/^[0-9]+$/.test(minutes) || !Number.isSafeInteger(Number(minutes)) || Number(minutes) < 1 || Number(minutes) > 1440)
    throw new Error("FACTORY_BACKUP_INTERVAL_MINUTES must be an integer from 1 to 1440");
  const stateDir = env.FACTORY_STATE_DIR ?? join(homedir(), "factory-v2", "state");
  return {
    stateDir, port: Number(input),
    ...(env.FACTORY_MIGRATION_BACKUP_DIR === undefined ? {} : { backupDir: env.FACTORY_MIGRATION_BACKUP_DIR }),
    periodicBackup: {
      dir: env.FACTORY_BACKUP_DIR ?? (existsSync("/mnt/d") ? "/mnt/d/factory-backup" : join(stateDir, "backups", "periodic")),
      intervalMs: Number(minutes) * 60_000,
    },
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
  stateDir: string; port: number; backupDir?: string; migrationsDir?: string; packDir?: string; clock?: Clock;
  onBootstrapToken: (token: string) => void; keepAliveMs?: number; modelGateway?: ModelGateway | null;
  budgetConfig?: BudgetConfig; lead?: Partial<LeadConfig>; uiDir?: string;
  periodicBackup?: { dir: string; intervalMs?: number; firstRunDelayMs?: number; keep?: BackupKeep } | null;
}): Promise<{
  app: FastifyInstance; port: number; origins: string[]; storage: Storage; hub: EventHub; close(): Promise<void>;
  models: { gateway: ModelGateway | null; budgetConfig: BudgetConfig };
  lead: LeadRunner;
  backup: { service: BackupService; status(): BackupStatus } | null;
}> {
  // Check POSIX spelling too, including when validating a WSL path on Windows.
  const normalized = posix.normalize(options.stateDir.replaceAll("\\", "/"));
  if (normalized === "/mnt" || normalized.startsWith("/mnt/"))
    throw new Error("State directory must not be on a /mnt/ Windows-drive mount; SQLite WAL requires a local filesystem");
  if (!isAbsolute(options.stateDir)) throw new Error("State directory must be an absolute path");
  const stateDir = resolve(options.stateDir);
  if (!Number.isSafeInteger(options.port) || options.port < 0 || options.port > 65_535)
    throw new Error("Host port must be an integer from 0 to 65535");
  if (options.uiDir && !isAbsolute(options.uiDir)) throw new Error("UI directory must be an absolute path");
  const clock = options.clock ?? systemClock;
  const budgetConfig = options.budgetConfig ?? { ...DEFAULT_BUDGET_CONFIG };
  let storage: Storage | undefined;
  let app: FastifyInstance | undefined;
  let runner: LeadRunner | undefined;
  let backup: { service: BackupService; status(): BackupStatus } | null = null;
  let scheduler: ReturnType<typeof startBackupScheduler> | undefined;
  let unlockState: (() => void) | undefined;
  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      try { await runner?.stop(); } finally {
        try { await app?.close(); } finally {
          try {
            await scheduler?.stop();
            try { backup?.service.run("shutdown"); } catch { /* Backup failure cannot prevent closing storage. */ }
          } finally {
            try { storage?.close(); } finally { unlockState?.(); }
          }
        }
      }
    })();
    return closePromise;
  };
  try {
    const pack = loadPack(options.packDir ?? fileURLToPath(new URL("../../../packs/software-team/", import.meta.url)));
    unlockState = lockStateDirectory(stateDir);
    storage = openStorage(join(stateDir, "host.db"));
    storage.migrate({
      migrationsDir: options.migrationsDir ?? fileURLToPath(new URL("../migrations/", import.meta.url)),
      backupDir: options.backupDir ?? join(stateDir, "backups"), now: clock,
    });
    if (options.periodicBackup) {
      const service = createBackupService({ storage, dir: options.periodicBackup.dir, clock,
        ...(options.periodicBackup.keep === undefined ? {} : { keep: options.periodicBackup.keep }),
      });
      backup = { service, status: () => service.status() };
      scheduler = startBackupScheduler({ service, clock,
        ...(options.periodicBackup.intervalMs === undefined ? {} : { intervalMs: options.periodicBackup.intervalMs }),
        ...(options.periodicBackup.firstRunDelayMs === undefined ? {} : { firstRunDelayMs: options.periodicBackup.firstRunDelayMs }),
      });
    }
    const hub = new EventHub(storage.raw, { clock });
    const leadSeat = pack.manifest.seats.find((seat) => seat.isLead);
    if (!leadSeat) throw new Error("Pack has no Lead seat");
    runner = createLeadRunner({ storage, hub, gateway: options.modelGateway ?? null, budgetConfig, clock,
      profileText: readFileSync(join(pack.dir, leadSeat.profile), "utf8"),
      ...(options.lead === undefined ? {} : { config: options.lead }),
    });
    runner.recover();
    const lead = runner;
    const pipeline = createCommandPipeline({ storage, hub, clock, handlers: {
      "projects.create": createProjectsCreateHandler({ pack }),
      "tasks.create": tasksCreateHandler, "tasks.transition": tasksTransitionHandler,
      "budgets.set": budgetsSetHandler,
      "conversations.create": conversationsCreateHandler, "chat.send": chatSendHandler,
    } });
    const gate = createBootstrapGate({ clock });
    const sessions = createSessionStore({ clock });
    const port = options.port === 0 ? await freeLoopbackPort() : options.port;
    const origins = originsFor(port);
    const routes = createRoutes({ storage, hub, pipeline, clock, budgetConfig, backupStatus: () => backup?.status() ?? null,
      afterCommand: (type) => { if (type === "chat.send") lead.kick(); },
      ...(options.keepAliveMs === undefined ? {} : { keepAliveMs: options.keepAliveMs }),
    });
    app = createApiServer({ origins, gate, sessions, clock, register(app, guards) {
      routes(app, guards);
      if (options.uiDir) registerStaticUi(app, { dir: options.uiDir });
    } });
    await listenLoopback(app, port);
    lead.kick();
    const token = gate.token;
    if (token === undefined) throw new Error("Bootstrap token unavailable");
    options.onBootstrapToken(token);
    return { app, port, origins, storage, hub, lead, backup, models: { gateway: options.modelGateway ?? null, budgetConfig }, close };
  } catch (error) {
    try { await close(); } catch { /* Preserve the original startup failure. */ }
    throw error;
  }
}
