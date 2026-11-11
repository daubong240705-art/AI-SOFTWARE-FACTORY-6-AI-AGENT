import { CommandError } from "../commands/errors.js";
import type { HandlerContext, HandlerMap, HandlerResult } from "../commands/pipeline.js";
import type { NotificationView } from "@factory/contracts";

export const NOTIFICATION_COMMANDS = ["notifications.mark-read", "notifications.dismiss"] as const;
function change(ctx: HandlerContext, projectId: string, id: string, state: "read" | "dismissed"): HandlerResult {
  const row = ctx.raw.prepare("SELECT state FROM notifications WHERE project_id=? AND id=?").get(projectId, id) as
    { state: NotificationView["state"] } | undefined;
  if (!row) throw new CommandError("not-found", "notification not found", "correct-input");
  if (row.state === state || row.state === "dismissed") return { effects: [] };
  ctx.raw.prepare("UPDATE notifications SET state=?,read_at=COALESCE(read_at,?) WHERE project_id=? AND id=?")
    .run(state, ctx.clock().toISOString(), projectId, id);
  return { effects: [{ kind: "notification", id, revision: state === "read" ? 2 : 3 }] };
}
export function createNotificationHandlers(): Partial<HandlerMap> {
  return {
    "notifications.mark-read": (ctx, { projectId, payload }) => change(ctx, projectId, payload.notificationId, "read"),
    "notifications.dismiss": (ctx, { projectId, payload }) => change(ctx, projectId, payload.notificationId, "dismissed"),
  };
}
