import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import type { Settings, ToolStatus } from "../../shared/contracts";
import { readinessResult } from "../../shared/readiness";
import { canonicalDirectory, checkTools, projectStatus } from "./projects";

// No monitor timer or provider call. Share probes across projects and concurrent IPCs.
export class ReadinessProbe {
  private cache?: { path: string; at: number; value: ToolStatus[] };
  private pending = new Map<string, Promise<ToolStatus[]>>();
  private tools(path: string, force: boolean) {
    const pending = this.pending.get(path);
    if (pending) return pending;
    if (
      !force &&
      this.cache?.path === path &&
      Date.now() - this.cache.at < 30000
    )
      return Promise.resolve(this.cache.value);
    const task = checkTools(path)
      .then((value) => {
        this.cache = { path, at: Date.now(), value };
        return value;
      })
      .finally(() => this.pending.delete(path));
    this.pending.set(path, task);
    return task;
  }
  async check(input: {
    projectId: string;
    path: string;
    settings: Settings;
    credential: "available" | "unreadable" | "none";
    busy: boolean;
    force: boolean;
  }) {
    const [tools, folder, ca] = await Promise.all([
      this.tools(input.settings.runtimePath, input.force),
      canonicalDirectory(input.path).then(
        () => true,
        () => false,
      ),
      input.settings.caPath
        ? Promise.all([
            access(input.settings.caPath, constants.R_OK),
            stat(input.settings.caPath),
          ]).then(
            ([, file]) => file.isFile(),
            () => false,
          )
        : Promise.resolve(true),
    ]);
    const git = folder
      ? await projectStatus(input.path).catch(() => null)
      : null;
    return readinessResult({ ...input, tools, folder, ca, git });
  }
}
