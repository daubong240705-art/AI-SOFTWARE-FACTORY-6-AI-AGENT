import type { FastifyInstance } from "fastify";

export async function listenLoopback(app: FastifyInstance, port: number, host = "127.0.0.1"): Promise<number> {
  if (host !== "127.0.0.1" && host !== "::1") throw new Error("Host must be a loopback IP literal");
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error("Invalid listen port");
  await app.listen({ port, host });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("Loopback listener has no TCP address");
  return address.port;
}

export function originsFor(port: number): string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
}
