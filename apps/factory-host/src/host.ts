import type { FastifyInstance } from "fastify";
import { createServer } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { chmod, lstat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiServer, createRoutes, listenLoopback, originsFor, registerStaticUi } from "./api/index.js";
import { createCommandPipeline } from "./commands/pipeline.js";
import { chatSendHandler, conversationsCreateHandler } from "./chat/index.js";
import { EventHub } from "./events/hub.js";
import { createBootstrapGate, createSessionStore } from "./identity/index.js";
import { createIdGenerator, systemClock, type Clock } from "./ids.js";
import { createLeadRunner, type LeadConfig, type LeadRunner } from "./lead/runner.js";
import type { ModelGateway } from "./models/index.js";
import { createUpstream } from "./models/upstream.js";
import { createModelProxy, createTokenRegistry, type TokenRegistry } from "./proxy/index.js";
import type { ModelAccess } from "./dispatch/dispatcher.js";
import { loadPack } from "./org/index.js";
import { budgetsSetHandler, DEFAULT_BUDGET_CONFIG, type BudgetConfig } from "./policy/index.js";
import { createProjectsCreateHandler } from "./projects/service.js";
import { openStorage, type Storage } from "./storage/database.js";
import { tasksCreateHandler, tasksTransitionHandler } from "./work/service.js";
import { createBackupService, type BackupKeep, type BackupService, type BackupStatus } from "./backup/service.js";
import { startBackupScheduler } from "./backup/scheduler.js";
import { lockStateDirectory } from "./backup/lock.js";
import { advanceTasks, createDispatchHandlers, createDispatcher, createFakeRuntime, eventsForTask, RuntimeRegistry, type Dispatcher, type DispatcherConfig, type RuntimeAdapter } from "./dispatch/index.js";
import { assertInside, canonicalRoots } from "./workspace/index.js";
import { createWorkspaceProvider, type WorkspaceProvider } from "./dispatch/workspace-provider.js";
import { canonicalPath, refuseMount } from "./workspace/paths.js";
import { SANDBOX_RELAY_PORT } from "./sandbox/index.js";

function proxySocketPath(path: string): string {
  try {
    if (typeof path !== "string" || !isAbsolute(path) || /[\0\r\n]/.test(path)
      || path.split(/[\\/]/).some((part) => part === "." || part === "..") || resolve(path) !== path) throw new Error();
    refuseMount(path);
    const canonical = canonicalPath(path);
    refuseMount(canonical);
    if (canonical !== path) throw new Error();
    return canonical;
  } catch { throw new Error("Invalid proxy socket configuration"); }
}

