import { cliProcess, validateCliCommand } from "./local-cli-process.js";

type Cli = "codex" | "claude";
export interface AgentCliStatus { cli: Cli; installed: boolean; version: string | null; login: "ok" | "missing" | "unknown" }
export interface AgentCliProbe { enabled: boolean; clis: AgentCliStatus[] }
async function run(command: readonly string[], args: readonly string[]) {
  let output = "", timedOut = false;
  const child = cliProcess(command, args, { output(_stream, chunk) { output = (output + chunk).slice(0, 4096); } });
  const timer = setTimeout(() => { timedOut = true; void child.stop().catch(() => {}); }, 5_000);
  try { return { ...(await child.result), output, timedOut }; } finally { clearTimeout(timer); }
}
export function createAgentCliProbe(options: { enabled: boolean; commands: Record<Cli, readonly string[]>; now?: () => number;
  /** True when a provider key (for example NINE_ROUTER_API_KEY) is handed to the CLIs: Codex then works without `codex login`. */
  providerKey?: () => boolean }): () => Promise<AgentCliProbe> {
  Object.values(options.commands).forEach(validateCliCommand);
  const now = options.now ?? Date.now;
  let cache: { expires: number; value: AgentCliProbe } | undefined;
  let pending: Promise<AgentCliProbe> | undefined;
  return () => {
    if (cache && cache.expires > now()) return Promise.resolve(cache.value);
    pending ??= (async () => {
      const clis = await Promise.all((["codex", "claude"] as const).map(async (cli): Promise<AgentCliStatus> => {
        const [version, login] = await Promise.all([
          run(options.commands[cli], ["--version"]),
          run(options.commands[cli], cli === "codex" ? ["login", "status"] : ["auth", "status"]),
        ]);
        // Never return raw CLI text, paths, auth details or diagnostics in a probe response.
        const semver = version.output.match(/\b\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[a-zA-Z0-9.]+)?\b/)?.[0] ?? null;
        const absent = /not.?logged.?in|sign[ -]?in|unauthori[sz]ed|\b401\b|"loggedIn"\s*:\s*false/i.test(login.output);
        return { cli, installed: version.errorCode !== "ENOENT", version: version.code === 0 && !version.timedOut ? semver : null,
          login: login.errorCode || login.timedOut ? "unknown" : absent ? (cli === "codex" && options.providerKey?.() === true ? "ok" : "missing") : login.code === 0 ? "ok" : "unknown" };
      }));
      const value = { enabled: options.enabled, clis }; cache = { expires: now() + 30_000, value }; return value;
    })().finally(() => { pending = undefined; });
    return pending;
  };
}
