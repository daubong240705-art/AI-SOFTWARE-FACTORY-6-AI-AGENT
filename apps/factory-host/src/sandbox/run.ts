import { startProcess, type RunHandle, type RunOptions } from "../exec/process-group.js";
import { lstatSync } from "node:fs";
import { buildSandboxCommand, SandboxError, type SandboxSpec } from "./bwrap.js";

export const SANDBOX_RELAY_PORT = 18787;

export async function isSandboxAvailable(bwrapPath = "/usr/bin/bwrap"): Promise<boolean> {
  if (process.platform !== "linux") return false;
  try {
    const links: string[] = [];
    for (const name of ["bin", "sbin", "lib", "lib64"]) {
      try { if (lstatSync(`/${name}`).isSymbolicLink()) links.push("--symlink", `usr/${name}`, `/${name}`); } catch { /* Optional system link. */ }
    }
    const result = await startProcess({ command: bwrapPath,
      args: ["--unshare-all", "--die-with-parent", "--new-session", "--clearenv", "--ro-bind", "/usr", "/usr",
        ...links,
        "--proc", "/proc", "--dev", "/dev", "--", "/usr/bin/true"],
      cwd: "/", env: { PATH: "/usr/bin:/bin" }, timeoutMs: 5_000, maxOutputBytes: 0,
    }).result;
    return result.exitCode === 0 && !result.timedOut && result.groupGone;
  } catch { return false; }
}

export function startSandboxed(options: {
  spec: SandboxSpec; timeoutMs?: number; maxOutputBytes?: number; onOutput?: RunOptions["onOutput"];
}): RunHandle {
  if (process.platform !== "linux") throw new SandboxError("unavailable");
  // Validate the original command even when the relay will wrap it.
  let built = buildSandboxCommand(options.spec);
  if (options.spec.socket) {
    // Callers must mount the Node install at /opt/node and relay-main.js at /opt/factory/relay.js.
    const binds = options.spec.readOnlyBinds;
    if (!binds.some((bind) => bind.guest === "/opt/node") || !binds.some((bind) => bind.guest === "/opt/factory/relay.js"))
      throw new SandboxError("invalid-spec");
    built = buildSandboxCommand({ ...options.spec, command: "/opt/node/bin/node",
      args: ["/opt/factory/relay.js", "--listen", String(SANDBOX_RELAY_PORT), "--socket", options.spec.socket.guest,
        "--", options.spec.command, ...options.spec.args] });
  }
  return startProcess({ ...built, cwd: options.spec.workspace, env: { PATH: "/usr/bin:/bin" },
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.maxOutputBytes === undefined ? {} : { maxOutputBytes: options.maxOutputBytes }),
    ...(options.onOutput === undefined ? {} : { onOutput: options.onOutput }),
  });
}
