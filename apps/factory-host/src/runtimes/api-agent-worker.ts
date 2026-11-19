import { readFileSync, writeFileSync } from "node:fs";
import type { RuntimeEvent } from "../dispatch/runtime.js";
import { runApiAgent, type ApiAgentInput } from "./api-agent-loop.js";

const emit = (event: RuntimeEvent): void => { writeFileSync(1, `${JSON.stringify(event)}\n`); };

async function main(): Promise<void> {
  await runApiAgent(JSON.parse(readFileSync(0, "utf8")) as ApiAgentInput, emit);
}

void main().catch(() => emit({ type: "failed", kind: "runtime", message: "API agent worker failed" }));
