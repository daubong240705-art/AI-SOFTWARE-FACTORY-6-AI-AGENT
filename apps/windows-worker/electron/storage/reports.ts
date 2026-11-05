import type Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isActive, type Run } from "../../shared/runs";
import type { ChatReceipt } from "../../shared/chat";
import {
  reportRefSchema,
  reportPolicySchema,
  reportDecisionSchema,
  type Report,
  type ReportView,
  type ReportRef,
  type ReportDecision,
  type ReportStatus,
  type ReportState,
  reportCapabilities,
} from "../../shared/reports";
import { sourceVersion, readEvidence } from "../team/evidence";
import type { EvidenceStore } from "./evidence";
import { patchFor } from "./evidence";
import { redact } from "../runtime/security";
import type { BoardStore } from "./board";

/** One snapshot per terminal run. Unlinked, undecided reports follow run retention. */
export class Reports {
  constructor(
    private db: Database.Database,
    directory: string,
    original: number,
    private evidence: EvidenceStore,
    private board: BoardStore,
    private readRun: (id: string) => Run,
  ) {
    if ((db.pragma("user_version", { simple: true }) as number) >= 11) return;
    const backup = join(directory, "worker.schema10.pre-reports.backup.sqlite");
    if (original === 10 && !existsSync(backup))
      db.prepare("VACUUM INTO ?").run(backup);
    db.transaction(() =>
      db.exec(`
      CREATE TABLE reports(id TEXT PRIMARY KEY,run_id TEXT NOT NULL UNIQUE REFERENCES runs(id),
        project_id TEXT NOT NULL,item_id TEXT REFERENCES board_items(id),revision INTEGER,
        value TEXT NOT NULL,run_value TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE INDEX reports_item ON reports(item_id,created_at);
      CREATE TRIGGER reports_immutable BEFORE UPDATE ON reports BEGIN SELECT RAISE(ABORT,'Report is immutable'); END;
      CREATE TABLE report_policies(item_id TEXT PRIMARY KEY REFERENCES board_items(id),required INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE report_decisions(request_id TEXT PRIMARY KEY,report_id TEXT NOT NULL UNIQUE REFERENCES reports(id),
        fingerprint TEXT NOT NULL,action TEXT NOT NULL,comment TEXT NOT NULL,receipt TEXT,created_at TEXT NOT NULL);
      CREATE TRIGGER report_decisions_immutable BEFORE UPDATE ON report_decisions BEGIN SELECT RAISE(ABORT,'Decision is immutable'); END;
      PRAGMA user_version=11;
    `),
    )();
  }
  capture(input: ReportRef): Report {
    const ref = reportRefSchema.parse({
        projectId: input.projectId,
        runId: input.runId,
      }),
      run = this.readRun(ref.runId);
    if (run.projectId !== ref.projectId)
      throw new Error("Lượt chạy không thuộc dự án.");
    const prior = this.db
      .prepare("SELECT value FROM reports WHERE run_id=?")
      .get(run.id) as { value: string } | undefined;
    if (prior) return JSON.parse(prior.value);
    if (isActive(run.state) || !run.endedAt)
      throw new Error("Lượt chạy chưa có kết quả cuối.");
    const linked = this.board.runReference(run.id) as {
      itemId: string;
      revision: number;
      submissionId: string;
      title: string;
      criteria: string;
    } | null;
    const work = linked
      ? { ...linked, criteria: JSON.parse(linked.criteria) }
      : !run.leadAdmission && run.workContext
        ? {
            itemId: run.workContext.itemId,
            revision: run.workContext.revision,
            submissionId: null,
            title: run.workContext.title,
            criteria: run.workContext.criteria,
          }
        : null;
    let version: string | null = null;
    let capture: ReturnType<EvidenceStore["get"]> | undefined;
    try {
      capture = this.evidence.get(run.id);
      const after = capture.after;
      if (after?.complete)
        version =
          sourceVersion({
            complete: true,
            files: Object.fromEntries(
              Object.entries(after.files).map(([path, file]) => [
                path,
                file.hash!,
              ]),
            ),
          }) ?? null;
    } catch {
      /* Legacy/missing snapshots remain unknown. */
    }
    if (run.integration)
      version = run.integration.evidence?.sourceVersion ?? null;
    const finalFiles =
      run.integration?.evidence?.files ?? capture?.after?.files;
    const commands: Report["commands"] = run.commands.map((command) => {
      let artifactState: "available" | "missing" | "unknown" = "unknown",
        artifactIssue = "Chưa có artifact và hash để đối chiếu.";
      if (command.artifactId && command.artifactHash) {
        try {
          const output = this.evidence.command(run.id, command.artifactId);
          if (
            createHash("sha256").update(output).digest("hex") !==
            command.artifactHash
          )
            throw new Error("Artifact không khớp hash.");
          artifactState = "available";
          artifactIssue = "";
        } catch (error) {
          artifactState = "missing";
          artifactIssue =
            error instanceof Error ? error.message : "Thiếu artifact.";
        }
      }
      const result: ReportStatus =
        command.status === "error" ||
        (Number.isInteger(command.exitCode) && command.exitCode !== 0)
          ? "fail"
          : command.status === "completed" && command.exitCode === 0
            ? artifactState === "available"
              ? "pass"
              : "unknown"
            : command.status === "pending"
              ? "not-run"
              : "unknown";
      return { ...command, result, artifactState, artifactIssue };
    });
    const review = run.review;
    const criteria: Report["criteria"] = (review?.acceptance ?? []).map(
      (ac) => {
        const refs: import("../../shared/evidence").EvidenceRef[] =
          "refs" in ac
            ? (ac.refs as import("../../shared/evidence").EvidenceRef[])
            : [];
        let available = refs.length > 0 && !!version;
        for (const ref of refs) {
          try {
            readEvidence(run, ref, this.evidence);
            if (
              ref.kind === "command"
                ? ref.sourceVersion !== version
                : (finalFiles?.[ref.path]?.hash ?? null) !== ref.hash
            )
              available = false;
          } catch {
            available = false;
          }
        }
        return {
          criterion: ac.criterion,
          evidence: ac.evidence,
          refs,
          result:
            ac.status === "failed"
              ? "fail"
              : ac.status === "passed" &&
                  review &&
                  "version" in review &&
                  review.verification?.verified &&
                  available
                ? "pass"
                : "unknown",
        };
      },
    );
    if (!criteria.length && work)
      for (const criterion of work.criteria)
        criteria.push({
          criterion,
          result: "not-run",
          evidence: "Chưa có review gắn bằng chứng cho tiêu chí này.",
          refs: [],
        });
    const latest = new Map(
      run.tasks
        .filter((t) => ["work", "fix"].includes(t.kind))
        .map((t) => [t.originalTaskId ?? t.id, t]),
    );
    const verified =
      run.mode === "team" &&
      run.state === "completed" &&
      (!run.integration || run.integration.state === "verified") &&
      review?.status === "completed" &&
      "version" in review &&
      review.verification?.verified === true &&
      review.fixes.length === 0 &&
      criteria.length > 0 &&
      criteria.every((c) => c.result === "pass") &&
      [...latest.values()].every((t) => t.state === "completed");
    const report: Report = {
      version: 1,
      id: randomUUID(),
      runId: run.id,
      projectId: run.projectId,
      work,
      capturedAt: new Date().toISOString(),
      endedAt: run.endedAt,
      state: run.state,
      attemptRoot: run.attemptRoot ?? run.id,
      retryOf: run.retryOf ?? null,
      conversationId: run.conversationId ?? null,
      sourceVersion: version,
      workspace: run.integration?.workspace ?? run.workspace,
      summary: run.summary,
      error: run.error,
      review,
      criteria,
      commands,
      changes: run.changes,
      files: run.changes.map((file) => ({
        path: file.path,
        before: capture?.before.files[file.path] ?? null,
        after: capture?.after?.files[file.path] ?? null,
        issue:
          !capture?.after ||
          !capture.before.enumerationComplete ||
          !capture.after.enumerationComplete
            ? "Snapshot chưa đủ để đối chiếu file."
            : "",
      })),
      verification: verified
        ? "pass"
        : criteria.some((c) => c.result === "fail") ||
            commands.some((c) => c.result === "fail")
          ? "fail"
          : criteria.length || commands.length
            ? "unknown"
            : "not-run",
      tasks: run.tasks.map((t) => ({
        id: t.id,
        originalTaskId: t.originalTaskId,
        state: t.state,
        role: t.role,
        model: t.model,
        sessionId: t.sessionId,
        sourceVersion: t.evidence?.sourceVersion ?? null,
      })),
      metrics: {
        requests: run.requests,
        inputTokens: run.metrics?.inputTokens ?? null,
        outputTokens: run.metrics?.outputTokens ?? null,
        cost: null,
      },
      provenance: {
        model: run.model,
        runtimeVersion: run.runtimeVersion,
        mode: run.mode,
        origin: "stored-terminal-run",
        artifactPolicy:
          "Referenced SQLite artifacts; missing content is never reconstructed from the current workspace.",
      },
    };
    this.db
      .prepare("INSERT INTO reports VALUES (?,?,?,?,?,?,?,?)")
      .run(
        report.id,
        run.id,
        run.projectId,
        work?.itemId ?? null,
        work?.revision ?? null,
        JSON.stringify(report),
        JSON.stringify(run),
        report.capturedAt,
      );
    return report;
  }
  snapshotRun(runId: string): Run {
    const row = this.db
      .prepare("SELECT run_value FROM reports WHERE run_id=?")
      .get(runId) as { run_value: string } | undefined;
    if (!row) throw new Error("Chưa có báo cáo đã lưu.");
    return JSON.parse(row.run_value);
  }
  evidenceRun(runId: string): Run {
    const row = this.db
      .prepare("SELECT run_value FROM reports WHERE run_id=?")
      .get(runId) as { run_value: string } | undefined;
    return row ? JSON.parse(row.run_value) : this.readRun(runId);
  }
  policy(projectId: string, itemId: string) {
    if (this.board.item(itemId).projectId !== projectId)
      throw new Error("Công việc không thuộc dự án.");
    const row = this.db
      .prepare("SELECT required,version FROM report_policies WHERE item_id=?")
      .get(itemId) as { required: number; version: number } | undefined;
    return { required: !!row?.required, version: row?.version ?? 0 };
  }
  setPolicy(input: import("zod").z.infer<typeof reportPolicySchema>) {
    const data = reportPolicySchema.parse(input);
    return this.db.transaction(() => {
      if (data.runId) {
        const state = this.state(data.runId);
        const report = this.capture({
          projectId: data.projectId,
          runId: data.runId,
        });
        if (
          !state ||
          state.freshness === "stale" ||
          report.work?.itemId !== data.itemId
        )
          throw new Error(
            "Báo cáo đã hết hiệu lực. Mở công việc hiện tại để đổi chính sách.",
          );
      }
      const prior = this.policy(data.projectId, data.itemId);
      if (prior.version !== data.version)
        throw new Error("Chính sách đã thay đổi. Tải lại báo cáo.");
      this.db
        .prepare(
          "INSERT INTO report_policies VALUES (?,?,?) ON CONFLICT(item_id) DO UPDATE SET required=excluded.required,version=excluded.version",
        )
        .run(data.itemId, +data.required, prior.version + 1);
      return this.policy(data.projectId, data.itemId);
    })();
  }
  // Metadata only: no artifact reads, full report decoding or source hashing on
  // monitor/detail polls. A missing report is never inferred from run.completed.
  state(runId: string): ReportState | undefined {
    return this.states(undefined, runId).get(runId);
  }
  states(projectId?: string, runId?: string): Map<string, ReportState> {
    const rows = this.db
      .prepare(
        `SELECT
      p.run_id AS runId,p.project_id AS projectId,
      json_extract(p.value,'$.verification') AS verification,
      COALESCE(policy.required,0) AS required,COALESCE(policy.version,0) AS policyVersion,
      d.action AS action,
      (p.item_id IS NOT NULL AND (b.id IS NULL OR b.revision IS NOT p.revision OR b.archived_at IS NOT NULL)) AS oldRevision,
      EXISTS(SELECT 1 FROM work_attempts a JOIN work_submissions s ON s.id=a.submission_id JOIN runs r ON r.id=a.run_id
        WHERE s.item_id=p.item_id AND r.rowid>(SELECT rowid FROM runs WHERE id=p.run_id)) AS later
      FROM reports p LEFT JOIN board_items b ON b.id=p.item_id
      LEFT JOIN report_policies policy ON policy.item_id=p.item_id
      LEFT JOIN report_decisions d ON d.report_id=p.id
      WHERE ${runId ? "p.run_id=?" : "p.project_id=?"}`,
      )
      .all(runId ?? projectId) as {
      runId: string;
      projectId: string;
      verification: ReportStatus;
      required: number;
      policyVersion: number;
      action: "accept" | "request-fix" | null;
      oldRevision: number;
      later: number;
    }[];
    return new Map(
      rows.map((row) => [
        row.runId,
        {
          report: {
            runId: row.runId,
            projectId: row.projectId,
            verification: row.verification,
          },
          freshness: row.oldRevision || row.later ? "stale" : "unknown",
          reasons: [
            ...(row.oldRevision
              ? ["Yêu cầu đã đổi phiên bản hoặc được lưu trữ."]
              : []),
            ...(row.later ? ["Công việc đã có lần thực hiện mới hơn."] : []),
          ],
          policy: { required: !!row.required, version: row.policyVersion },
          decision: row.action ? { action: row.action } : null,
        },
      ]),
    );
  }
  view(input: ReportRef, currentVersion: string | null): ReportView {
    const report = this.capture(input),
      reasons: string[] = [];
    const artifactIssues: string[] = [];
    for (const command of report.commands) {
      if (command.artifactState === "missing")
        artifactIssues.push(`Thiếu artifact lệnh: ${command.command}`);
      if (command.artifactState !== "available") continue;
      try {
        const output = this.evidence.command(report.runId, command.artifactId!);
        if (
          createHash("sha256").update(output).digest("hex") !==
          command.artifactHash
        )
          throw new Error("Artifact không khớp hash.");
      } catch {
        artifactIssues.push(
          `Không còn đọc được artifact lệnh: ${command.command}`,
        );
      }
    }
    const savedRun = this.snapshotRun(report.runId);
    const refs = new Map(
      report.criteria
        .flatMap((c) => c.refs)
        .map((ref) => [JSON.stringify(ref), ref]),
    );
    for (const ref of refs.values()) {
      try {
        readEvidence(savedRun, ref, this.evidence);
      } catch {
        artifactIssues.push(
          `Không còn đọc được evidence: ${ref.kind === "command" ? ref.callId : ref.path}`,
        );
      }
    }
    const state = this.state(report.runId)!;
    let stale = state.freshness === "stale";
    reasons.push(...state.reasons);
    if (
      report.sourceVersion &&
      currentVersion &&
      report.sourceVersion !== currentVersion
    ) {
      stale = true;
      reasons.push("Source hiện tại khác source trong báo cáo.");
    }
    if (!report.sourceVersion || !currentVersion)
      reasons.push("Chưa đối chiếu được đầy đủ source hiện tại.");
    const row = this.db
      .prepare(
        "SELECT request_id,action,comment,receipt,created_at AS createdAt FROM report_decisions WHERE report_id=?",
      )
      .get(report.id) as
      | {
          request_id: string;
          action: "accept" | "request-fix";
          comment: string;
          receipt: string | null;
          createdAt: string;
        }
      | undefined;
    const receipt = row?.receipt
      ? (this.db
          .prepare(
            "SELECT request_id AS requestId,run_id AS runId,follow_up_id AS followUpId,state FROM chat_requests WHERE request_id=?",
          )
          .get(row.request_id) as ChatReceipt | undefined)
      : undefined;
    return {
      report,
      artifactIssues,
      checkedAt: new Date().toISOString(),
      freshness: stale
        ? "stale"
        : report.sourceVersion && currentVersion
          ? "current"
          : "unknown",
      reasons,
      policy: report.work
        ? this.policy(report.projectId, report.work.itemId)
        : { required: false, version: 0 },
      decision: row
        ? {
            action: row.action,
            comment: row.comment,
            createdAt: row.createdAt,
            receipt:
              receipt ?? (row.receipt ? JSON.parse(row.receipt) : undefined),
          }
        : null,
      canDecide:
        !stale &&
        !row &&
        !!report.work &&
        !!report.conversationId &&
        !this.snapshotRun(report.runId).integration,
    };
  }
  decide(
    input: ReportDecision,
    currentVersion: string | null,
    launch: (report: Report) => ChatReceipt,
    validate?: () => void,
  ) {
    const data = reportDecisionSchema.parse(input),
      fingerprint = JSON.stringify(data);
    return this.db.transaction(() => {
      const report = this.capture(data);
      const prior = this.db
        .prepare(
          "SELECT request_id,fingerprint FROM report_decisions WHERE report_id=? OR request_id=?",
        )
        .get(report.id, data.requestId) as
        | { request_id: string; fingerprint: string }
        | undefined;
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new Error("Báo cáo đã có quyết định hoặc mã gửi đã được dùng.");
        return this.view(data, currentVersion);
      }
      const view = this.view(data, currentVersion);
      if (!view.canDecide)
        throw new Error(
          "Báo cáo cũ hoặc chưa gắn công việc. Mở công việc hiện tại để tiếp tục.",
        );
      if (data.action === "accept" && view.freshness !== "current")
        throw new Error("Chưa đối chiếu được source để nghiệm thu.");
      if (data.action === "accept" && !reportCapabilities(view).accept)
        throw new Error("Thiếu bằng chứng lưu trữ để nghiệm thu.");
      validate?.();
      let receipt: ChatReceipt | undefined;
      if (data.action === "request-fix") {
        this.board.addComment({
          projectId: data.projectId,
          itemId: report.work!.itemId,
          clientId: data.requestId,
          body: data.comment,
        });
        receipt = launch(report);
      }
      this.db
        .prepare("INSERT INTO report_decisions VALUES (?,?,?,?,?,?,?)")
        .run(
          data.requestId,
          report.id,
          fingerprint,
          data.action,
          data.comment,
          receipt ? JSON.stringify(receipt) : null,
          new Date().toISOString(),
        );
      return this.view(data, currentVersion);
    })();
  }
  protectedRunIds(): string[] {
    return (
      this.db
        .prepare(
          "SELECT run_id AS id FROM reports WHERE item_id IS NOT NULL OR id IN (SELECT report_id FROM report_decisions) UNION SELECT c.run_id AS id FROM report_decisions d JOIN chat_requests c ON c.request_id=d.request_id WHERE c.run_id IS NOT NULL",
        )
        .all() as { id: string }[]
    ).map((r) => r.id);
  }
  hasProject(id: string) {
    return !!this.db
      .prepare("SELECT 1 FROM reports WHERE project_id=? LIMIT 1")
      .get(id);
  }
  commandOutput(runId: string, callId: string, artifactId?: string) {
    const command = this.evidenceRun(runId).commands.find(
      (c) => c.callId === callId && c.artifactId === artifactId,
    );
    if (!command) throw new Error("Không có command tương ứng.");
    const output = this.evidence.command(runId, artifactId ?? callId);
    if (
      command.artifactHash &&
      createHash("sha256").update(output).digest("hex") !== command.artifactHash
    )
      throw new Error("Artifact lệnh không khớp hash đã lưu.");
    return output;
  }
  pending(projectId: string) {
    return this.db
      .prepare(
        `SELECT p.run_id AS runId,json_extract(p.value,'$.work.title') AS title,p.created_at AS createdAt
      FROM reports p JOIN report_policies policy ON policy.item_id=p.item_id JOIN board_items b ON b.id=p.item_id
      WHERE p.project_id=? AND policy.required=1 AND b.archived_at IS NULL AND b.revision=p.revision
      AND NOT EXISTS(SELECT 1 FROM report_decisions d WHERE d.report_id=p.id)
      AND NOT EXISTS(SELECT 1 FROM work_attempts a JOIN work_submissions s ON s.id=a.submission_id JOIN runs r ON r.id=a.run_id
        WHERE s.item_id=p.item_id AND r.rowid>(SELECT rowid FROM runs WHERE id=p.run_id))
      ORDER BY p.created_at DESC LIMIT 50`,
      )
      .all(projectId) as { runId: string; title: string; createdAt: string }[];
  }
  itemHistory(projectId: string, itemId: string) {
    this.policy(projectId, itemId);
    return (
      this.db
        .prepare(
          "SELECT run_id AS runId,value FROM reports WHERE item_id=? ORDER BY rowid",
        )
        .all(itemId) as { runId: string; value: string }[]
    ).map((row) => ({
      report: JSON.parse(row.value) as Report,
      decisions: this.decisionRecords((JSON.parse(row.value) as Report).id),
    }));
  }
  private decisionRecords(reportId: string) {
    return this.db
      .prepare(
        `SELECT d.action,d.comment,d.created_at AS createdAt,
      d.receipt AS originalReceipt,c.request_id AS requestId,c.run_id AS runId,c.follow_up_id AS followUpId,c.state
      FROM report_decisions d LEFT JOIN chat_requests c ON c.request_id=d.request_id WHERE d.report_id=?`,
      )
      .all(reportId);
  }
  fileDiff(input: ReportRef & { path: string }) {
    const report = this.capture(input),
      file = report.files.find((f) => f.path === input.path);
    if (!file) throw new Error("File không thuộc báo cáo.");
    return this.diffForFile(file);
  }
  private diffForFile(file: Report["files"][number]) {
    if (file.issue) return { patch: "", binary: false, reason: file.issue };
    try {
      return patchFor(
        file.path,
        this.evidence.bytes(file.before),
        this.evidence.bytes(file.after),
      );
    } catch (error) {
      return {
        patch: "",
        binary: false,
        reason: error instanceof Error ? error.message : "Thiếu blob file.",
      };
    }
  }
  export(input: ReportRef, secrets: string[] = []) {
    const report = this.capture(input),
      run = this.snapshotRun(report.runId);
    const attachments = report.commands.map((command) => {
      try {
        if (!command.artifactId || !command.artifactHash)
          throw new Error("Thiếu artifact/hash.");
        const output = this.evidence.command(report.runId, command.artifactId);
        if (
          createHash("sha256").update(output).digest("hex") !==
          command.artifactHash
        )
          throw new Error("Hash không khớp.");
        return {
          kind: "command",
          id: command.artifactId,
          status: "included",
          output,
        };
      } catch (error) {
        return {
          kind: "command",
          id: command.artifactId ?? command.callId,
          status: "missing",
          reason: error instanceof Error ? error.message : "Thiếu artifact.",
        };
      }
    });
    const refs = [
      ...new Map(
        report.criteria
          .flatMap((c) => c.refs)
          .map((r) => [JSON.stringify(r), r]),
      ).values(),
    ];
    const evidence = refs.map((ref) => {
      try {
        return {
          ref,
          status: "included",
          content: readEvidence(run, ref, this.evidence),
          ...(ref.kind === "file"
            ? { diff: this.evidence.taskDiff(run, ref) }
            : {}),
        };
      } catch (error) {
        return {
          ref,
          status: "missing",
          reason: error instanceof Error ? error.message : "Thiếu evidence.",
        };
      }
    });
    const files = report.files.map((file) => ({
      path: file.path,
      ...this.diffForFile(file),
    }));
    const result = {
      manifest: {
        version: 1,
        exportedAt: new Date().toISOString(),
        reportId: report.id,
        runId: report.runId,
        revision: report.work?.revision ?? null,
        sourceVersion: report.sourceVersion,
        reportHash: createHash("sha256")
          .update(JSON.stringify(report))
          .digest("hex"),
        content:
          "Stored text evidence only; file content may be truncated to 256000 characters; binary content is metadata only and omitted diffs carry a reason.",
        mutableRunIncluded: false,
      },
      report,
      decisions: this.decisionRecords(report.id),
      attachments,
      evidence,
      files,
    };
    const sanitized = JSON.parse(
      JSON.stringify(result, (_key, value) =>
        typeof value === "string" ? redact(value, secrets, Infinity) : value,
      ),
    ) as typeof result;
    sanitized.manifest.reportHash = createHash("sha256")
      .update(JSON.stringify(sanitized.report))
      .digest("hex");
    return sanitized;
  }
}
