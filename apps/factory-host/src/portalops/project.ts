import { lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Storage } from "../storage/database.js";
import type { EventHub } from "../events/hub.js";
import type { LoadedPack } from "../org/pack.js";
import { createCommandPipeline } from "../commands/pipeline.js";
import { createProjectsCreateHandler } from "../projects/service.js";
import { conversationsCreateHandler } from "../chat/service.js";
import { findLeadSeat, getPrimaryEngagement } from "../org/service.js";
import { createIdGenerator, type Clock } from "../ids.js";
import { runGit } from "../workspace/git.js";
import { assertInside, canonicalPath } from "../workspace/paths.js";

export function portalProjectId(raw: Storage["raw"]): string | null {
  return (raw.prepare("SELECT project_id FROM portal_settings WHERE singleton=1").get() as { project_id: string } | undefined)?.project_id ?? null;
}

export async function ensurePortalProject(deps: { storage: Storage; hub: EventHub; pack: LoadedPack; projectsRoot: string; clock: Clock }): Promise<string> {
  const { storage, hub, clock } = deps, raw = storage.raw;
  const existing = portalProjectId(raw);
  if (existing) return existing;
  mkdirSync(deps.projectsRoot, { recursive: true });
  const root = canonicalPath(deps.projectsRoot), target = assertInside(root, join(root, "_portal"));
  // Never adopt, overwrite, or delete a directory created by somebody else.
  try { lstatSync(target); throw new Error("Portal workspace already exists without its project marker."); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  mkdirSync(target);
  mkdirSync(join(target, "reports"));
  writeFileSync(join(target, "README.md"), "# Lazy Gaming Portal\n\nBáo cáo và đề xuất vận hành Portal. Mọi thay đổi cần người vận hành phê duyệt.\n", { flag: "wx" });
  writeFileSync(join(target, "reports/.gitkeep"), "", { flag: "wx" });
  const git = (args: string[]) => runGit(target, args, { factoryIdentity: true, timeoutMs: 30_000 });
  await git(["init", "-b", "main", "--template="]);
  await git(["add", "-A"]);
  await git(["commit", "-m", "Initialize Portal reports"]);
  const newId = createIdGenerator(clock), projectId = newId();
  const create = createProjectsCreateHandler({ pack: deps.pack });
  const pipeline = createCommandPipeline({ storage, hub, clock, handlers: {
    "projects.create": (ctx, command) => {
      const result = create(ctx, command);
      raw.prepare("INSERT INTO portal_settings(singleton,project_id) VALUES (1,?)").run(command.projectId);
      return result;
    },
    "conversations.create": conversationsCreateHandler,
  } });
  const execute = (type: string, payload: unknown) => {
    const result = pipeline.execute({ apiVersion: 1, projectId, commandId: newId(), type, payload });
    if (!result.body.ok) throw new Error("Portal project initialization failed.");
  };
  hub.transaction(() => {
  execute("projects.create", { name: "Lazy Gaming Portal", workspace: { kind: "git", root: target } });
  const engagement = getPrimaryEngagement(raw, projectId), lead = engagement && findLeadSeat(raw, engagement.teamId);
  if (!lead) throw new Error("Portal Lead unavailable.");
  execute("conversations.create", { conversationId: newId(), agentId: lead.id, title: "Quản trị Portal", workItemId: null });
  });
  return projectId;
}
