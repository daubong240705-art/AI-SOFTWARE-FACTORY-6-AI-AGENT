import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export interface DocWorkerConfig { enabled: boolean; python: string; script: string; command?: string[] }
export function docWorkerConfig(env: Readonly<Record<string, string | undefined>>): DocWorkerConfig {
  let command: string[] | undefined;
  if (env.FACTORY_DOC_WORKER_COMMAND !== undefined) {
    try { command = z.array(z.string().min(1).max(65536)).min(1).max(64).parse(JSON.parse(env.FACTORY_DOC_WORKER_COMMAND)); }
    catch { throw new Error("Invalid FACTORY_DOC_WORKER_COMMAND"); }
  }
  return { enabled: env.FACTORY_DOC_WORKER !== "off",
    python: env.FACTORY_DOC_WORKER_PYTHON ?? join(homedir(), "factory-v2/doc-worker/venv/bin/python"),
    script: env.FACTORY_DOC_WORKER_SCRIPT ?? fileURLToPath(new URL("../../workers/doc_worker.py", import.meta.url)),
    ...(command === undefined ? {} : { command }) };
}
