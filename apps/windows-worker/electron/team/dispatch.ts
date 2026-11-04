import { inScope, type TeamTask } from "../../shared/team";

/** Select only source-independent roots until integrated dependency output exists. */
export function isolatedDispatch(
  tasks: readonly TeamTask[],
  activeIds: ReadonlySet<string>,
  integratedIds?: ReadonlySet<string>,
): TeamTask[] {
  if (activeIds.size >= 2) return [];
  const active = tasks.filter((task) => activeIds.has(task.id));
  // Unknown ownership must never grant another execution slot.
  if (active.length !== activeIds.size) return [];
  const chosen: TeamTask[] = [];
  for (const task of tasks) {
    if (
      task.kind !== "work" ||
      task.state !== "queued" ||
      (integratedIds
        ? task.dependsOn.some((id) => !integratedIds.has(id))
        : task.dependsOn.length > 0) ||
      !task.allowedPaths.length ||
      activeIds.has(task.id)
    )
      continue;
    if (
      integratedIds &&
      task.role === "test" &&
      tasks.some(
        (other) =>
          ["be", "fe", "devops"].includes(other.role) &&
          !integratedIds.has(other.id),
      )
    )
      continue;
    const overlaps = [...active, ...chosen].some((other) =>
      task.allowedPaths.some((path) =>
        other.allowedPaths.some(
          (scope) => inScope(path, [scope]) || inScope(scope, [path]),
        ),
      ),
    );
    if (!overlaps) chosen.push(task);
    if (chosen.length + activeIds.size === 2) break;
  }
  return chosen;
}
