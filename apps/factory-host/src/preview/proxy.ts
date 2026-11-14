import { randomBytes } from "node:crypto";
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import { createConnection } from "node:net";
import type { Duplex } from "node:stream";

export const previewHeaders = {
  "content-security-policy": "sandbox allow-scripts",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
};

export const isPreviewPath = (url: string | undefined): boolean => /^\/preview(?:\/|\?|$)/.test(url ?? "");
const hopHeaders = ["connection", "keep-alive", "proxy-connection", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"];
const forbidden = ["cookie", "authorization", "x-csrf-token", "origin", "referer"];

function filtered(headers: IncomingHttpHeaders, request: boolean): IncomingHttpHeaders {
  const drop = new Set([...hopHeaders, ...(headers.connection ?? "").split(",").map((name) => name.trim().toLowerCase()),
    // Agent content must not set cookies on the Host either.
    ...(request ? forbidden : ["set-cookie"])]);
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !drop.has(name)));
}

interface Target {
  port: number;
  http: Set<() => void>;
  upgrades: Set<() => void>;
}
export interface PreviewProxy {
  viewUrl: string;
  activate(port: number): void;
  close(): void;
}

/** Capability URLs never enter errors or logs. Only the guarded service status exposes viewUrl. */
export function createPreviewProxy() {
  const targets = new Map<string, Target>();
  function create() {
    const token = randomBytes(32).toString("base64url");
    const prefix = `/preview/${token}`;
    let target: Target | null = null;
    return {
      viewUrl: `${prefix}/`,
      activate(port: number): void {
        target = { port, http: new Set(), upgrades: new Set() };
        targets.set(token, target);
      },
      close(): void {
        targets.delete(token);
        if (target) for (const cancel of [...target.http, ...target.upgrades]) cancel();
        target = null;
      },
    };
  }

  const lookup = (url: string | undefined) => {
    const match = /^\/preview\/([A-Za-z0-9_-]{43})(?=\/|\?|$)/.exec(url ?? "");
    const target = match ? targets.get(match[1]!) : undefined;
    if (!match || !target) return null;
    const prefix = match[0];
    const rest = url!.slice(prefix.length);
    return { target, prefix, rest, path: rest.startsWith("/") ? rest : `/${rest}` };
  };
  const responseHeaders = (headers: IncomingHttpHeaders, port: number, prefix: string): IncomingHttpHeaders => {
    const result = filtered(headers, false);
    const location = result.location;
    const origin = `http://127.0.0.1:${port}`;
    if (location?.startsWith("/")) result.location = `${prefix}${location}`;
    else if (location?.startsWith(`${origin}/`)) result.location = `${prefix}${location.slice(origin.length)}`;
    return { ...result, ...previewHeaders };
  };

  function handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const send = (code: number): void => { res.writeHead(code, previewHeaders); res.end(); };
    const found = lookup(req.url);
    if (!found) return send(404);
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      return send(405);
    }
    const { target, prefix, path, rest } = found;
    if (!rest.startsWith("/")) {
      res.setHeader("Location", `${prefix}/${rest}`);
      return send(302);
    }
    if (target.http.size >= 64) return send(503);
    const upstream = httpRequest({ hostname: "127.0.0.1", port: target.port, method: req.method, path, agent: false,
      headers: { ...filtered(req.headers, true), host: `127.0.0.1:${target.port}` } });
    let response: IncomingMessage | undefined;
    let headerTimer: ReturnType<typeof setTimeout> | undefined;
    const connectTimer = setTimeout(() => fail(504), 5_000);
    const clearTimers = (): void => { clearTimeout(connectTimer); clearTimeout(headerTimer); };
    const cancel = (): void => { clearTimers(); upstream.destroy(); response?.destroy(); res.destroy(); target.http.delete(cancel); };
    const fail = (code: number): void => {
      clearTimers();
      upstream.destroy(); response?.destroy();
      if (!res.headersSent) send(code); else res.destroy();
    };
    target.http.add(cancel);
    res.once("close", cancel);
    res.once("finish", () => { clearTimers(); target.http.delete(cancel); });
    req.once("aborted", cancel);
    req.once("error", cancel);
    res.once("error", cancel);
    upstream.once("socket", (socket) => socket.once("connect", () => {
      clearTimeout(connectTimer);
      headerTimer = setTimeout(() => fail(504), 30_000);
    }));
    upstream.once("error", () => fail(502));
    upstream.once("response", (incoming) => {
      clearTimers(); response = incoming;
      res.writeHead(incoming.statusCode ?? 502, responseHeaders(incoming.headers, target.port, prefix));
      incoming.once("error", () => res.destroy());
      incoming.once("aborted", () => res.destroy());
      incoming.pipe(res);
    });
    req.pipe(upstream);
  }

  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, hostAllowed: boolean): void {
    const reject = (code: number): void => {
      const reason = { 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed", 503: "Service Unavailable", 502: "Bad Gateway", 504: "Gateway Timeout" }[code];
      socket.end(`HTTP/1.1 ${code} ${reason}\r\n${Object.entries(previewHeaders).map(([name, value]) => `${name}: ${value}\r\n`).join("")}Connection: close\r\nContent-Length: 0\r\n\r\n`, () => socket.destroy());
    };
    socket.on("error", () => socket.destroy());
    if (!hostAllowed) return reject(403);
    const found = lookup(req.url);
    if (!found) return reject(404);
    if (req.method !== "GET" || req.headers.upgrade?.toLowerCase() !== "websocket") return reject(405);
    const { target, prefix, path, rest } = found;
    if (!rest.startsWith("/")) return reject(404);
    if (target.upgrades.size >= 20) return reject(503);
    const upstream = createConnection({ host: "127.0.0.1", port: target.port });
    let headerTimer: ReturnType<typeof setTimeout> | undefined;
    let failed = false;
    const connectTimer = setTimeout(() => fail(504), 5_000);
    const clearTimers = (): void => { clearTimeout(connectTimer); clearTimeout(headerTimer); };
    const cancel = (): void => { clearTimers(); upstream.destroy(); socket.destroy(); target.upgrades.delete(cancel); };
    const fail = (code: number): void => {
      if (failed) return;
      failed = true; clearTimers(); upstream.destroy(); reject(code);
    };
    target.upgrades.add(cancel);
    socket.once("close", cancel);
    socket.once("error", cancel);
    upstream.once("error", () => { if (handshakeDone) cancel(); else fail(502); });
    upstream.once("end", () => { if (!handshakeDone) fail(502); });
    upstream.once("close", () => { if (handshakeDone) cancel(); else fail(502); });
    upstream.once("connect", () => {
      clearTimeout(connectTimer);
      headerTimer = setTimeout(() => fail(504), 30_000);
      const headers = { ...filtered(req.headers, true), host: `127.0.0.1:${target.port}`, connection: "Upgrade", upgrade: "websocket" };
      const lines = Object.entries(headers).flatMap(([name, value]) => value === undefined ? []
        : (Array.isArray(value) ? value : [value]).map((part) => `${name}: ${part}\r\n`));
      upstream.write(`${req.method} ${path} HTTP/1.1\r\n${lines.join("")}\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream);
    });
    // Only the bounded response header is collected; WebSocket frames and bodies stream untouched.
    let pending = Buffer.alloc(0);
    let handshakeDone = false;
    const readHead = (chunk: Buffer): void => {
      pending = Buffer.concat([pending, chunk]);
      const end = pending.indexOf("\r\n\r\n");
      if ((end < 0 && pending.length > 65_536) || end > 65_536) return fail(502);
      if (end < 0) return;
      const lines = pending.subarray(0, end).toString("latin1").split("\r\n");
      const status = lines.shift()!;
      if (!/^HTTP\/1\.[01] [1-5][0-9]{2}(?: [^\r\n]*)?$/.test(status)) return fail(502);
      const headers: IncomingHttpHeaders = {};
      for (const line of lines) {
        const colon = line.indexOf(":");
        if (colon <= 0) return fail(502);
        const name = line.slice(0, colon).toLowerCase();
        if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name)) return fail(502);
        const value = line.slice(colon + 1).trim();
        if (/[\x00-\x08\x0a-\x1f\x7f]/.test(value)) return fail(502);
        headers[name] = headers[name] === undefined ? value : `${headers[name]}, ${value}`;
      }
      const outgoing = responseHeaders(headers, target.port, prefix);
      if (/^HTTP\/1\.[01] 101(?: |$)/.test(status)) {
        outgoing.connection = "Upgrade"; outgoing.upgrade = "websocket";
      } else outgoing.connection = "close";
      clearTimers(); handshakeDone = true;
      upstream.off("data", readHead);
      socket.write(`${status}\r\n${Object.entries(outgoing).map(([name, value]) => `${name}: ${value}\r\n`).join("")}\r\n`, "latin1");
      socket.write(pending.subarray(end + 4));
      pending = Buffer.alloc(0);
      upstream.pipe(socket);
    };
    upstream.on("data", readHead);
  }

  return { create, handleHttp, handleUpgrade };
}
