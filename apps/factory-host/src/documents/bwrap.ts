import { basename, dirname, posix } from "node:path";

export const WORKER_TIMEOUT_MS = 120_000;
export const WORKER_STDOUT_BYTES = 8 * 1024 * 1024;
/** Pure builder: no probes, environment inheritance, network or writable host binds. */
export function buildDocumentCommand(spec: { python: string; script: string; input: string; media: string; prlimit?: boolean }) {
  const venv = posix.dirname(posix.dirname(spec.python));
  const args = ["--unshare-all", "--die-with-parent", "--new-session", "--clearenv", "--ro-bind", "/usr", "/usr"];
  for (const name of ["bin", "sbin", "lib", "lib64"]) args.push("--ro-bind-try", `/${name}`, `/${name}`);
  args.push("--ro-bind-try", "/etc/ld.so.cache", "/etc/ld.so.cache",
    "--proc", "/proc", "--dev", "/dev", "--size", String(256 * 1024 * 1024), "--tmpfs", "/tmp",
    "--ro-bind", venv, venv, "--ro-bind", dirname(spec.script), "/worker",
    "--ro-bind", spec.input, "/in/input", "--remount-ro", "/",
    "--setenv", "HOME", "/tmp", "--setenv", "TMPDIR", "/tmp", "--setenv", "LANG", "C.UTF-8",
    "--setenv", "PATH", "/usr/bin:/bin", "--setenv", "PYTHONDONTWRITEBYTECODE", "1", "--chdir", "/tmp", "--");
  if (spec.prlimit) args.push("/usr/bin/prlimit", "--as=2147483648", "--");
  args.push(spec.python, "-I", `/worker/${basename(spec.script)}`, "/in/input", spec.media);
  return { command: "/usr/bin/bwrap", args, timeoutMs: WORKER_TIMEOUT_MS };
}
