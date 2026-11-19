import { fileURLToPath } from "node:url";
import type { RuntimeAdapter, RuntimeEvent } from "../dispatch/runtime.js";
import type { ApiAgentInput } from "./api-agent-loop.js";
import { cliProcess } from "./local-cli-process.js";
import { operatorLanguage } from "./opencode.js";

const failed = (kind: "runtime" | "timeout", message: string): RuntimeEvent => ({ type: "failed", kind, message });

export function createApiAgentRuntime(): RuntimeAdapter {
  return { kind: "api-agent", async start(context) {
    const { signal, agent, model, task } = context;
    const minutes = agent && "timeoutMinutes" in agent ? agent.timeoutMinutes : undefined;
    const timeoutMinutes = typeof minutes === "number" && Number.isInteger(minutes) && minutes >= 1 && minutes <= 720 ? minutes : 60;
    const input: ApiAgentInput = {
      ...(model ? { access: { baseUrl: model.baseUrl, token: model.token, models: model.models,
        ...(model.mcpBaseUrl === undefined ? {} : { mcpBaseUrl: model.mcpBaseUrl }) } } : {}),
      ...(agent?.model == null ? {} : { model: agent.model }), effort: agent?.effort ?? "medium", timeoutMinutes,
      task: { title: task.title, goal: task.goal, brief: task.brief, acceptance: task.acceptance, inputs: task.inputs },
      handoff: context.handoff, contextPack: context.contextPack, instructions: context.instructions, inputs: context.inputs,
      workspacePath: context.workspace?.path, language: operatorLanguage(),
    };
    if (signal.aborted) return { async *events() {}, async stop() {} };
    const queue: RuntimeEvent[] = [];
    let wake: (() => void) | undefined;
    let ended = false, stopped = false, timedOut = false, invalid = false;
    let terminal: RuntimeEvent | undefined;
    let pending = "";
    const push = (event: RuntimeEvent): void => { queue.push(event); wake?.(); };
    let child: ReturnType<typeof cliProcess>;
    try {
      child = cliProcess([process.execPath], [fileURLToPath(new URL("./api-agent-worker.js", import.meta.url))], {
        input: JSON.stringify(input), output(stream, chunk) {
          if (stream !== "stdout" || stopped || terminal || invalid) return;
          const lines = (pending + chunk).split("\n");
          pending = lines.pop()!;
          try {
            for (const line of lines) {
              if (line.length > 65_536) throw new Error();
              const event = JSON.parse(line) as RuntimeEvent;
              if (event.type === "completed" || event.type === "failed") { terminal = event; break; }
              if (!["progress", "usage", "evidence"].includes(event.type) || queue.length >= 281) throw new Error();
              push(event);
            }
            if (pending.length > 65_536) throw new Error();
          } catch { invalid = true; void child.stop().catch(() => {}); }
        },
      });
    } catch { return { async *events() { yield failed("runtime", "API agent worker could not start"); }, async stop() {} }; }
    const stop = (): Promise<void> => { stopped = true; return child.stop(); };
    const abort = (): void => { void stop().catch(() => {}); };
    signal.addEventListener("abort", abort, { once: true });
    const deadline = setTimeout(() => { timedOut = true; void child.stop().catch(() => {}); }, timeoutMinutes * 60_000).unref();
    if (signal.aborted) abort();
    void child.result.then(({ code }) => {
      clearTimeout(deadline);
      signal.removeEventListener("abort", abort);
      if (!stopped) push(timedOut ? failed("timeout", "API agent overall timeout exceeded")
        : code === 0 && !invalid && terminal ? terminal : failed("runtime", "API agent worker exited without a valid result"));
      ended = true;
      wake?.();
    });
    return { async *events() {
      try {
        while (!stopped) {
          const event = queue.shift();
          if (event) yield event;
          else if (ended) break;
          else await new Promise<void>((resolve) => { wake = resolve; });
        }
      } finally { if (!ended) await stop(); }
    }, stop };
  } };
}
