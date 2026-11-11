import { API_VERSION } from "@factory/contracts";
import type { FastifyInstance } from "fastify";
import type { ApiGuards } from "../api/server.js";
import { failure } from "../api/http.js";
import { createIdGenerator } from "../ids.js";
import { getKnowledgeArtifact } from "../knowledge/index.js";
import { publicMetadata } from "../knowledge/routes.js";
import { isAllowedMediaType, mediaTypeFromFileName, sniffMedia } from "./media.js";
import { DocumentError, registerUpload, uploadQuerySchema, type UploadDeps } from "./uploads.js";

export function registerDocumentRoutes(app: FastifyInstance, guards: ApiGuards, deps: UploadDeps): void {
  const newId = createIdGenerator();
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  app.post<{ Params: { projectId: string }; Querystring: Record<string, unknown> }>(
    "/projects/:projectId/documents", { onRequest: guards.write, bodyLimit: deps.config.maxBytes }, async (request, reply) => {
      const { projectId } = request.params;
      if (!deps.raw.prepare("SELECT 1 FROM projects WHERE id=?").get(projectId))
        return failure(reply, 404, "not-found", "Project not found.", "correct-input", newId);
      const query = uploadQuerySchema.safeParse(request.query);
      if (!query.success || !Buffer.isBuffer(request.body))
        return failure(reply, 400, "validation", "Invalid document metadata or body.", "correct-input", newId);
      const mediaType = query.data.mediaType ?? mediaTypeFromFileName(query.data.filename);
      if (mediaType === null || !isAllowedMediaType(mediaType) || !sniffMedia(mediaType, request.body))
        return failure(reply, 415, "validation", "Document media type is not allowed or does not match.", "correct-input", newId);
      try {
        const ref = registerUpload(deps, projectId, query.data, mediaType, request.body);
        const artifact = getKnowledgeArtifact(deps.raw, { projectId, teamId: null, viewer: "operator" }, ref.artifactId)?.versions[0];
        return reply.code(201).send({ apiVersion: API_VERSION, ok: true, artifact: publicMetadata(artifact) });
      } catch (error) {
        // The existing failure family supports 409 conflict for quota exhaustion; cleanup is required before retrying.
        if (error instanceof DocumentError) return failure(reply, 409, "conflict",
          error.reason === "quota" ? "Document quota exceeded." : "Document version is not allowed.", "correct-input", newId);
        return failure(reply, 500, "internal", "Document could not be stored.", "contact-host", newId);
      }
    });
}
