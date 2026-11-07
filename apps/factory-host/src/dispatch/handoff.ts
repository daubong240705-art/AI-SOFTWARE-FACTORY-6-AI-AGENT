import type { Database } from "better-sqlite3";
import { TERMINAL_ATTEMPT_STATES } from "@factory/contracts";
import { publicApprovalText } from "../approvals/service.js";
import { sanitizeAgentText } from "../mcp/security.js";
import { listAttempts } from "./attempts.js";

const closing = "Do not repeat work that is already done; check the workspace first.";

export function buildHandoff(raw: Database, projectId: string, taskId: string): string | null {
  // A queued/current attempt, if already created, is not part of its own handoff.
  const attempts = listAttempts(raw, projectId, taskId).filter((attempt) => TERMINAL_ATTEMPT_STATES.has(attempt.state));
  if (attempts.length === 0) return null;
  const leases = attempts.map((attempt) => attempt.leaseId).filter((id): id is string => id !== null);
  const plain = (value: string): string => {
    let text = sanitizeAgentText(value);
    for (const lease of leases) text = text.split(lease).join("[redacted]");
    return text.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[redacted]")
      .replace(/\{[^}]*\}|\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  };
  const lines = ["Earlier attempts:"];
  for (const attempt of attempts) {
    const seat = raw.prepare("SELECT name FROM seats WHERE id = ?").get(attempt.seatId) as { name: string } | undefined;
    lines.push(`Epoch ${attempt.epoch}: ${attempt.state}; seat ${plain(seat?.name ?? "unassigned")}.`);
  }
  const latest = attempts[attempts.length - 1];
  if (latest) {
    const rows = raw.prepare(`SELECT body_json FROM attempt_events WHERE project_id = ? AND attempt_id = ?
      AND kind IN (?, ?, ?) ORDER BY seq DESC LIMIT ?`).all(projectId, latest.id, "progress", "evidence", "output", 10) as { body_json: string }[];
    if (rows.length > 0) lines.push("Recent work:");
    for (const row of rows.reverse()) {
      const body: unknown = JSON.parse(row.body_json);
      if (typeof body !== "object" || body === null) continue;
      const record = body as Record<string, unknown>;
      const text = [record.message, record.summary, record.text, record.detail].find((value): value is string => typeof value === "string");
      if (text !== undefined) lines.push(plain(text).slice(0, 300));
    }
  }
  const approval = raw.prepare(`SELECT a.state, c.comment FROM approvals a LEFT JOIN approval_comments c
    ON c.project_id = a.project_id AND c.approval_id = a.id WHERE a.project_id = ? AND a.task_id = ? AND a.kind = 'review'
    ORDER BY a.requested_at DESC, a.rowid DESC LIMIT 1`).get(projectId, taskId) as { state: string; comment: string | null } | undefined;
  const feedback = approval?.state === "changes-requested"
    ? `\nReviewer feedback:\n${plain(publicApprovalText(approval.comment ?? "")).slice(0, 1000)}` : "";
  const decision = raw.prepare(`SELECT a.subject, a.options_json, a.outcome_option_id, a.decided_at, c.comment
    FROM approvals a LEFT JOIN approval_comments c ON c.project_id = a.project_id AND c.approval_id = a.id
    WHERE a.project_id = ? AND a.task_id = ? AND a.kind = 'question' AND a.state = 'applied'
    ORDER BY a.decided_at DESC, a.rowid DESC LIMIT 1`).get(projectId, taskId) as {
      subject: string; options_json: string; outcome_option_id: string; decided_at: string; comment: string | null;
    } | undefined;
  const answer = decision && latest?.startedAt && Date.parse(decision.decided_at) > Date.parse(latest.startedAt)
    ? (JSON.parse(decision.options_json) as { id: string; label: string }[]).find((option) => option.id === decision.outcome_option_id) : undefined;
  const decisionText = answer && decision ? `\nDecision from the operator:\nQuestion: ${plain(decision.subject).slice(0, 160)}\nAnswer: ${plain(answer.label).slice(0, 160)}\n${plain(decision.comment ?? "").slice(0, 1000)}` : "";
  return `${lines.join("\n").slice(0, 4000 - closing.length - feedback.length - decisionText.length - 1)}${feedback}${decisionText}\n${closing}`;
}
