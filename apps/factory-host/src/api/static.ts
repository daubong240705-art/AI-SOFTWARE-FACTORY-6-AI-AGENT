import type { FastifyInstance, FastifyReply } from "fastify";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { createIdGenerator } from "../ids.js";
import { failure } from "./http.js";

const maxFileSize = 5 * 1024 * 1024;
const apiPrefixes = ["/auth", "/commands", "/projects", "/health", "/api", "/preview"];
const encodedSeparators = /%(?:2e|2f|5c)/i;
const hashedAsset = /^assets\/.*-[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9]+)+$/;
const contentTypes: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".ico": "image/x-icon", ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8", ".map": "application/json; charset=utf-8",
};
const htmlPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

function inside(dir: string, file: string): boolean {
  const path = relative(dir, file);
  return !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`);
}

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

/** Register an encapsulated plugin so startup awaits validation and API routes retain precedence. */
export function registerStaticUi(app: FastifyInstance, options: { dir: string }): void {
  app.register(async (ui) => {
    let dir: string;
    try {
      dir = await realpath(options.dir);
      const index = await realpath(resolve(dir, "index.html"));
      if (!(await stat(dir)).isDirectory() || !inside(dir, index) || !(await stat(index)).isFile())
        throw new Error("Invalid UI directory");
    } catch {
      throw new Error("UI directory must be an existing directory containing a regular index.html inside it");
    }
    const newId = createIdGenerator();
    const immutable = new WeakSet<FastifyReply>();
    // Encapsulated hooks run after the parent's global no-store security hook.
    ui.addHook("onSend", async (_request, reply, payload) => {
      if (reply.statusCode === 200 && immutable.has(reply))
        reply.header("Cache-Control", "public, max-age=31536000, immutable");
      return payload;
    });

    const missingInside = async (path: string): Promise<boolean> => {
      // Missing children of an external or dangling symlink must not become SPA routes.
      let ancestor = path;
      while (inside(dir, ancestor)) {
        try { await lstat(ancestor); } catch (error) {
          if (!missing(error) || ancestor === dir) return false;
          ancestor = dirname(ancestor);
          continue;
        }
        try { return inside(dir, await realpath(ancestor)); } catch { return false; }
      }
      return false;
    };
    const read = async (path: string): Promise<Buffer | "missing" | "not-found"> => {
      let file: string;
      try { file = await realpath(path); } catch (error) {
        return missing(error) && await missingInside(path) ? "missing" : "not-found";
      }
      if (!inside(dir, file)) return "not-found";
      try {
        if (!(await stat(file)).isFile()) return "not-found";
        const handle = await open(file, "r");
        try {
          const info = await handle.stat();
          if (!info.isFile() || info.size > maxFileSize) return "not-found";
          // One extra byte detects growth without ever reading an unbounded file.
          const content = Buffer.alloc(info.size + 1);
          let length = 0;
          while (length < content.length) {
            const { bytesRead } = await handle.read(content, length, content.length - length, null);
            if (bytesRead === 0) break;
            length += bytesRead;
          }
          return length > info.size ? "not-found" : content.subarray(0, length);
        } finally { await handle.close(); }
      } catch { return "not-found"; }
    };

    for (const url of ["/", "/*"]) {
      // Fastify supplies HEAD for each GET route, preserving the same headers.
      ui.get(url, async (request, reply) => {
        const rawPath = (request.raw.url ?? "").split("?", 1)[0] ?? "";
        let path: string;
        try { path = decodeURIComponent(rawPath); } catch {
          return failure(reply, 400, "validation", "Invalid request path.", "correct-input", newId);
        }
        if (!path.startsWith("/") || path.includes("//") || /[\0\\:]/.test(path)
          // Reject residual escapes after the single decode, including split and nested encodings.
          || path.split("/").includes("..") || encodedSeparators.test(rawPath) || /%[0-9a-f]{2}/i.test(path))
          return failure(reply, 400, "validation", "Invalid request path.", "correct-input", newId);
        const notFound = (): FastifyReply => failure(reply, 404, "not-found", "Route not found.", "correct-input", newId);
        if (apiPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return notFound();
        let name = path === "/" ? "index.html" : path.slice(1);
        const file = resolve(dir, name);
        if (!inside(dir, file)) return notFound();
        let content = await read(file);
        if (content === "missing" && extname(path) === "") {
          name = "index.html";
          content = await read(resolve(dir, name));
        }
        if (typeof content === "string") return notFound();
        const extension = extname(name).toLowerCase();
        reply.type(contentTypes[extension] ?? "application/octet-stream");
        reply.header("Cache-Control", "no-store");
        if (hashedAsset.test(name)) immutable.add(reply);
        if (extension === ".html") {
          reply.header("Content-Security-Policy", htmlPolicy);
          reply.header("X-Frame-Options", "DENY");
        }
        return reply.send(content);
      });
    }
  });
}
