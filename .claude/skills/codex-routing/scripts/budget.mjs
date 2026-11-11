// Durable call counter: calls per DAY (resets at UTC midnight) and per task (survives days, so retry and
// escalation state is not lost). A call is counted BEFORE codex is spawned, so a crash cannot hide a call.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const empty = () => ({ days: {}, tasks: {}, updatedAt: null });
const today = () => new Date().toISOString().slice(0, 10);

export function createBudget(file, clock = today) {
  const load = () => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : empty());
  const save = (data) => {
    mkdirSync(path.dirname(file), { recursive: true });
    data.updatedAt = new Date().toISOString();
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, file);
  };
  const taskState = (data, id) => data.tasks[id] ?? { taskCalls: 0, retries: 0, stepIndex: null, model: null, outcome: null };
  return {
    read(id) {
      const data = load();
      return { callsTotal: data.days[clock()] ?? 0, ...taskState(data, id) };
    },
    write(id, patch) {
      const data = load();
      data.tasks[id] = { ...taskState(data, id), ...patch };
      save(data);
    },
    // Reserve one call. Returns today's new count. Throws when a limit is reached.
    reserveCall(id, limits) {
      const data = load();
      const day = clock();
      if ((data.days[day] ?? 0) >= limits.maxCallsPerDay) throw new Error("daily call budget exhausted");
      const t = taskState(data, id);
      if (t.taskCalls >= limits.maxCallsPerTask) throw new Error("per-task call limit reached");
      data.days[day] = (data.days[day] ?? 0) + 1;
      data.tasks[id] = { ...t, taskCalls: t.taskCalls + 1 };
      save(data);
      return data.days[day];
    },
  };
}
