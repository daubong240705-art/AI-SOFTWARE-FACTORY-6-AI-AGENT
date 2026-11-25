import type { Database } from "better-sqlite3";
import { projectSchema, type LeadChatMode } from "@factory/contracts";
import type { FastifyInstance } from "fastify";
import type { HandlerMap } from "../commands/pipeline.js";
import { CommandError } from "../commands/errors.js";

const setting = (raw: Database, projectId: string) => raw.prepare("SELECT lead_chat_mode, revision FROM projects WHERE id=?")
  .get(projectId) as { lead_chat_mode: LeadChatMode; revision: number } | undefined;

export const leadChatMode = (raw: Database, projectId: string): LeadChatMode => setting(raw, projectId)?.lead_chat_mode ?? "auto";

export const setLeadChatMode: HandlerMap["projects.set-lead-chat-mode"] = ({ raw, actorIsOperator }, { projectId, payload }) => {
  if (!actorIsOperator) throw new CommandError("forbidden", "Chỉ người điều hành được thay đổi cách làm việc với Lead.", "correct-input");
  const current = setting(raw, projectId);
  if (!current) throw new CommandError("not-found", "Không tìm thấy dự án.", "refresh");
  if (current.revision !== payload.expectedRevision)
    throw new CommandError("conflict", "Cài đặt dự án đã thay đổi.", "refresh", { currentRevision: current.revision });
  const revision = current.revision + 1;
  raw.prepare("UPDATE projects SET lead_chat_mode=?, revision=? WHERE id=?").run(payload.leadChatMode, revision, projectId);
  return { effects: [{ kind: "project", id: projectId, revision }] };
};

export function exposeLeadChatMode(app: FastifyInstance, raw: Database): void {
  app.addHook("preSerialization", async (request, _reply, payload) => {
    if (request.method !== "GET" || !payload || typeof payload !== "object" || !("ok" in payload) || !payload.ok) return payload;
    const withMode = (value: unknown) => {
      const project = projectSchema.parse(value);
      return { ...project, leadChatMode: leadChatMode(raw, project.id) };
    };
    if (request.routeOptions.url === "/projects" && "projects" in payload && Array.isArray(payload.projects))
      return { ...payload, projects: payload.projects.map(withMode) };
    if (request.routeOptions.url === "/projects/:projectId" && "project" in payload) return { ...payload, project: withMode(payload.project) };
    return payload;
  });
}
