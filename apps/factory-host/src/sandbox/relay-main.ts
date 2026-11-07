import { spawn } from "node:child_process";
import { createConnection, createServer, type Socket } from "node:net";
import { constants } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function startRelay(options: {
  listenPort: number; socketPath: string; maxConnections?: number;
}): Promise<{ port: number; close(): Promise<void> }> {
  const { listenPort, socketPath, maxConnections = 64 } = options;
  if (!Number.isSafeInteger(listenPort) || listenPort < 0 || listenPort > 65_535
    || typeof socketPath !== "string" || !isAbsolute(socketPath) || /[\0\r\n]/.test(socketPath)
    || !Number.isSafeInteger(maxConnections) || maxConnections < 1) throw new Error("Invalid relay configuration");
  const active = new Set<Socket>();
  let closing = false;
  let closePromise: Promise<void> | undefined;
  const server = createServer({ allowHalfOpen: true }, (client) => {
    if (closing || active.size >= maxConnections) { client.destroy(); return; }
    active.add(client);
    const upstream = createConnection({ path: socketPath, allowHalfOpen: true });
    const destroy = (): void => { client.destroy(); upstream.destroy(); };
    client.on("error", destroy); upstream.on("error", destroy);
    client.once("close", () => { active.delete(client); destroy(); });
    upstream.once("close", () => {
      // A clean upstream EOF can precede the TCP write queue draining.
      if (upstream.readableEnded && client.writableEnded && !client.writableFinished) client.once("finish", destroy);
      else destroy();
    });
    // pipe handles backpressure without buffering complete requests or SSE responses.
    client.pipe(upstream); upstream.pipe(client);
  });
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(listenPort, "127.0.0.1", () => { server.off("error", reject); done(); });
  }).catch(() => { throw new Error("Relay unavailable"); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Relay unavailable");
  return { port: address.port, close() {
    closePromise ??= new Promise<void>((done, reject) => {
      closing = true;
      server.close((error) => error ? reject(new Error("Relay close failed")) : done());
      for (const client of active) client.destroy();
    });
    return closePromise;
  } };
}

async function main(args: string[]): Promise<number> {
  let port: number | undefined;
  let socket: string | undefined;
  let offset = 0;
  while (offset < args.length && args[offset] !== "--") {
    const flag = args[offset++];
    const value = args[offset++];
    if (flag === "--listen" && port === undefined && value !== undefined && /^[0-9]+$/.test(value)
      && Number(value) >= 1 && Number(value) <= 65_535) port = Number(value);
    else if (flag === "--socket" && socket === undefined && value !== undefined && isAbsolute(value) && !/[\0\r\n]/.test(value)) socket = value;
    else return 2;
  }
  if (port === undefined || socket === undefined || args[offset++] !== "--" || !args[offset]) return 2;
  const command = args[offset++];
  if (!command || command.includes("\0") || args.slice(offset).some((arg) => arg.includes("\0"))) return 2;
  let relay: Awaited<ReturnType<typeof startRelay>>;
  try { relay = await startRelay({ listenPort: port, socketPath: socket }); } catch { return 1; }
  try {
    return await new Promise<number>((done) => {
      const child = spawn(command, args.slice(offset), { stdio: "inherit", shell: false });
      let pending: NodeJS.Signals | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stop = (signal: NodeJS.Signals): void => {
        pending = signal;
        child.kill(signal);
        timer ??= setTimeout(() => child.kill("SIGKILL"), 2_000);
      };
      const term = (): void => stop("SIGTERM");
      const interrupt = (): void => stop("SIGINT");
      process.on("SIGTERM", term); process.on("SIGINT", interrupt);
      const finish = (code: number): void => {
        if (timer) clearTimeout(timer);
        process.off("SIGTERM", term); process.off("SIGINT", interrupt);
        done(code);
      };
      child.once("error", () => finish(1));
      child.once("exit", (code, signal) => finish(signal ? 128 + (constants.signals[signal] ?? 0)
        : pending ? 128 + (constants.signals[pending] ?? 0) : code ?? 1));
    });
  } finally { await relay.close(); }
}

// The mounted entry is self-contained: it imports only Node builtins.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, () => { process.exitCode = 1; });
}