async function prepareProxySocket(path: string): Promise<void> {
  try {
    const parent = await lstat(dirname(path));
    if (!parent.isDirectory() || (parent.mode & 0o777) !== 0o700) throw new Error();
    try {
      const previous = await lstat(path);
      if (!previous.isSocket() && !previous.isFile()) throw new Error();
      await unlink(path);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  } catch { throw new Error("Invalid proxy socket configuration"); }
}

export function parseEnv(env: Readonly<Record<string, string | undefined>>): {
  stateDir: string; port: number; backupDir?: string;
  periodicBackup: { dir: string; intervalMs: number };
  dispatch: { nodeSlots: number };
  workspace: { projectsRoot: string; worktreesRoot: string };
  agentProxy?: { port: number; approvedModels: string[]; socketPath?: string };
} {
  const input = env.FACTORY_PORT ?? "8787";
  if (!/^[0-9]+$/.test(input) || !Number.isSafeInteger(Number(input)) || Number(input) < 1 || Number(input) > 65_535)
    throw new Error("FACTORY_PORT must be an integer from 1 to 65535");
  const minutes = env.FACTORY_BACKUP_INTERVAL_MINUTES ?? "60";
  if (!/^[0-9]+$/.test(minutes) || !Number.isSafeInteger(Number(minutes)) || Number(minutes) < 1 || Number(minutes) > 1440)
    throw new Error("FACTORY_BACKUP_INTERVAL_MINUTES must be an integer from 1 to 1440");
  const stateDir = env.FACTORY_STATE_DIR ?? join(homedir(), "factory-v2", "state");
  const slots = env.FACTORY_NODE_SLOTS ?? "2";
  if (!/^[0-9]+$/.test(slots) || !Number.isSafeInteger(Number(slots)) || Number(slots) < 1 || Number(slots) > 16)
    throw new Error("FACTORY_NODE_SLOTS must be an integer from 1 to 16");
  if ((env.FACTORY_RUNTIME ?? "fake") !== "fake") throw new Error("unsupported runtime");
  let approvedModels: string[] | undefined;
  if (env.FACTORY_AGENT_MODELS !== undefined) {
    approvedModels = env.FACTORY_AGENT_MODELS.split(",");
    if (approvedModels.some((model) => !model || /[\s\p{Cc}]/u.test(model)) || new Set(approvedModels).size !== approvedModels.length)
      throw new Error("FACTORY_AGENT_MODELS must contain unique non-empty model names without whitespace");
  }
  const proxyPort = env.FACTORY_PROXY_PORT ?? String(Number(input) + 1);
  const socketPath = env.FACTORY_PROXY_SOCKET === undefined ? undefined : proxySocketPath(env.FACTORY_PROXY_SOCKET);
  if ((approvedModels || env.FACTORY_PROXY_PORT !== undefined) && (!/^[0-9]+$/.test(proxyPort)
    || !Number.isSafeInteger(Number(proxyPort)) || Number(proxyPort) < 1 || Number(proxyPort) > 65_535))
    throw new Error("FACTORY_PROXY_PORT must be an integer from 1 to 65535");
  let workspace: { projectsRoot: string; worktreesRoot: string };
  try {
    workspace = canonicalRoots({
      projectsRoot: env.FACTORY_PROJECTS_ROOT ?? (existsSync("/srv/factory/workspaces")
        ? resolve("/srv/factory/workspaces") : join(homedir(), "factory-v2", "workspaces")),
      worktreesRoot: env.FACTORY_WORKTREES_ROOT ?? join(homedir(), "factory-v2", "worktrees"),
    });
  } catch { throw new Error("Workspace roots must be absolute, separate directories outside /mnt"); }
  return {
    stateDir, port: Number(input), dispatch: { nodeSlots: Number(slots) }, workspace,
    ...(approvedModels === undefined ? {} : { agentProxy: { port: Number(proxyPort), approvedModels,
      ...(socketPath === undefined ? {} : { socketPath }) } }),
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
  dispatch?: Partial<DispatcherConfig> & { stepMs?: number; adapters?: RuntimeAdapter[] } | null;
  workspace?: { projectsRoot: string; worktreesRoot: string; evidenceDir?: string } | null;
  modelProxy?: { port: number; upstream: { baseUrl: string; apiKey: string; providerId?: string; fetchImpl?: typeof fetch };
    approvedModels: string[]; allowedHosts?: string[]; socketPath?: string } | null;
}): Promise<{
  app: FastifyInstance; port: number; origins: string[]; storage: Storage; hub: EventHub; close(): Promise<void>;
  models: { gateway: ModelGateway | null; budgetConfig: BudgetConfig };
  lead: LeadRunner;
  dispatch: Dispatcher | null;
  workspace: WorkspaceProvider | null;
  proxy: { port: number; socketPath?: string; tokens: TokenRegistry } | null;
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
  const socketPath = options.modelProxy?.socketPath === undefined ? undefined : proxySocketPath(options.modelProxy.socketPath);
  const clock = options.clock ?? systemClock;
  const budgetConfig = options.budgetConfig ?? { ...DEFAULT_BUDGET_CONFIG };
  let storage: Storage | undefined;
  let app: FastifyInstance | undefined;
  let runner: LeadRunner | undefined;
  let dispatch: Dispatcher | null = null;
  let workspace: WorkspaceProvider | null = null;
  let modelProxy: ReturnType<typeof createModelProxy> | undefined;
  let proxy: { port: number; socketPath?: string; tokens: TokenRegistry } | null = null;
  let ownsSocket = false;
  let modelAccess: ModelAccess | undefined;
  let evidenceDir: string | undefined;
  let backup: { service: BackupService; status(): BackupStatus } | null = null;
  let scheduler: ReturnType<typeof startBackupScheduler> | undefined;
  let unlockState: (() => void) | undefined;
  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      try { await runner?.stop(); } finally {
        try {
          proxy?.tokens.revokeAll();
          try { await modelProxy?.close(); } finally {
            if (ownsSocket && socketPath) {
              ownsSocket = false;
              try { await unlink(socketPath); }
              catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Proxy socket cleanup failed"); }
            }
          }
        } finally {
          try { await dispatch?.stop(); } finally {
            try { await app?.close(); } finally {
              try {
                await scheduler?.stop();
                try { backup?.service.run("shutdown"); } catch { /* Backup failure cannot prevent closing storage. */ }
              } finally {
                try { storage?.close(); } finally { unlockState?.(); }
              }
            }
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
    if (options.modelProxy) {
      const configured = options.modelProxy;
      if (!Number.isSafeInteger(configured.port) || configured.port < 0 || configured.port > 65_535
        || !configured.approvedModels.length || configured.approvedModels.some((model) => !model || /[\s\p{Cc}]/u.test(model))
        || new Set(configured.approvedModels).size !== configured.approvedModels.length) throw new Error("Invalid model proxy configuration");
      const upstream = createUpstream(configured.upstream);
      const tokens = createTokenRegistry({ clock });
      const allowedHosts = configured.allowedHosts === undefined ? [] : [...configured.allowedHosts];
      modelProxy = createModelProxy({ upstream, tokens, raw: storage.raw, budget: budgetConfig, clock,
        newId: createIdGenerator(clock), allowedHosts });
      let listeningPort = 0;
      if (socketPath === undefined) listeningPort = await listenLoopback(modelProxy.app, configured.port);
      else {
        await prepareProxySocket(socketPath);
        try {
          await modelProxy.app.listen({ path: socketPath });
          ownsSocket = true;
          await chmod(socketPath, 0o600);
        } catch { throw new Error("Proxy socket unavailable"); }
      }
      // Until the actual port is known the default allow-list rejects every request.
      const modelPort = socketPath === undefined ? listeningPort : SANDBOX_RELAY_PORT;
      if (configured.allowedHosts === undefined) allowedHosts.push(`127.0.0.1:${modelPort}`, `localhost:${modelPort}`);
      proxy = { port: listeningPort, tokens, ...(socketPath === undefined ? {} : { socketPath }) };
      const approvedModels = [...configured.approvedModels];
      modelAccess = { issue(input) {
        const { token } = tokens.issue({ ...input, allowedModels: approvedModels });
        return { token, models: [...approvedModels], baseUrl: `http://127.0.0.1:${modelPort}/v1`,
          ...(socketPath === undefined ? {} : { socketPath }) };
      }, revoke: (attemptId) => tokens.revoke(attemptId) };
    }
    if (options.dispatch) {
      const { stepMs, adapters, ...config } = options.dispatch;
      const registry = new RuntimeRegistry(adapters ?? [createFakeRuntime(stepMs === undefined ? {} : { stepMs })]);
      const raw = storage.raw;
      let roots: ReturnType<typeof canonicalRoots> | null = null;
      try { if (options.workspace) roots = canonicalRoots(options.workspace); }
      catch { throw new Error("Workspace roots must be absolute, separate directories outside /mnt"); }
      if (roots) {
        evidenceDir = options.workspace?.evidenceDir ?? join(stateDir, "evidence");
        workspace = createWorkspaceProvider({ roots, evidenceDir });
      }
      dispatch = createDispatcher({ storage, hub, registry, clock, config,
        ...(modelAccess === undefined ? {} : { modelAccess }),
        ...(workspace && roots ? { workspace, projectRootFor(projectId: string) {
          const row = raw.prepare("SELECT workspace_root FROM projects WHERE id = ?").get(projectId) as { workspace_root: string | null } | undefined;
          try { return row?.workspace_root ? assertInside(roots.projectsRoot, row.workspace_root) : null; }
          catch { return null; }
        } } : {}),
      });
      dispatch.start();
      const dispatcher = dispatch;
      for (const project of raw.prepare("SELECT id FROM projects ORDER BY id").all() as { id: string }[]) {
        try {
          hub.transaction(() => {
            for (const task of advanceTasks(raw, project.id, { dispatcher }))
              hub.append({ projectId: project.id, causationId: task.id, rootCausationId: task.id, payload: eventsForTask(task) });
          });
        } catch { console.error("Dispatch startup catch-up failed for project", project.id); }
      }
    }
    const lead = runner;
    const pipeline = createCommandPipeline({ storage, hub, clock, handlers: {
      "projects.create": createProjectsCreateHandler({ pack }),
      "tasks.create": tasksCreateHandler, "tasks.transition": tasksTransitionHandler,
      "budgets.set": budgetsSetHandler,
      "conversations.create": conversationsCreateHandler, "chat.send": chatSendHandler,
      ...(dispatch === null ? {} : createDispatchHandlers({ dispatcher: dispatch })),
    } });
    const gate = createBootstrapGate({ clock });
    const sessions = createSessionStore({ clock });
    const port = options.port === 0 ? await freeLoopbackPort() : options.port;
    const origins = originsFor(port);
    const routes = createRoutes({ storage, hub, pipeline, clock, budgetConfig, backupStatus: () => backup?.status() ?? null,
      afterCommand: (type) => { if (type === "chat.send") lead.kick(); },
      ...(dispatch === null ? {} : { dispatch }),
      ...(evidenceDir === undefined ? {} : { evidenceDir }),
      ...(options.keepAliveMs === undefined ? {} : { keepAliveMs: options.keepAliveMs }),
    });
    app = createApiServer({ origins, gate, sessions, clock, register(app, guards) {
      routes(app, guards);
      if (options.uiDir) registerStaticUi(app, { dir: options.uiDir });
    } });
    await listenLoopback(app, port);
    lead.kick();
    dispatch?.kick();
    const token = gate.token;
    if (token === undefined) throw new Error("Bootstrap token unavailable");
    options.onBootstrapToken(token);
    return { app, port, origins, storage, hub, lead, dispatch, workspace, proxy, backup, models: { gateway: options.modelGateway ?? null, budgetConfig }, close };
  } catch (error) {
    try { await close(); } catch { /* Preserve the original startup failure. */ }
    throw error;
  }
}
