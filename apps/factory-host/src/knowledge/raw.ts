import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import type { ApiGuards } from "../api/server.js";
import { failure } from "../api/http.js";
import { createIdGenerator } from "../ids.js";
import type { ContentStore } from "../artifacts/content-store.js";
import { extensionFor, isAllowedMediaType, previewable } from "../artifacts/media.js";
import { sanitizeAgentText } from "../mcp/security.js";
import { visibleToScope } from "./permissions.js";

export function contentDisposition(type: string, name: string, download: boolean): string {
  const fileName = sanitizeAgentText(name.split(/[\\/]/).at(-1) ?? "document")
    .replace(/[\p{Cc}\p{Cf}]/gu, "_").slice(0, 200).replace(/[\uD800-\uDFFF]/gu, "_") || "document";
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${previewable(type) && !download ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function registerRawRoute(app: FastifyInstance, guards: ApiGuards, deps: { raw: Database; store?: ContentStore }): void {
  const newId = createIdGenerator();
  app.get<{ Params: { projectId: string; artifactId: string; version: string }; Querystring: { download?: string } }>(
    "/projects/:projectId/knowledge/artifacts/:artifactId/versions/:version/raw", { preHandler: guards.session }, async (request, reply) => {
      const { projectId, artifactId } = request.params; const version = Number(request.params.version);
      const notFound = () => failure(reply, 404, "not-found", "Artifact content not found.", "correct-input", newId);
      if (!deps.raw.prepare("SELECT 1 FROM projects WHERE id=?").get(projectId) || !Number.isSafeInteger(version) || version < 1) return notFound();
      const permission = visibleToScope({ projectId, teamId: null, viewer: "operator" });
      const row = deps.raw.prepare(`SELECT v.media_type AS mediaType,v.content_hash AS hash,v.size_bytes AS size,v.file_name AS fileName
        FROM artifact_versions v WHERE v.project_id=? AND v.artifact_id=? AND v.version=? AND ${permission.sql}`)
        .get(projectId, artifactId, version, ...permission.params) as { mediaType: string; hash: string; size: number; fileName: string | null } | undefined;
      if (!row) return notFound();
      if (!isAllowedMediaType(row.mediaType)) return failure(reply, 415, "validation", "Document media type is not allowed.", "correct-input", newId);
      let bytes: Buffer | null;
      try { bytes = deps.store?.get(row.hash) ?? null; } catch { return notFound(); }
      if (bytes === null || bytes.length !== row.size) return notFound();
      reply.header("Content-Type", row.mediaType).header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "sandbox; default-src 'none'").header("Cache-Control", "private, no-store")
        .header("Content-Disposition", contentDisposition(row.mediaType, row.fileName ?? `document.${extensionFor(row.mediaType) ?? "bin"}`, request.query.download === "1"));
      return reply.send(bytes);
    });
}
