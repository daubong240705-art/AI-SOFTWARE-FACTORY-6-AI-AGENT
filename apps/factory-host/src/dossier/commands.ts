import type { HandlerMap } from "../commands/pipeline.js";
import { CommandError } from "../commands/errors.js";
import type { ContentStore } from "../artifacts/content-store.js";
import { afterRegister } from "../artifacts/service.js";
import { cleanArtifactSummary } from "../artifacts/summary.js";
import { collectLifecycleChanges, supersedeForRegistration } from "../knowledge/lifecycle.js";
import { buildDossier, dossierDigest, newestDossier, renderDossierMarkdown } from "./build.js";

export const storedDossierDigest = (markdown: string): string | null => /^<!-- digest:([0-9a-f]{64}) -->\r?\n/.exec(markdown)?.[1] ?? null;

export function createDossierHandlers(deps: { store: ContentStore;
  afterRegister?: (ref: { projectId: string; artifactId: string; version: number }) => void;
}): Pick<HandlerMap, "dossier.refresh"> {
  return { "dossier.refresh": (ctx, { projectId }) => {
    if (ctx.actorId !== "operator") throw new CommandError("forbidden", "Operator required.", "correct-input");
    if (!ctx.raw.prepare("SELECT 1 FROM projects WHERE id=?").get(projectId))
      throw new CommandError("not-found", "Project not found.", "correct-input");
    let dossier = buildDossier(ctx.raw,{ projectId, now: ctx.clock() });
    const previous = newestDossier(ctx.raw,projectId);
    if (previous && storedDossierDigest(deps.store.get(previous.contentHash)?.toString("utf8") ?? "") === dossierDigest(dossier))
      return { effects: [{ kind: "artifact-version", id: previous.artifactId, revision: previous.version }] };
    const artifactId = previous?.artifactId ?? ctx.newId(); const version = (previous?.version ?? 0) + 1;
    if (previous?.status === "approved") {
      // Preview the normal supersession effects in a rolled-back savepoint. The stored
      // snapshot describes those effects too, so registration cannot outdate itself.
      const rollback = new Error("Dossier preview complete");
      try {
        collectLifecycleChanges(ctx.raw, () => ctx.raw.transaction(() => {
          ctx.raw.prepare(`INSERT INTO artifact_versions (project_id,artifact_id,version,kind,title,media_type,content_hash,size_bytes,
            status,abstract_l0,produced_by_attempt_id,supersedes_version,visibility,created_at)
            VALUES (?,?,?,'dossier','Project Dossier','text/markdown',?,0,'draft','Project snapshot',NULL,?,'project',?)`)
            .run(projectId,artifactId,version,"0".repeat(64),previous.version,ctx.clock().toISOString());
          supersedeForRegistration(ctx.raw,{ projectId,artifactId,supersededVersion: previous.version,byVersion: version,now: ctx.clock().toISOString() });
          dossier = buildDossier(ctx.raw,{ projectId,now: ctx.clock() });
          throw rollback;
        })());
      } catch (error) { if (error !== rollback) throw error; }
    }
    const canonical = dossier.canonical.reduce((n,group) => n + group.items.length,0);
    const taskCount = Object.values(dossier.stage.tasks).reduce((n,count) => n + count,0);
    const l0 = `Project status: ${taskCount} tasks, ${canonical} canonical artifacts, ${dossier.decisions.length} decisions, ${dossier.openRequests.length} open requests, ${dossier.risks.length} stale risks.`;
    const l1 = cleanArtifactSummary(l0, `Stage: ${taskCount} tasks; ${dossier.stage.awaitingGo} awaiting Go; ${dossier.stage.pendingApprovals} pending approvals.\nKnowledge: ${canonical} canonical artifacts; ${dossier.decisions.length} decisions; ${dossier.openRequests.length} open requests; ${dossier.risks.length} stale risks.`);
    const content = deps.store.put(renderDossierMarkdown(dossier));
    const { effects } = collectLifecycleChanges(ctx.raw, () => {
      ctx.raw.prepare(`INSERT INTO artifact_versions (project_id,artifact_id,version,kind,title,media_type,content_hash,size_bytes,
        status,abstract_l0,abstract_l1,produced_by_attempt_id,supersedes_version,visibility,created_at)
        VALUES (?,?,?,'dossier','Project Dossier','text/markdown',?,?,'draft',?,?,NULL,?,'project',?)`)
        .run(projectId,artifactId,version,content.hash,content.size,l0,l1,previous?.version ?? null,ctx.clock().toISOString());
      if (previous) supersedeForRegistration(ctx.raw,{ projectId,artifactId,supersededVersion: previous.version,byVersion: version,now: ctx.clock().toISOString() });
      afterRegister(deps.afterRegister,projectId,artifactId,version);
    });
    const all = [{ kind: "artifact-version" as const, id: artifactId, revision: version },...effects];
    return { effects: all.slice(0,100), events: all.slice(100).map((entity) => ({ type: "entity.changed" as const, entity })) };
  } };
}
