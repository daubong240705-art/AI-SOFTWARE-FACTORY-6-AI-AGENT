import type { LeadBrief } from "@factory/contracts";
import { DocumentError, registerUpload, type UploadDeps } from "../artifacts/uploads.js";
import type { LeadTurn } from "../chat/service.js";
import { redactLeadText } from "./history.js";

export const decisionText = (value: string): string => value.trim().replace(/\s+/gu, " ").toLowerCase();
const safeText = (value: string) => redactLeadText(value).replace(/[\p{Cc}\p{Cf}]+/gu, " ").trim();
export const markdownText = (value: string): string => safeText(value)
  .replace(/[&<>\\`*_{}\[\]()!~#|]/g, "\\$&");

export function writeLeadBrief(deps: UploadDeps, turn: LeadTurn, brief: LeadBrief) {
  const title = safeText(brief.title) || "Bản chốt";
  const topic = decisionText(title);
  const decisionLines = brief.decisions.map(({ decision, reason }) => `${markdownText(decision)} — ${markdownText(reason)}`);
  const section = (heading: string, items: string[]) => `## ${heading}\n\n${items.length ? items.map((item) => `- ${item}`).join("\n") : "- Không có."}`;
  const markdown = [`# ${markdownText(title)}`, section("Mục tiêu", brief.goals.map(markdownText)),
    section("Phạm vi", brief.scope.map(markdownText)), section("Ngoài phạm vi", brief.outOfScope.map(markdownText)),
    section("Quyết định và lý do", decisionLines), section("Tiêu chí nghiệm thu", brief.acceptance.map(markdownText)),
    section("Câu hỏi còn mở", brief.openQuestions.map(markdownText))].join("\n\n") + "\n";
  const previous = deps.raw.prepare("SELECT artifact_id FROM lead_briefs WHERE project_id=? AND conversation_id=? AND topic=?")
    .get(turn.projectId, turn.conversationId, topic) as { artifact_id: string } | undefined;
  if (Buffer.byteLength(markdown) > deps.config.maxBytes) throw new DocumentError("quota");
  const saved = registerUpload(deps, turn.projectId, { filename: "ban-chot.md", kind: "plan", title,
    ...(previous ? { artifactId: previous.artifact_id } : {}) }, "text/markdown", Buffer.from(markdown));
  deps.raw.prepare("INSERT OR IGNORE INTO lead_briefs (project_id, conversation_id, topic, artifact_id) VALUES (?,?,?,?)")
    .run(turn.projectId, turn.conversationId, topic, saved.artifactId);
  return { ...saved, title, markdown, decisionLines };
}
