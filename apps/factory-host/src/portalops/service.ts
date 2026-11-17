import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Database } from "better-sqlite3";
import { portalActionSchema, portalActionRequestSchema, portalJoinedGamesResponseSchema, type PortalAction, type PortalActionRequest, type PortalBlock, type PortalStats } from "@factory/contracts";
import type { HandlerMap, createCommandPipeline } from "../commands/pipeline.js";
import { CommandError } from "../commands/errors.js";
import type { EventHub } from "../events/hub.js";
import { createIdGenerator, type Clock } from "../ids.js";
import { appendMessage, listConversations } from "../chat/service.js";
import { PortalRequestError, ReleaseError, type PublishService } from "../publish/service.js";
import { portalProjectId } from "./project.js";
import { publicApprovalText } from "../approvals/service.js";
import { registerUpload } from "../artifacts/uploads.js";
import type { ContentStore } from "../artifacts/content-store.js";
import type { DocumentConfig } from "../artifacts/limits.js";
import { assertInside, checkedDirectory } from "../workspace/paths.js";

type ActionRow = { project_id: string; id: string; approval_id: string; action: PortalAction["action"]; game_id: string; target_project_id: string | null; version: number | null; reason: string; state: PortalAction["state"]; result_json: string | null; error: string | null; created_at: string; decided_at: string | null; completed_at: string | null };
const cleanText = (value: string) => publicApprovalText(value).replace(/[|\r\n]+/g, " ").trim();
const view = (r: ActionRow): PortalAction => portalActionSchema.parse({ projectId: r.project_id, id: r.id, approvalId: r.approval_id, action: r.action, gameId: r.game_id, targetProjectId: r.target_project_id, version: r.version, reason: r.reason, state: r.state, resultJson: r.result_json ? JSON.parse(r.result_json) as unknown : null, error: r.error, createdAt: r.created_at, decidedAt: r.decided_at, completedAt: r.completed_at });
const statsTable = (stats: PortalStats): string => [
  `Thống kê ${stats.from} → ${stats.to} (UTC${stats.utcOffsetMinutes >= 0 ? "+" : ""}${stats.utcOffsetMinutes / 60})`,
  "Game | Bật | Bản | Trận | Người chơi | Thắng bot | Hòa | Thời lượng TB",
  ...stats.games.map(g => `${cleanText(g.name)} (${g.id}) | ${g.enabled ? "Có" : "Không"} | ${g.currentVersion ?? "—"} | ${g.matches} | ${g.players.registered + g.players.guests} | ${g.botWins} | ${g.draws} | ${g.avgDurationSec === null ? "—" : `${g.avgDurationSec}s`}`),
  `Phòng trực tiếp: ${stats.live.rooms}; đang chơi: ${stats.live.playingRooms}; chờ: ${stats.live.waitingRooms}; online: ${stats.live.onlineUsers}`,
].join("\n");

function refuse(text: string): never { throw new CommandError("conflict", text, "correct-input"); }

