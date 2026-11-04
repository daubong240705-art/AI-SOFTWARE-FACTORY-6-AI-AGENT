import { createServer, request as httpRequest, type Server } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFile } from "node:fs/promises";
import { rootCertificates } from "node:tls";
import { randomBytes } from "node:crypto";
import type { Settings } from "../../shared/contracts";

export class ModelProxy {
  readonly token = randomBytes(32).toString("hex");
  private server?: Server;
  private requests = 0;
  private pending = new Set<ReturnType<typeof httpRequest>>();
  constructor(
    private settings: Settings,
    private key: string | undefined,
    private model: string,
    private onRequest: (count: number) => void,
  ) {}
  async start(): Promise<string> {
    const endpoint = new URL(
      this.settings.gatewayUrl.replace(/\/+$/, "") + "/chat/completions",
    );
    const ca = this.settings.caPath
      ? [...rootCertificates, await readFile(this.settings.caPath, "utf8")]
      : undefined;
    this.server = createServer(async (req, res) => {
      const fail = (status: number, message: string) => {
        if (res.destroyed || res.writableEnded) return;
        if (!res.headersSent)
          res.writeHead(status, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ error: { message, type: "worker_gateway_error" } }),
        );
      };
      if (req.headers.authorization !== `Bearer ${this.token}`) {
        fail(401, "Invalid execution token");
        return;
      }
      if (req.url !== "/v1/chat/completions" || req.method !== "POST") {
        fail(404, "Endpoint denied");
        return;
      }
      try {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 8 * 1024 * 1024) {
            fail(413, "Prompt exceeds 8 MB");
            return;
          }
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (
          body.model !== this.model ||
          (body.n !== undefined && body.n !== 1)
        ) {
          fail(403, "Model mismatch");
          return;
        }
        if (this.requests >= this.settings.maxRequests) {
          fail(403, "execution_request_limit_exceeded");
          return;
        }
        this.requests++;
        this.onRequest(this.requests);
        if (body.max_tokens !== undefined)
          body.max_tokens = Math.min(8192, Number(body.max_tokens) || 8192);
        else body.max_tokens = 8192;
        if (body.max_completion_tokens !== undefined)
          body.max_completion_tokens = Math.min(
            8192,
            Number(body.max_completion_tokens) || 8192,
          );
        const payload = Buffer.from(JSON.stringify(body));
        const upstream = (
          endpoint.protocol === "https:" ? httpsRequest : httpRequest
        )(
          endpoint,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "content-length": payload.length,
              ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}),
            },
            ...(endpoint.protocol === "https:"
              ? { ca, rejectUnauthorized: true }
              : {}),
          },
          (response) => {
            if (response.statusCode !== 200) {
              response.resume();
              const status = response.statusCode ?? 502;
              fail(
                status >= 300 && status < 400 ? 502 : status,
                status === 401 || status === 403
                  ? "Gateway authentication rejected"
                  : status === 429
                    ? "Gateway rate limit"
                    : `Gateway HTTP ${status}`,
              );
              return;
            }
            res.writeHead(200, {
              "content-type":
                response.headers["content-type"] ?? "application/json",
              "cache-control": "no-cache",
            });
            let output = 0;
            response.on("data", (chunk: Buffer) => {
              output += chunk.length;
              if (output > 16 * 1024 * 1024)
                upstream.destroy(new Error("Response too large"));
            });
            response.on("error", () => res.destroy());
            response.pipe(res);
          },
        );
        this.pending.add(upstream);
        upstream.setTimeout(90000, () =>
          upstream.destroy(new Error("Gateway timeout")),
        );
        upstream.on("close", () => this.pending.delete(upstream));
        upstream.on("error", () => fail(502, "Gateway network or TLS error"));
        res.on("close", () => upstream.destroy());
        upstream.end(payload);
      } catch {
        fail(400, "Invalid model request");
      }
    });
    this.server.requestTimeout = 120000;
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", resolve);
    });
    const address = this.server.address();
    if (!address || typeof address === "string")
      throw new Error("Không mở được proxy model local.");
    return `http://127.0.0.1:${address.port}/v1`;
  }
  async close(): Promise<void> {
    for (const req of this.pending) req.destroy();
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => {
      if (this.server?.listening) this.server.close(() => resolve());
      else resolve();
    });
    this.key = undefined;
  }
}
