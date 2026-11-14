import { constants, type Stats } from "node:fs";
import { chmod, copyFile, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "better-sqlite3";
import { newGameResponseSchema, type NewGameRequest, type NewGameResponse } from "@factory/contracts";
import type { createCommandPipeline } from "../commands/pipeline.js";
import { createIdGenerator } from "../ids.js";
import type { LoadedPack } from "../org/pack.js";
import { getProject } from "../projects/service.js";
import { getWorkflowInstance } from "../workflow/service.js";
import { runGit } from "../workspace/git.js";
import { assertInside, canonicalPath } from "../workspace/paths.js";

const skipped = new Set(["node_modules", "dist", ".dev", ".git"]);

export class GameConflictError extends Error {
  constructor() { super("Game already exists."); }
}

async function statIfPresent(path: string): Promise<Stats | null> {
  try { return await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

async function copyStarter(source: string, target: string): Promise<void> {
  if (!(await lstat(source)).isDirectory()) throw new Error("Starter must be a directory without symlinks");
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name), to = join(target, entry.name);
    const stat = await lstat(from);
    if (stat.isSymbolicLink()) throw new Error("Starter contains a symlink");
    if (skipped.has(entry.name)) continue;
    if (stat.isDirectory()) {
      await mkdir(to);
      await copyStarter(from, to);
    } else if (stat.isFile()) {
      await copyFile(from, to, constants.COPYFILE_EXCL);
      await chmod(to, stat.mode & 0o777);
    } else throw new Error("Starter contains a non-regular file");
  }
}

export function createGameService(deps: {
  raw: Database; pipeline: ReturnType<typeof createCommandPipeline>; pack: LoadedPack;
  starterDir: string; projectsRoot: string;
}) {
  const newId = createIdGenerator();
  const pending = new Map<string, Promise<void>>();
  const workspaceUsed = (root: string): boolean => Boolean(deps.raw.prepare("SELECT 1 FROM projects WHERE workspace_root = ?").get(root));

  async function create(input: NewGameRequest): Promise<NewGameResponse> {
    const previous = pending.get(input.gameId);
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    pending.set(input.gameId, current);
    await previous;
    try { return await createUnlocked(input); }
    finally {
      release();
      if (pending.get(input.gameId) === current) pending.delete(input.gameId);
    }
  }

  async function createUnlocked(input: NewGameRequest): Promise<NewGameResponse> {
    const root = canonicalPath(deps.projectsRoot);
    // Check the literal destination first: even a dangling symlink counts as occupied.
    const destination = join(root, input.gameId);
    if (await statIfPresent(destination) || workspaceUsed(destination)) throw new GameConflictError();
    const target = assertInside(root, destination);
    const projectId = newId(), instanceId = newId();
    let owned: Stats | null = null;
    try {
      const definitionKey = deps.pack.manifest.leadWorkflow;
      if (!definitionKey) throw new Error("Default pack has no leadWorkflow");
      await mkdir(root, { recursive: true });
      try { await mkdir(target); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new GameConflictError(); throw error; }
      owned = await lstat(target);
      await copyStarter(deps.starterDir, target);
      const manifestPath = join(target, "game.json");
      const manifest: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
      if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("Invalid starter game.json");
      await writeFile(manifestPath, `${JSON.stringify({ ...manifest, id: input.gameId, name: input.name }, null, 2)}\n`);

      // runGit uses the Host process group runner and safe environment, with hooks and global config disabled.
      // The Factory identity is supplied per invocation, without changing the operator's git configuration.
      const git = (args: string[]) => runGit(target, args, { factoryIdentity: true, timeoutMs: 30_000 });
      await git(["init", "-b", "main", "--template="]);
      await git(["add", "-A"]);
      await git(["commit", "-m", `Start ${input.name} from the web game starter`]);

      const command = (type: string, payload: unknown, kind: string) => {
        const result = deps.pipeline.execute({ apiVersion: 1, projectId, commandId: newId(), type, payload });
        if (!result.body.ok) throw new Error(`${type} rejected: ${result.body.error.code}: ${result.body.error.message}`);
        const effect = result.body.receipt.effects.find((effect) => effect.kind === kind);
        if (!effect) throw new Error(`${type} returned no ${kind}`);
        return effect;
      };
      const projectEffect = command("projects.create", { name: input.name, workspace: { kind: "git", root: target } }, "project");
      const project = getProject(deps.raw, projectEffect.id);
      if (!project || project.id !== projectId) throw new Error("Created project unavailable");
      const workflowEffect = command("workflows.create", { instanceId, definitionKey, packKey: deps.pack.manifest.key,
        params: { mode: "create", request: input.request, touchRules: true, touchUi: true } }, "workflow-instance");
      const workflow = getWorkflowInstance(deps.raw, project.id, workflowEffect.id);
      if (!workflow || workflow.id !== instanceId) throw new Error("Created workflow unavailable");
      command("workflows.start", { instanceId: workflow.id, expectedRevision: workflow.revision }, "workflow-instance");
      return newGameResponseSchema.parse({ projectId: project.id, workflowInstanceId: workflow.id, gameId: input.gameId });
    } catch (error) {
      // Never remove a registered workspace, or a directory replaced since this request created it.
      if (owned && !getProject(deps.raw, projectId) && !workspaceUsed(target)) {
        const current = await statIfPresent(target);
        if (current && !current.isSymbolicLink() && current.dev === owned.dev && current.ino === owned.ino)
          await rm(assertInside(root, target), { recursive: true, force: true });
      }
      throw error;
    }
  }
  return { create };
}
export type GameService = ReturnType<typeof createGameService>;
