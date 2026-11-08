import { expireRequests } from "./requests/service.js";
import type { FastifyInstance } from "fastify";
import { createServer } from "node:net";
import { existsSync, readFileSync, statSync } from "node:fs";
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
import { createOrgHandlers, loadPack, loadPackRegistry, ORG_COMMANDS } from "./org/index.js";
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
import { createContentStore, type ContentStore } from "./artifacts/content-store.js";
import { approvalsDecideHandler, createApprovalsDecideHandler, expirePendingApprovals, requestAgentDecision, requestTaskReview } from "./approvals/service.js";
import type { Timers } from "./dispatch/dispatcher.js";
import { registerAgentOutput, registerAttemptResults } from "./artifacts/service.js";
import { createMcpHandler } from "./mcp/rpc.js";
import { assertActiveGrant, McpToolError } from "./mcp/security.js";
import { parsePushRemotes, validatePushSshCommand, type PushRemote } from "./effects/config.js";
import { createEffectExecutor, type EffectExecutor } from "./effects/executor.js";
import { createKnowledgeIndex, type KnowledgeIndex } from "./knowledge/index.js";
import { registerKnowledgeRoutes } from "./knowledge/routes.js";
import { createKnowledgeMcp } from "./knowledge/mcp.js";
import { createKnowledgeHandlers, withKnowledgeEffects } from "./knowledge/commands.js";
import { collectLifecycleChanges } from "./knowledge/lifecycle.js";
import { createRequestsMcp } from "./requests/mcp.js";
import { createRequestHandlers, REQUEST_COMMANDS } from "./requests/commands.js";

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
  multiTeam: boolean;
  stateDir: string; port: number; backupDir?: string;
  periodicBackup: { dir: string; intervalMs: number };
  dispatch: { nodeSlots: number };
  workspace: { projectsRoot: string; worktreesRoot: string };
  agentProxy?: { port: number; approvedModels: string[]; socketPath?: string };
  opencode?: { dir: string };
  pushRemotes: PushRemote[] | null;
  pushSshCommand?: string;
} {
  if (env.FACTORY_MULTI_TEAM !== undefined && env.FACTORY_MULTI_TEAM !== "0" && env.FACTORY_MULTI_TEAM !== "1")
    throw new Error("FACTORY_MULTI_TEAM must be 0 or 1");
  const pushRemotes = env.FACTORY_PUSH_REMOTES === undefined ? null : parsePushRemotes(env.FACTORY_PUSH_REMOTES);
  validatePushSshCommand(env.FACTORY_PUSH_SSH_COMMAND);
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
  const runtime = env.FACTORY_RUNTIME ?? "fake";
  if (runtime !== "fake" && runtime !== "opencode") throw new Error("unsupported runtime");
  let opencode: { dir: string } | undefined;
  if (runtime === "opencode") {
    for (const name of ["FACTORY_OPENCODE_DIR", "FACTORY_PROXY_SOCKET", "FACTORY_AGENT_MODELS", "NINE_ROUTER_API_KEY", "FACTORY_GATEWAY_URL"] as const)
      if (!env[name]?.trim()) throw new Error(`${name} is required for FACTORY_RUNTIME=opencode`);
    const dir = env.FACTORY_OPENCODE_DIR;
    try {
      if (!dir || !isAbsolute(dir) || /[\0\r\n]/.test(dir) || !statSync(dir).isDirectory()
        || !statSync(join(dir, "bin", "opencode")).isFile()) throw new Error();
      opencode = { dir };
    } catch { throw new Error("FACTORY_OPENCODE_DIR must be an absolute directory containing bin/opencode"); }
    try {
      const url = new URL(env.FACTORY_GATEWAY_URL ?? "");
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    } catch { throw new Error("FACTORY_GATEWAY_URL must be an HTTP or HTTPS URL without credentials"); }
  }
  let approvedModels: string[] | undefined;
  if (env.FACTORY_AGENT_MODELS !== undefined) {
    approvedModels = env.FACTORY_AGENT_MODELS.split(",");
    if (approvedModels.some((model) => !model || /[\s\p{Cc}]/u.test(model)) || new Set(approvedModels).size !== approvedModels.length)
      throw new Error("FACTORY_AGENT_MODELS must contain unique non-empty model names without whitespace");
  }
  const proxyPort = env.FACTORY_PROXY_PORT ?? String(Number(input) + 1);
  let socketPath: string | undefined;
  try { socketPath = env.FACTORY_PROXY_SOCKET === undefined ? undefined : proxySocketPath(env.FACTORY_PROXY_SOCKET); }
  catch { throw new Error(runtime === "opencode" ? "FACTORY_PROXY_SOCKET must be a canonical absolute socket path outside /mnt" : "Invalid proxy socket configuration"); }
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
  } catch { throw new Error(runtime === "opencode"
    ? "FACTORY_PROJECTS_ROOT and FACTORY_WORKTREES_ROOT must be absolute, separate directories outside /mnt"
    : "Workspace roots must be absolute, separate directories outside /mnt"); }
  if (runtime === "opencode") {
    for (const [name, path] of [["FACTORY_PROJECTS_ROOT", workspace.projectsRoot], ["FACTORY_WORKTREES_ROOT", workspace.worktreesRoot]] as const) {
      try {
        // Missing roots are created by the workspace provider; existing files cannot be workspace roots.
        if (existsSync(path) && !statSync(path).isDirectory()) throw new Error();
        const state = canonicalPath(stateDir);
        if (state === path || state.startsWith(`${path}/`) || path.startsWith(`${state}/`)
          || state.startsWith(`${path}\\`) || path.startsWith(`${state}\\`)) throw new Error();
      } catch { throw new Error(`${name} must be a directory separate from FACTORY_STATE_DIR`); }
    }
  }
  return {
    multiTeam: env.FACTORY_MULTI_TEAM === "1",
    stateDir, port: Number(input), dispatch: { nodeSlots: Number(slots) }, workspace, pushRemotes,
    ...(env.FACTORY_PUSH_SSH_COMMAND === undefined ? {} : { pushSshCommand: env.FACTORY_PUSH_SSH_COMMAND }),
    ...(opencode === undefined ? {} : { opencode }),
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
  multiTeam?: boolean; packsDir?: string;
  contentDir?: string;
  pushRemotes?: PushRemote[] | null;
  pushSshCommand?: string;
  timers?: Timers;
  stateDir: string; port: number; backupDir?: string; migrationsDir?: string; packDir?: string; clock?: Clock;
  onBootstrapToken: (token: string) => void; keepAliveMs?: number; modelGateway?: ModelGateway | null;
  budgetConfig?: BudgetConfig; lead?: Partial<LeadConfig>; uiDir?: string;
  runtimes?: RuntimeAdapter[];
  periodicBackup?: { dir: string; intervalMs?: number; firstRunDelayMs?: number; keep?: BackupKeep } | null;
  dispatch?: Partial<DispatcherConfig> & { stepMs?: number; adapters?: RuntimeAdapter[] } | null;
  workspace?: { projectsRoot: string; worktreesRoot: string; evidenceDir?: string } | null;
  modelProxy?: { port: number; upstream: { baseUrl: string; apiKey: string; providerId?: string; fetchImpl?: typeof fetch };
    approvedModels: string[]; allowedHosts?: string[]; socketPath?: string } | null;
}): Promise<{
  app: FastifyInstance; port: number; origins: string[]; storage: Storage; hub: EventHub; close(): Promise<void>;
  models: { gateway: ModelGateway | null; budgetConfig: BudgetConfig };
  lead: LeadRunner;
  artifacts: { store: ContentStore };
  knowledge: KnowledgeIndex;
  dispatch: Dispatcher | null;
  workspace: WorkspaceProvider | null;
  effects: EffectExecutor | null;
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
  validatePushSshCommand(options.pushSshCommand);
  const pushRemotes = options.pushRemotes?.length
    ? parsePushRemotes(options.pushRemotes.map((remote) => `${remote.name}=${remote.url}`).join(",")) : null;
  const clock = options.clock ?? systemClock;
  const budgetConfig = options.budgetConfig ?? { ...DEFAULT_BUDGET_CONFIG };
  let storage: Storage | undefined;
  let app: FastifyInstance | undefined;
  let runner: LeadRunner | undefined;
  let dispatch: Dispatcher | null = null;
  let workspace: WorkspaceProvider | null = null;
  let effects: EffectExecutor | null = null;
  let modelProxy: ReturnType<typeof createModelProxy> | undefined;
  let proxy: { port: number; socketPath?: string; tokens: TokenRegistry } | null = null;
  let ownsSocket = false;
  let modelAccess: ModelAccess | undefined;
  let startModelProxy: (() => Promise<void>) | undefined;
  let evidenceDir: string | undefined;
  let backup: { service: BackupService; status(): BackupStatus } | null = null;
  let scheduler: ReturnType<typeof startBackupScheduler> | undefined;
  let unlockState: (() => void) | undefined;
  let expiryTimer: unknown;
  let knowledgeTimer: ReturnType<typeof setImmediate> | undefined;
  const interval = options.timers?.setInterval ?? ((callback: () => void, ms: number) => setInterval(callback, ms).unref());
  const clearExpiry = options.timers?.clearInterval ?? ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>));
  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      if (expiryTimer !== undefined) { clearExpiry(expiryTimer); expiryTimer = undefined; }
      if (knowledgeTimer !== undefined) { clearImmediate(knowledgeTimer); knowledgeTimer = undefined; }
      await effects?.close();
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
    const packs = loadPackRegistry(options.packsDir ?? fileURLToPath(new URL("../../../packs/", import.meta.url)), {
      defaultPack: pack, onError: (message) => { console.error(message); },
    });
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
    if (pushRemotes) {
      const raw = storage.raw;
      let roots: ReturnType<typeof canonicalRoots> | null = null;
      try { if (options.workspace) roots = canonicalRoots(options.workspace); }
      catch { throw new Error("Invalid push workspace configuration"); }
      effects = createEffectExecutor({ raw, hub, clock, newId: createIdGenerator(clock), remotes: pushRemotes,
        ...(options.pushSshCommand === undefined ? {} : { sshCommand: options.pushSshCommand }),
        projectRootFor(projectId) {
          const row = raw.prepare("SELECT workspace_root, workspace_kind FROM projects WHERE id = ?").get(projectId) as
            { workspace_root: string; workspace_kind: string } | undefined;
          try { return roots && row?.workspace_kind === "git" ? assertInside(roots.projectsRoot, row.workspace_root) : null; }
          catch { return null; }
        },
      });
      effects.recoverAtStart();
    }
    const approvalRaw = storage.raw;
    const sweepApprovals = (): void => {
      expirePendingApprovals({ raw: approvalRaw, hub, now: clock });
      if (options.multiTeam && dispatch) {
        try { expireRequests({ raw: approvalRaw, hub, dispatcher: dispatch, multiTeam: true, now: clock, newId: createIdGenerator(clock) }, clock()); }
        catch { console.error("Request expiry failed"); }
      }
    };
    sweepApprovals();
    expiryTimer = interval(() => { try { sweepApprovals(); } catch { console.error("Approval expiry failed"); } }, 60_000);
    const artifacts = { store: createContentStore({ dir: options.contentDir ?? join(stateDir, "content") }) };
    const knowledge = createKnowledgeIndex({ raw: storage.raw, store: artifacts.store });
    const afterRegister = (ref: { projectId: string; artifactId: string; version: number }): void => {
      knowledge.indexVersion(ref.projectId, ref.artifactId, ref.version);
    };
    const backfill = (): void => {
      knowledgeTimer = undefined;
      try {
        const batch = knowledge.indexAllMissing();
        if (batch.remaining && batch.indexed) knowledgeTimer = setImmediate(backfill).unref();
      } catch { console.error("Knowledge indexing failed"); }
    };
    knowledgeTimer = setImmediate(backfill).unref();
    const resultId = createIdGenerator(clock);
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
      let modelPort = SANDBOX_RELAY_PORT;
      const approvedModels = [...configured.approvedModels];
      modelAccess = { issue(input) {
        const { token } = tokens.issue({ ...input, allowedModels: approvedModels });
        return { token, models: [...approvedModels], baseUrl: `http://127.0.0.1:${modelPort}/v1`,
          ...(socketPath === undefined ? {} : { socketPath }) };
      }, revoke: (attemptId) => tokens.revoke(attemptId) };
      const raw = storage.raw;
      startModelProxy = async () => {
      const dispatcher = dispatch;
      const mcp = dispatcher === null ? undefined : createMcpHandler({
        ...(options.multiTeam ? { requests: createRequestsMcp({ raw, hub, dispatcher, multiTeam: true, now: clock, newId: resultId }) } : {}),
        knowledge: createKnowledgeMcp({ raw, knowledge, now: clock }),
        requestDecision(grant, request) {
          const result = requestAgentDecision({ raw, hub, now: clock, newId: resultId }, { grant, request });
          // The synchronous tool result is serialized before this deferred stop fences its session.
          setTimeout(() => { void dispatcher.parkAttempt(grant).catch(() => { console.error("Decision parking failed"); }); }, 50).unref();
          return result;
        },
        progress(grant, input) {
          assertActiveGrant(raw, grant);
          if (!dispatcher.recordAgentProgress(grant, input.summary, input.percent)) throw new McpToolError("attempt is not active");
        },
        registerOutput(grant, input) {
          return hub.transaction(() => {
            const { result: ref, effects: changes } = collectLifecycleChanges(raw, () => registerAgentOutput(
              { raw, store: artifacts.store, now: clock, newId: resultId, afterRegister }, { ...input, grant }));
            for (const entity of changes) hub.append({ projectId: grant.projectId, causationId: grant.attemptId,
              rootCausationId: grant.attemptId, payload: { type: "entity.changed", entity } });
            hub.append({ projectId: grant.projectId, causationId: grant.attemptId, rootCausationId: grant.attemptId,
              payload: { type: "entity.changed", entity: { kind: "artifact-version", id: ref.artifactId, revision: ref.version } } });
            return ref;
          });
        },
      });
      modelProxy = createModelProxy({ upstream, tokens, raw, budget: budgetConfig, clock,
        newId: createIdGenerator(clock), allowedHosts, ...(mcp === undefined ? {} : { mcp }) });
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
      modelPort = socketPath === undefined ? listeningPort : SANDBOX_RELAY_PORT;
      if (configured.allowedHosts === undefined) allowedHosts.push(`127.0.0.1:${modelPort}`, `localhost:${modelPort}`);
      proxy = { port: listeningPort, tokens, ...(socketPath === undefined ? {} : { socketPath }) };
      };
    }
    if (options.dispatch) {
      const { stepMs, adapters, ...config } = options.dispatch;
      const registry = new RuntimeRegistry([
        createFakeRuntime(stepMs === undefined ? {} : { stepMs }), ...(adapters ?? []), ...(options.runtimes ?? []),
      ]);
      const raw = storage.raw;
      let roots: ReturnType<typeof canonicalRoots> | null = null;
      try { if (options.workspace) roots = canonicalRoots(options.workspace); }
      catch { throw new Error("Workspace roots must be absolute, separate directories outside /mnt"); }
      if (roots) {
        evidenceDir = options.workspace?.evidenceDir ?? join(stateDir, "evidence");
        workspace = createWorkspaceProvider({ roots, evidenceDir });
      }
      const resultsEvidenceDir = evidenceDir;
      dispatch = createDispatcher({ storage, hub, registry, clock, config, multiTeam: options.multiTeam ?? false,
        ...(options.timers === undefined ? {} : { timers: options.timers }),
        onInReview(input) { requestTaskReview({ raw, hub, now: clock, newId: resultId }, input); },
        ...(modelAccess === undefined ? {} : { modelAccess }),
        results: { register(input) {
          const { result: refs, effects: changes } = collectLifecycleChanges(raw, () => registerAttemptResults({ raw, store: artifacts.store, now: clock, newId: resultId,
            afterRegister,
            onError: () => { console.error("Artifact registration failed"); } }, { ...input, evidenceDir: resultsEvidenceDir ?? join(stateDir, "evidence") }));
          for (const entity of changes) hub.append({ projectId: input.projectId, causationId: input.attemptId,
            rootCausationId: input.attemptId, payload: { type: "entity.changed", entity } });
          for (const ref of refs) hub.append({ projectId: input.projectId, causationId: input.attemptId,
            rootCausationId: input.attemptId, payload: { type: "entity.changed",
              entity: { kind: "artifact-version", id: ref.artifactId, revision: ref.version } } });
        } },
        ...(workspace && roots ? { workspace, projectRootFor(projectId: string) {
          const row = raw.prepare("SELECT workspace_root FROM projects WHERE id = ?").get(projectId) as { workspace_root: string | null } | undefined;
          try { return row?.workspace_root ? assertInside(roots.projectsRoot, row.workspace_root) : null; }
          catch { return null; }
        } } : {}),
      });
    }
    await startModelProxy?.();
    if (dispatch) {
      const raw = storage.raw;
      dispatch.start();
      sweepApprovals();
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
    const dispatchHandlers = dispatch === null ? {} : createDispatchHandlers({ dispatcher: dispatch });
    const pipeline = createCommandPipeline({ storage, hub, clock, handlers: {
      ...createOrgHandlers({ packs, multiTeam: options.multiTeam ?? false }),
      ...createRequestHandlers({ multiTeam: options.multiTeam ?? false, ...(dispatch === null ? {} : { dispatcher: dispatch }) }),
      "projects.create": createProjectsCreateHandler({ pack, multiTeam: options.multiTeam ?? false }),
      "tasks.create": tasksCreateHandler,
      "budgets.set": budgetsSetHandler,
      "approvals.decide": withKnowledgeEffects(dispatch === null ? approvalsDecideHandler : createApprovalsDecideHandler({ dispatcher: dispatch })),
        ...createKnowledgeHandlers({ multiTeam: options.multiTeam ?? false }),
      "conversations.create": conversationsCreateHandler, "chat.send": chatSendHandler,
      ...dispatchHandlers,
      "tasks.transition": withKnowledgeEffects(dispatchHandlers["tasks.transition"] ?? tasksTransitionHandler),
    } });
    const gate = createBootstrapGate({ clock });
    const sessions = createSessionStore({ clock });
    const port = options.port === 0 ? await freeLoopbackPort() : options.port;
    const origins = originsFor(port);
    const routes = createRoutes({ storage, hub, pipeline, clock, budgetConfig, artifacts, packs, backupStatus: () => backup?.status() ?? null,
      ...(effects === null ? {} : { effects }),
      afterCommand: (type, result) => {
        if (type === "chat.send") lead.kick();
        if (result.body.ok && ORG_COMMANDS.some((command) => command === type) && dispatch) {
          dispatch.kick();
        }
      },
      ...(dispatch === null ? {} : { dispatch }),
      ...(evidenceDir === undefined ? {} : { evidenceDir }),
      ...(options.keepAliveMs === undefined ? {} : { keepAliveMs: options.keepAliveMs }),
    });
    app = createApiServer({ origins, gate, sessions, clock, register(app, guards) {
      routes(app, guards);
      registerKnowledgeRoutes(app, guards, { raw: approvalRaw, knowledge });
      app.get("/system/capabilities", { preHandler: guards.session }, async () => ({
        apiVersion: 1, ok: true, commands: ["projects.create", "tasks.create", "tasks.transition", "budgets.set",
          ...(options.multiTeam ? [...ORG_COMMANDS, ...REQUEST_COMMANDS] : []),
          "conversations.create", "chat.send", "approvals.decide", "artifacts.transition", "artifacts.share", "artifacts.clear-stale",
          ...(dispatch === null ? [] : ["tasks.release", "runs.cancel", "runs.reconcile", "work.assign"])],
        capabilities: ["inbox", "approvals.review"],
      }));
      if (options.uiDir) registerStaticUi(app, { dir: options.uiDir });
    } });
    await listenLoopback(app, port);
    lead.kick();
    dispatch?.kick();
    const token = gate.token;
    if (token === undefined) throw new Error("Bootstrap token unavailable");
    options.onBootstrapToken(token);
    return { app, port, origins, storage, hub, lead, dispatch, workspace, effects, proxy, backup, artifacts, knowledge, models: { gateway: options.modelGateway ?? null, budgetConfig }, close };
  } catch (error) {
    try { await close(); } catch { /* Preserve the original startup failure. */ }
    throw error;
  }
}