export function createPortalOpsService(deps: { raw: Database; hub: EventHub; clock: Clock; publish: PublishService; configured: boolean;
  documents: { store: ContentStore; config: DocumentConfig; afterRegister: (ref: { projectId: string; artifactId: string; version: number }) => void };
}) {
  const { raw, hub, clock, publish } = deps, newId = createIdGenerator(clock);
  let pipeline: ReturnType<typeof createCommandPipeline> | undefined;
  const operations = new Map<string, { projectId: string; run: () => void }>();
  const inflight = new Map<string, Promise<void>>();
  const attempted = new Set<string>();
  let unsubscribe: (() => void) | undefined, stopped = false;
  const id = () => portalProjectId(raw);
  const actionRow = (actionId: string) => raw.prepare("SELECT * FROM portal_actions WHERE project_id=? AND id=?").get(id(), actionId) as ActionRow | undefined;
  const apply = (run: () => void): void => {
    const projectId = id();
    if (!projectId || !pipeline) refuse("Portal chưa được cấu hình.");
    const operationId = newId(); operations.set(operationId, { projectId, run });
    try {
      const result = pipeline.execute({ apiVersion: 1, projectId, commandId: newId(), type: "portal-ops.apply", payload: { operationId } }, "portal-ops");
      if (!result.body.ok) throw new CommandError(result.body.error.code, result.body.error.message, "correct-input");
    } finally { operations.delete(operationId); }
  };
  const handler: HandlerMap["portal-ops.apply"] = (ctx, command) => {
    const operation = operations.get(command.payload.operationId);
    if (ctx.actorId !== "portal-ops" || !operation || operation.projectId !== command.projectId)
      throw new CommandError("forbidden", "Internal Portal operation unavailable.", "correct-input");
    operation.run();
    return { effects: [] };
  };
  const messageInside = (text: string, conversationId?: string) => {
    const projectId = id(); if (!projectId) return;
    const conversation = conversationId ?? listConversations(raw, projectId)[0]?.id;
    if (!conversation) return;
    const { message } = appendMessage(raw, { projectId, conversationId: conversation, id: newId(), speaker: "system", agentId: null, text: text.slice(0, 60000), createdAt: clock().toISOString() });
    hub.append({ projectId, causationId: message.id, payload: { type: "message.appended", message } });
  };
  const message = (text: string, conversationId?: string) => apply(() => messageInside(text, conversationId));
  const projects = () => raw.prepare(`SELECT DISTINCT p.id, p.workspace_root FROM projects p
    JOIN engagements e ON e.project_id=p.id JOIN teams t ON t.id=e.team_id
    JOIN pack_snapshots s ON s.digest=t.pack_digest
    WHERE json_extract(s.manifest_json,'$.key')='web-games' AND p.disposition != 'archived'`).all() as { id: string; workspace_root: string }[];
  const targetFor = (game: string) => {
    const matches = projects().filter(p => basename(p.workspace_root) === game);
    if (matches.length > 1) refuse("Có nhiều dự án Factory cùng mã game.");
    return matches[0]?.id ?? null;
  };
  const games = async () => {
    const [list, stats] = await Promise.all([publish.listGames(), publish.stats()]);
    return portalJoinedGamesResponseSchema.parse({ games: list.games.map(game => ({ ...game, projectId: targetFor(game.id), last7Days: stats.games.find(g => g.id === game.id)?.matches ?? 0 })) });
  };
  const settle = (actionId: string, state: PortalAction["state"], result: unknown = null, error: string | null = null) => {
    apply(() => {
      const row = actionRow(actionId); if (!row || !["running", "unknown"].includes(row.state)) return;
      raw.prepare("UPDATE portal_actions SET state=?,result_json=?,error=?,completed_at=? WHERE id=?")
        .run(state, result === null ? null : JSON.stringify(result), error, ["done", "failed"].includes(state) ? clock().toISOString() : null, actionId);
      const version = result && typeof result === "object" && "version" in result ? result.version : row.version;
      messageInside(state === "done" ? `Đã ${row.action === "disable" ? "tắt" : row.action === "enable" ? "bật" : row.action === "publish" ? "publish" : "đổi bản"} ${row.game_id}${version ? ` v${String(version)}` : ""}.`
        : state === "unknown" ? `Chưa xác nhận ${row.game_id}. Cần Kiểm tra lại; không tự gửi lại.` : `Không làm được: ${row.game_id}. ${error ?? "Portal từ chối yêu cầu."}`);
    });
  };
  const execute = async (row: ActionRow): Promise<void> => {
    let releaseStarted = false;
    try {
      if (row.action === "enable" || row.action === "disable") {
        const result = await publish.setEnabled(row.game_id, row.action === "enable");
        if (result.enabled !== (row.action === "enable")) { settle(row.id, "unknown"); return; }
        settle(row.id, "done", result);
      } else if (row.target_project_id) {
        if (row.action === "publish") {
          const approved = row.result_json ? JSON.parse(row.result_json) as { commitSha?: string } : {};
          if ((await publish.checkPublish(row.target_project_id)).sha !== approved.commitSha) {
            settle(row.id, "failed", null, "Commit đã đổi sau khi đề xuất; hãy tạo đề xuất mới."); return;
          }
        }
        const release = row.action === "publish" ? await publish.publish(row.target_project_id, row.result_json ? (JSON.parse(row.result_json) as { commitSha?: string }).commitSha : undefined) : await publish.rollback(row.target_project_id, row.version!);
        releaseStarted = true;
        apply(() => raw.prepare("UPDATE portal_actions SET result_json=? WHERE id=?").run(JSON.stringify({ ...(row.result_json ? JSON.parse(row.result_json) as object : {}), releaseId: release.id }), row.id));
        await publish.idle();
        const current = (await publish.list(row.target_project_id)).releases.find(r => r.id === release.id);
        settle(row.id, current?.state === "done" ? "done" : current?.state === "failed" ? "failed" : "unknown", { releaseId: release.id, version: current?.version ?? null }, current?.state === "failed" ? "Phát hành thất bại." : null);
      } else {
        const result = await publish.setVersion(row.game_id, row.version!);
        settle(row.id, "done", { ...result, version: row.version });
      }
    } catch (error) {
      settle(row.id, (releaseStarted || (error instanceof PortalRequestError && error.uncertain)) ? "unknown" : "failed", null, error instanceof PortalRequestError || error instanceof ReleaseError ? error.message : "Không thực hiện được thao tác Portal.");
    }
  };
  const kick = () => {
    if (stopped) return;
    for (const row of raw.prepare("SELECT * FROM portal_actions WHERE state='running'").all() as ActionRow[]) {
      if (attempted.has(row.id)) continue;
      attempted.add(row.id); // A bookkeeping failure must never replay a write in this process.
      // Defer until after the approval transaction and reserve the id before any await.
      const task = Promise.resolve().then(() => execute(row)).catch(() => undefined).finally(() => inflight.delete(row.id));
      inflight.set(row.id, task);
    }
  };
  const propose = async (input: PortalActionRequest, conversationId?: string): Promise<PortalAction> => {
    const request = portalActionRequestSchema.parse(input);
    if (!deps.configured || !id()) refuse("Portal chưa được cấu hình.");
    const target = targetFor(request.game);
    const [list, stats] = await Promise.all([publish.listGames(), publish.stats()]);
    const game = list.games.find(g => g.id === request.game);
    let sha: string | null = null;
    if (request.action === "publish") {
      if (!target) refuse("Không có dự án Factory cho game này.");
      try { sha = (await publish.checkPublish(target)).sha; }
      catch (error) { refuse(error instanceof ReleaseError ? error.message : "Không kiểm tra được điều kiện publish."); }
    } else if (!game) refuse("Không tìm thấy game trên Portal.");
    if (request.action === "set-version" && !game?.versions.some(v => v.version === request.version)) refuse("Phiên bản không tồn tại.");
    const reason = publicApprovalText(request.reason || "Theo yêu cầu người vận hành.").slice(0, 1000);
    const subject = request.action === "publish" ? `Publish ${request.game} (bản mới từ commit ${sha?.slice(0, 7)})?` : request.action === "set-version" ? `Đổi ${request.game} sang bản v${request.version}?` : `${request.action === "disable" ? "Tắt" : "Bật"} game ${request.game}?`;
    const summary = `${reason}\nHiện tại: bật ${game?.enabled ? "Có" : "Không"}; bản ${game?.currentVersion ?? "—"}; trận 7 ngày: ${stats.games.find(g => g.id === request.game)?.matches ?? 0}.`;
    const actionId = newId(), approvalId = newId(), now = clock().toISOString();
    apply(() => {
      // Expired approvals are closed before allowing another proposal; unknown writes stay open.
      raw.prepare(`UPDATE portal_actions SET state='rejected',completed_at=? WHERE state='proposed' AND approval_id IN
        (SELECT id FROM approvals WHERE expires_at<=? OR state IN ('expired','withdrawn','superseded'))`).run(now, now);
      if (raw.prepare("SELECT 1 FROM portal_actions WHERE game_id=? AND action=? AND state IN ('proposed','running','unknown')").get(request.game, request.action))
        throw new CommandError("conflict", "Đã có đề xuất đang mở cho game và thao tác này.", "correct-input");
      const options = [{ id: "approve", label: "Làm", consequence: "Thực hiện thay đổi trên Portal." }, { id: "reject", label: "Không", consequence: "Giữ nguyên Portal." }];
      const digest = createHash("sha256").update(JSON.stringify({ subject, summary, options })).digest("hex");
      raw.prepare(`INSERT INTO approvals(project_id,id,revision,kind,task_id,subject,summary,options_json,recommendation,impact_if_waiting,context_digest,approver,requested_at,expires_at,state)
        VALUES(?,?,1,'question',NULL,?,?,?,NULL,?,?,'operator',?,?,'pending')`).run(id(), approvalId, subject, summary, JSON.stringify(options), "Chưa thay đổi Portal khi chưa duyệt.", digest, now, new Date(clock().getTime() + 7 * 86400000).toISOString());
      raw.prepare(`INSERT INTO portal_actions(project_id,id,approval_id,action,game_id,target_project_id,version,reason,state,result_json,error,created_at)
        VALUES(?,?,?,?,?,?,?,?,'proposed',?,NULL,?)`).run(id(), actionId, approvalId, request.action, request.game, target, request.action === "set-version" ? request.version : null, reason, sha ? JSON.stringify({ commitSha: sha, baseVersion: Math.max(0, ...(game?.versions.map(v => v.version) ?? [])) }) : null, now);
      hub.append({ projectId: id()!, causationId: actionId, payload: { type: "entity.changed", entity: { kind: "approval", id: approvalId, revision: 1 } } });
      messageInside(`Đề xuất: ${subject}\n${summary}\nMở Cần chú ý (Need attention) để chọn Làm / Không.`, conversationId);
    });
    return view(actionRow(actionId)!);
  };
  const report = (stats: PortalStats, slug: string): string => {
    const projectId = id()!;
    const root = checkedDirectory((raw.prepare("SELECT workspace_root FROM projects WHERE id=?").get(projectId) as { workspace_root: string }).workspace_root);
    const reports = assertInside(root, join(root, "reports")); mkdirSync(reports, { recursive: true }); checkedDirectory(reports);
    const filename = `${clock().toISOString().slice(0, 10)}-${slug}-${newId()}.md`, title = `Báo cáo Portal ${stats.from} – ${stats.to}`;
    const body = `# ${title}\n\n${statsTable(stats)}\n\n## Dữ liệu đầy đủ\n\n\`\`\`json\n${JSON.stringify(stats, null, 2)}\n\`\`\`\n`;
    writeFileSync(assertInside(root, join(reports, filename)), body, { flag: "wx" });
    apply(() => registerUpload({ raw, hub, store: deps.documents.store, config: deps.documents.config, now: clock, afterRegister: deps.documents.afterRegister }, projectId, { filename, kind: "report", title }, "text/markdown", Buffer.from(body)));
    return title;
  };
  return {
    handler, games, propose,
    status: () => ({ projectId: id(), configured: deps.configured }),
    actions: () => ({ actions: (raw.prepare("SELECT * FROM portal_actions WHERE project_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100").all(id()) as ActionRow[]).map(view) }),
    async context(): Promise<string> {
      try { return (await games()).games.map(g => `${g.id} | ${cleanText(g.name)} | bật=${g.enabled} | bản=${g.currentVersion ?? "—"} | trận 7 ngày=${g.last7Days}`).join("\n") || "Portal chưa có game."; }
      catch { return "Không lấy được danh sách Portal trong lượt này; chưa có dữ liệu mới, không suy đoán."; }
    },
    async blocks(blocks: PortalBlock[], conversationId: string): Promise<void> {
      const texts: string[] = [];
      for (const block of blocks) try {
        if (["publish", "enable", "disable", "set-version"].includes(block.action)) { await propose(portalActionRequestSchema.parse(block), conversationId); continue; }
        if (block.action === "audit") {
          const audit = await publish.audit(block.game ? { game: block.game } : {});
          texts.push(["Nhật ký | Người | Thao tác | Game | Từ | Đến", ...audit.entries.map(e => `${e.at} | ${cleanText(e.actor)} | ${cleanText(e.action)} | ${e.gameId} | ${cleanText(JSON.stringify(e.from))} | ${cleanText(JSON.stringify(e.to))}`)].join("\n"));
        } else {
          const stats = block.action === "stats" && block.period !== "week" ? await (async () => {
            // Anchor local day to the Portal's default response (Host timezone may differ).
            const current = await publish.stats(block.game ? { game: block.game } : {});
            const from = new Date(Date.parse(`${current.to}T00:00:00Z`) - (block.period === "month" ? 29 : 0) * 86400000).toISOString().slice(0, 10);
            return publish.stats({ ...(block.game ? { game: block.game } : {}), from, to: current.to });
          })() : await publish.stats(block.action === "stats" && block.game ? { game: block.game } : {});
          texts.push(statsTable(stats));
          if (block.action === "list") {
            const list = await publish.listGames();
            texts.push(["Game | Bật | Bản", ...list.games.map(g => `${cleanText(g.name)} (${g.id}) | ${g.enabled ? "Có" : "Không"} | ${g.currentVersion ?? "—"}`)].join("\n"));
          }
          if ((block.action === "stats" && block.period === "month") || stats.games.length > 1) texts.push(`Đã lưu Knowledge: ${report(stats, block.action === "stats" ? block.game ?? "all" : "all")}.`);
        }
      } catch (error) { texts.push(error instanceof PortalRequestError ? error.message : error instanceof CommandError ? error.message : "Không thực hiện được yêu cầu Portal. Kiểm tra game, phiên bản và điều kiện publish; có thể đã có đề xuất đang mở."); }
      if (texts.length) message(texts.join("\n\n"), conversationId);
    },
    async reconcile(actionId: string): Promise<PortalAction> {
      const row = actionRow(actionId);
      if (!row || row.state !== "unknown") throw new Error("Chỉ kiểm tra lại thao tác chưa xác nhận.");
      const list = await publish.listGames(), game = list.games.find(g => g.id === row.game_id);
      if (!game && row.action !== "publish") { settle(row.id, "failed", null, "Không tìm thấy game trên Portal."); return view(actionRow(actionId)!); }
      if (row.action === "publish" || (row.action === "set-version" && row.target_project_id)) {
        const saved = row.result_json ? JSON.parse(row.result_json) as { releaseId?: string; commitSha?: string; baseVersion?: number } : {};
        // Recover the small crash window between release creation and recording its id on the action.
        const releases = row.target_project_id ? (await publish.list(row.target_project_id)).releases : [];
        const existing = saved.releaseId ? releases.find(r => r.id === saved.releaseId) : releases.find(r =>
          r.gameId === row.game_id && r.kind === (row.action === "publish" ? "publish" : "rollback")
          && r.createdAt >= (row.decided_at ?? row.created_at)
          && (row.action === "publish" ? r.commitSha === saved.commitSha : r.version === row.version));
        const release = existing?.state === "unknown" && row.target_project_id ? await publish.reconcile(row.target_project_id, existing.id) : existing;
        if (release?.state === "pending") return view(row);
        if (release) settle(row.id, release.state === "done" ? "done" : "failed", { releaseId: release.id, version: release.version }, release.state === "failed" ? "Không thấy thay đổi trên Portal." : null);
        else if (row.action === "publish" && saved.commitSha && saved.baseVersion !== undefined) {
          const found = game?.versions.find(v => v.commitSha === saved.commitSha && v.version > saved.baseVersion!);
          settle(row.id, found ? "done" : "failed", found ? { version: found.version } : null, found ? null : "Không thấy bản publish đã đề xuất trên Portal.");
        } else if (row.action === "set-version") {
          settle(row.id, game?.currentVersion === row.version ? "done" : "failed", { version: game?.currentVersion ?? null }, game?.currentVersion === row.version ? null : "Portal hiện không có phiên bản đã yêu cầu.");
        }
      } else {
        const done = row.action === "set-version" ? game?.currentVersion === row.version : game?.enabled === (row.action === "enable");
        settle(row.id, done ? "done" : "failed", { version: game?.currentVersion ?? null, enabled: game?.enabled ?? false }, done ? null : "Portal hiện không có trạng thái đã yêu cầu.");
      }
      return view(actionRow(actionId)!);
    },
    start(commandPipeline: ReturnType<typeof createCommandPipeline>) {
      pipeline = commandPipeline;
      if (!id()) return;
      apply(() => raw.prepare("UPDATE portal_actions SET state='unknown',error='host-restarted' WHERE state='running'").run());
      unsubscribe = hub.subscribe(id()!, kick);
    },
    async idle() { while (inflight.size) await Promise.allSettled([...inflight.values()]); },
    async stop() { stopped = true; unsubscribe?.(); await Promise.allSettled([...inflight.values()]); },
  };
}
export type PortalOpsService = ReturnType<typeof createPortalOpsService>;
