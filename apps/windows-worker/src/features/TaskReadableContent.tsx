import { useState, type ReactNode } from "react";
import type { TeamTask } from "../../shared/team";
import { taskDescription, taskResult } from "../../shared/task-presentation";
import { ChatMarkdown } from "./ChatMarkdown";

export function TaskDescription({ task }: { task: TeamTask }) {
  const text = taskDescription(task);
  if (!text) return null;
  return (
    <section className="task-readable" aria-label="Mô tả nhiệm vụ">
      <h3>Nhiệm vụ</h3>
      <ChatMarkdown text={text} />
    </section>
  );
}

export function TaskResult({ task }: { task: TeamTask }) {
  const result = taskResult(task);
  return (
    <section className="task-readable" aria-label="Báo cáo của agent">
      <h3>Kết quả agent báo cáo</h3>
      <ChatMarkdown text={result.text} />
      <p className="small muted">
        Báo cáo của agent chưa thay thế kết quả kiểm chứng bên dưới.
      </p>
    </section>
  );
}

export function TaskTechnicalDetails({
  task,
  children,
}: {
  task?: TeamTask;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="task-technical"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Dữ liệu kỹ thuật</summary>
      {children}
      {open && task && (
        <div className="task-raw">
          <h4>Chỉ dẫn gửi agent</h4>
          <pre>{task.instructions}</pre>
          <h4>Phản hồi gốc</h4>
          <pre>{task.summary || "Chưa có phản hồi."}</pre>
        </div>
      )}
    </details>
  );
}
