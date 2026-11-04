import { Clock3, Terminal, TriangleAlert } from "lucide-react";
import type { RunDetail } from "../../shared/runs";
import { runLabels } from "../../shared/runs";
import { formatDuration } from "../lib/formatDuration";
import { formatRequestUsage } from "../lib/formatRequestUsage";
import { ChangesPanel } from "./ChangesPanel";
import { CommandEvidence } from "./CommandEvidence";
import { AcceptanceEvidence } from "./AcceptanceEvidence";
import { ExecutionFacts } from "./ExecutionFacts";
import { failureLabels } from "../../shared/execution";
import { ActivityLog } from "./ActivityLog";

export function RunPanel({
  detail,
  tab,
  onPermission,
  busy,
  showPermissions = true,
}: {
  detail: RunDetail | null;
  tab: string;
  onPermission: (id: string, allow: boolean) => void;
  busy: boolean;
  showPermissions?: boolean;
}) {
  if (!detail)
    return (
      <div className="empty">
        <div className="empty-icon">
          <Terminal size={25} />
        </div>
        <strong>Chưa có lượt chạy</strong>
        <span className="muted small">
          Nhập yêu cầu và chọn agent để bắt đầu.
        </span>
      </div>
    );
  const { run } = detail;
  const workTasks = run.tasks.filter((task) =>
    ["work", "fix"].includes(task.kind),
  );
  return (
    <div className="run-panel">
      <div className="run-header">
        <span className={`run-state ${run.state}`}>{runLabels[run.state]}</span>
        <span className="muted small" title={run.model}>
          {run.role.toUpperCase()}
          {tab !== "activity" ? ` · ${run.model}` : ""}
        </span>
        {run.settings.permissionMode === "full-access" && (
          <span className="pill">Full access</span>
        )}
        {tab !== "activity" && (
          <span className="muted small">
            {formatRequestUsage(run.requests, run.settings.maxRequests)}
          </span>
        )}
      </div>
      {run.mode === "team" && tab === "activity" && workTasks.length > 0 && (
        <div className="task-board">
          {run.fixRound > 0 && (
            <div className="small muted">Vòng sửa {run.fixRound}</div>
          )}
          {workTasks.map((task) => (
            <details className={`team-task ${task.state}`} key={task.id}>
              <summary>
                <span className="pill">{task.role.toUpperCase()}</span>
                <strong>{task.title}</strong>
                <span className="muted small">
                  {
                    {
                      queued: "Chờ",
                      running: "Đang làm",
                      blocked: "Bị chặn",
                      completed: "Xong",
                      failed: "Lỗi",
                      cancelled: "Đã dừng",
                      skipped: "Bỏ qua",
                    }[task.state]
                  }
                </span>
              </summary>
              <div className="small muted">
                {task.id} · {task.model} ·{" "}
                {task.sessionId ?? "Chưa tạo session"}
              </div>
              <p className="small">
                Phạm vi: {task.allowedPaths.join(", ")} · Phụ thuộc:{" "}
                {task.dependsOn.join(", ") || "—"}
              </p>
              <p className="small muted">
                Kỹ năng:{" "}
                {task.skillSelection
                  ? task.skillSelection.skills
                      .map((skill) => `${skill.id} ${skill.version}`)
                      .join(", ") || "Rule nền"
                  : "Theo profile cũ"}
              </p>
              <ul className="small">
                {task.acceptance.map((ac, i) => (
                  <li key={i}>{ac}</li>
                ))}
              </ul>
              {task.error && <p className="warning-text small">{task.error}</p>}
              {task.failure && (
                <p className="warning-text small">
                  {failureLabels[task.failure.code]}
                </p>
              )}
              {task.metrics && (
                <div className="run-facts">
                  <ExecutionFacts metrics={task.metrics} />
                </div>
              )}
              {task.summary && <pre>{task.summary}</pre>}
            </details>
          ))}
        </div>
      )}
      {showPermissions &&
        run.permissions.map((permission) => (
          <section className="permission-box" key={permission.id}>
            <strong>
              <TriangleAlert size={16} />
              Cho phép công cụ một lần?
            </strong>
            <div>{permission.permission}</div>
            <pre>{permission.patterns.join("\n")}</pre>
            <p className="muted small">
              Shell chạy bằng quyền Windows của bạn, có thể tác động ngoài
              workspace.
            </p>
            <div className="inline">
              <button
                disabled={busy}
                onClick={() => onPermission(permission.id, false)}
              >
                Từ chối
              </button>
              <button
                disabled={busy}
                className="primary"
                onClick={() => onPermission(permission.id, true)}
              >
                Cho phép một lần
              </button>
            </div>
          </section>
        ))}
      {tab === "activity" && <ActivityLog key={run.id} detail={detail} />}
      {tab === "changes" && <ChangesPanel key={run.id} run={run} />}
      {tab === "result" && (
        <div className="run-result">
          {run.error && (
            <div className="notice error">
              <TriangleAlert size={16} />
              {run.failure && (
                <strong>{failureLabels[run.failure.code]} · </strong>
              )}
              {run.error}
            </div>
          )}
          {run.summary ? (
            <pre className="final-summary">{run.summary}</pre>
          ) : (
            <p className="muted">Chưa có báo cáo cuối.</p>
          )}
          {run.review && (
            <section className="acceptance-list">
              {!("version" in run.review) && (
                <p className="small muted">
                  Kết quả cũ · bằng chứng chưa được xác minh.
                </p>
              )}
              {"verification" in run.review &&
                run.review.verification?.issues.map((issue, i) => (
                  <p className="warning-text small" key={`issue-${i}`}>
                    {issue}
                  </p>
                ))}
              {run.review.acceptance.map((ac, i) => (
                <div className="command-result" key={i}>
                  <strong>{ac.criterion}</strong>
                  <span className="pill">
                    {
                      {
                        passed:
                          "version" in run.review! ? "Đạt" : "Đạt · báo cáo cũ",
                        failed: "Chưa đạt",
                        unverified: "Chưa xác minh",
                      }[ac.status]
                    }
                  </span>
                  <p className="small muted">{ac.evidence}</p>
                  {"refs" in ac && <AcceptanceEvidence refs={ac.refs} />}
                </div>
              ))}
              {run.review.limitations.map((text, i) => (
                <p className="warning-text small" key={i}>
                  {text}
                </p>
              ))}
            </section>
          )}
          {run.commands.length > 0 && (
            <section>
              <h2>
                <Terminal size={16} />
                Lệnh đã thực thi
              </h2>
              {run.commands.map((command, i) => (
                <CommandEvidence
                  key={
                    command.artifactId ??
                    `${command.taskId}:${command.callId}:${i}`
                  }
                  runId={run.id}
                  command={command}
                />
              ))}
            </section>
          )}
          <div className="run-facts">
            {run.mode === "direct" && run.skillSelection && (
              <span>
                Kỹ năng:{" "}
                {run.skillSelection.skills
                  .map((skill) => `${skill.id} ${skill.version}`)
                  .join(", ") || "Rule nền"}
              </span>
            )}
            <span>
              <Clock3 size={13} />{" "}
              {formatDuration(
                (run.endedAt ? Date.parse(run.endedAt) : Date.now()) -
                  Date.parse(run.startedAt ?? run.createdAt),
              )}
            </span>
            <span>{run.toolsCompleted} tool hoàn thành</span>
            <ExecutionFacts metrics={run.metrics} />
          </div>
          <p className="muted small">
            Trạng thái kết thúc phản ánh runtime; kết quả build/test chỉ có giá
            trị khi kèm lệnh và exit code.
          </p>
        </div>
      )}
    </div>
  );
}
