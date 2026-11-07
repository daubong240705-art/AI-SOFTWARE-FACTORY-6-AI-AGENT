import { parseEnv, startHost } from "./host.js";

try {
  const host = await startHost({ ...parseEnv(process.env), onBootstrapToken(token) {
    process.stdout.write(`One-time bootstrap token: ${token}\n`);
  } });
  process.stdout.write(`Factory Host listening on http://127.0.0.1:${host.port}\n`);
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    void host.close().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; });
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Host startup failed"}\n`);
  process.exitCode = 1;
}
