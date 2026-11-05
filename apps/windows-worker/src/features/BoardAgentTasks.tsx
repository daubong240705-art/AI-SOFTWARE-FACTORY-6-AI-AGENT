import type { BoardCard } from "../../shared/board";
import { taskLabels } from "../../shared/inspector";
import type { Role } from "../../shared/contracts";

export function BoardAgentTasks({
  card,
  role,
  onInspect,
}: {
  card: BoardCard;
  role?: Role;
  onInspect: (runId: string, taskId?: string) => void;
}) {
  const tasks = (card.tasks ?? []).filter(
    (task) => !role || task.role === role,
  );
  if (!tasks.length) return null;
  return (
    <div className="board-agent-tasks" aria-label="Task theo agent">
      <small className="muted">
        {card.executionMode === "isolated-pair"
          ? "Song song tối đa 2 task độc lập"
          : "Chế độ tuần tự"}
      </small>
      <ul>
        {tasks.map((task) => (
          <li key={task.id}>
            <button
              disabled={!card.runId}
              onClick={() => onInspect(card.runId!, task.id)}
            >
              <span className="board-agent-task-heading">
                <strong>
                  {task.role.toUpperCase()} · {task.id}
                </strong>
                <span className="board-agent-task-state">
                  {taskLabels[task.state as keyof typeof taskLabels] ??
                    task.state}
                </span>
              </span>
              <span className="board-agent-task-title">{task.title}</span>
              <small className="board-agent-task-detail muted">
                {task.dependsOn.length
                  ? `Phụ thuộc: ${task.dependsOn
                      .map((id) => {
                        const dependency = card.tasks?.find(
                          (t) => (t.originalTaskId ?? t.id) === id,
                        );
                        return dependency
                          ? `${dependency.role.toUpperCase()} ${id} (${taskLabels[dependency.state as keyof typeof taskLabels] ?? dependency.state})`
                          : id;
                      })
                      .join(", ")}`
                  : "Không có phụ thuộc"}
                {` · ${task.acceptanceCount} tiêu chí`}
              </small>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
