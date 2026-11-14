import { isIP } from "node:net";
import type { FastifyInstance } from "fastify";

export async function listenLoopback(app: FastifyInstance, port: number, host = "127.0.0.1"): Promise<number> {
  if (host !== "127.0.0.1" && host !== "::1") throw new Error("Host must be a loopback IP literal");
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error("Invalid listen port");
  await app.listen({ port, host });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("Loopback listener has no TCP address");
  return address.port;
}

const hostName = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)$/;

/** Origins the Host accepts: loopback, plus the extra names or IPs it is reached by (FACTORY_LISTEN_HOST, FACTORY_ALLOWED_HOSTS). */
export function originsFor(port: number, extraHosts: readonly string[] = []): string[] {
  for (const name of extraHosts) if (!hostName.test(name)) throw new Error("Invalid allowed host name");
  return [...new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...extraHosts.map((name) => `http://${name}:${port}`)])];
}

export const isLoopbackHost = (host: string): boolean => host === "127.0.0.1" || host === "::1";

/** Listens on one explicit address. A network address is allowed only here; callers must also require a login token. */
export async function listenOn(app: FastifyInstance, port: number, host: string): Promise<number> {
  if (isLoopbackHost(host)) return listenLoopback(app, port, host);
  if (isIP(host) === 0) throw new Error("FACTORY_LISTEN_HOST must be an IP address");
  if (host === "0.0.0.0" || host === "::") throw new Error("Listen on one specific address, not on all interfaces");
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error("Invalid listen port");
  await app.listen({ port, host });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("Listener has no TCP address");
  return address.port;
}
