import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import { artifactKindSchema } from "@factory/contracts";
import { z } from "zod";
import type { ContentStore } from "./content-store.js";
import { afterRegister } from "./service.js";
import { withinDocumentQuota, type DocumentConfig } from "./limits.js";
import { collectLifecycleChanges, supersedeForRegistration } from "../knowledge/lifecycle.js";
import { sanitizeAgentText } from "../mcp/security.js";
import type { EventHub } from "../events/hub.js";

export const uploadQuerySchema = z.strictObject({
  filename: z.string().min(1).max(200).refine((value) => !/[\\/\p{Cc}]/u.test(value)),
  mediaType: z.string().optional(), kind: artifactKindSchema.default("other"),
  title: z.string().max(200).optional(), artifactId: z.uuid().optional(),
});
export class DocumentError extends Error {
  constructor(readonly reason: "quota" | "artifact") { super(reason); }
}
export interface UploadDeps {
  raw: Database; store: ContentStore; hub: EventHub; config: DocumentConfig; now: () => Date;
  afterRegister: (ref: { projectId: string; artifactId: string; version: number }) => void;
}

/** Metadata, lifecycle changes, indexing and events commit together, as on the agent path. */
export function registerUpload(deps: UploadDeps, projectId: string, query: z.infer<typeof uploadQuerySchema>, mediaType: string, bytes: Buffer) {
  const { raw } = deps;
  return deps.hub.transaction(() => {
    const { result, effects } = collectLifecycleChanges(raw, () => raw.transaction(() => {
      const previous = query.artifactId === undefined ? undefined : raw.prepare(`SELECT version,kind,origin FROM artifact_versions
        WHERE project_id=? AND artifact_id=? ORDER BY version DESC LIMIT 1`).get(projectId, query.artifactId) as
        { version: number; kind: string; origin: string } | undefined;
      if (query.artifactId && (!previous || previous.origin !== "upload" || previous.kind !== query.kind)) throw new DocumentError("artifact");
      if (!withinDocumentQuota(raw, projectId, bytes.length, deps.config.quotaBytes)) throw new DocumentError("quota");
      const artifactId = query.artifactId ?? randomUUID(); const version = (previous?.version ?? 0) + 1;
      const fileName = sanitizeAgentText(query.filename).replace(/[\\/\p{Cc}\p{Cf}]/gu, "_").slice(0, 200) || "document";
      const title = sanitizeAgentText(query.title ?? fileName.replace(/\.[^.]+$/, "")).trim().slice(0, 200) || fileName;
      const abstract = sanitizeAgentText(`Uploaded file: ${fileName} (${bytes.length} bytes)`).slice(0, 400);
      const content = deps.store.put(bytes); const now = deps.now().toISOString();
      raw.prepare(`INSERT INTO artifact_versions (project_id,artifact_id,version,kind,title,media_type,content_hash,size_bytes,status,
        abstract_l0,abstract_l1,produced_by_attempt_id,supersedes_version,visibility,created_at,origin,file_name)
        VALUES (?,?,?,?,?,?,?,?,'draft',?,NULL,NULL,?,'project',?,'upload',?)`)
        .run(projectId, artifactId, version, query.kind, title, mediaType, content.hash, content.size, abstract, previous?.version ?? null, now, fileName);
      if (previous) supersedeForRegistration(raw, { projectId, artifactId, supersededVersion: previous.version, byVersion: version, now });
      afterRegister(deps.afterRegister, projectId, artifactId, version);
      return { artifactId, version };
    }).immediate());
    for (const entity of [...effects, { kind: "artifact-version" as const, id: result.artifactId, revision: result.version }])
      deps.hub.append({ projectId, causationId: result.artifactId, rootCausationId: result.artifactId, payload: { type: "entity.changed", entity } });
    return result;
  });
}
