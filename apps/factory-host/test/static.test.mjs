import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { API_VERSION, failureResponseSchema } from "@factory/contracts";
import { createApiServer, createRoutes, registerStaticUi } from "../dist/api/index.js";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { EventHub } from "../dist/events/hub.js";
import { createBootstrapGate, createSessionStore } from "../dist/identity/index.js";
import { openStorage } from "../dist/storage/database.js";

const host = "127.0.0.1:8787";
const origin = `http://${host}`;
const indexHtml = "<!doctype html><html><body>Factory UI<script src='/assets/app-abc123.js'></script></body></html>";
const secret = "outside-ui-secret-marker";
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));

async function fixture(t, { configure } = {}) {
  const root = await mkdtemp(join(tmpdir(), "factory-static-"));
  const dir = join(root, "ui");
  let app;
  let storage;
  t.after(async () => {
    try { await app?.close(); } finally {
      storage?.close();
      assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + "factory-static-"));
      await rm(root, { recursive: true, force: true });
    }
  });
  await mkdir(join(dir, "assets"), { recursive: true });
  await mkdir(join(dir, "nested"));
  await writeFile(join(dir, "index.html"), indexHtml);
  await writeFile(join(dir, "assets", "app-abc123.js"), "console.log('Factory');");
  await writeFile(join(dir, "assets", "app.css"), "body { color: black; }");
  await writeFile(join(dir, "favicon.ico"), Buffer.from([0, 0, 1, 0]));
  await writeFile(join(dir, "nested", "hello.txt"), "nested content");
  await writeFile(join(root, "x"), secret);
  await configure?.({ dir, root });
  storage = openStorage(":memory:");
  storage.migrate({ migrationsDir, backupDir: null });
  const hub = new EventHub(storage.raw);
  const pipeline = createCommandPipeline({ storage, hub });
  const gate = createBootstrapGate();
  const token = gate.token;
  const routes = createRoutes({ storage, hub, pipeline });
  app = createApiServer({ origins: [origin], gate, sessions: createSessionStore(),
    register(app, guards) {
      routes(app, guards);
      registerStaticUi(app, { dir });
    },
  });
  await app.ready();
  return { app, dir, root, token, request(url, options = {}) {
    return app.inject({ url, ...options, headers: { host, ...options.headers } });
  } };
}

function failure(response, status, code) {
  assert.equal(response.statusCode, status);
  assert.match(response.headers["content-type"], /^application\/json/);
  const body = response.json();
  assert.deepEqual(failureResponseSchema.parse(body), body);
  assert.equal(body.error.code, code);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.body.includes(secret), false);
  return body;
}

async function bootstrap(f) {
  const response = await f.request("/auth/bootstrap", { method: "POST", payload: { token: f.token },
    headers: { origin, "content-type": "application/json" } });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["set-cookie"], /Path=\/; HttpOnly; SameSite=Strict/);
  return { cookie: response.headers["set-cookie"].split(";")[0], csrf: response.json().csrfToken };
}

function rawRequest(port, path) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port, path, headers: { host } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("error", reject);
      response.on("end", () => resolve({ statusCode: response.statusCode, headers: response.headers, body,
        json: () => JSON.parse(body) }));
    });
    request.on("error", reject);
    request.end();
  });
}

test("root and extensionless SPA paths serve no-store HTML with strict headers", async (t) => {
  const f = await fixture(t);
  for (const url of ["/", "/index.html", "/settings", "/p/123/chat?tab=chat", "/settings/profile/"]) {
    const response = await f.request(url);
    assert.equal(response.statusCode, 200, url);
    assert.equal(response.body, indexHtml);
    assert.equal(response.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers["content-security-policy"], csp);
    assert.equal(response.headers["x-frame-options"], "DENY");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.equal(response.headers["referrer-policy"], "no-referrer");
    assert.equal(response.headers["cross-origin-resource-policy"], "same-origin");
    assert.ok(Object.keys(response.headers).every((name) => !name.startsWith("access-control-")));
  }
});

test("hashed assets are immutable, other files are no-store, and MIME types are fixed", async (t) => {
  const more = { "code.mjs": "text/javascript", "data.json": "application/json", "image.svg": "image/svg+xml",
    "image.png": "image/png", "image.jpg": "image/jpeg", "font.woff2": "font/woff2",
    "code.js.map": "application/json", "unknown.bin": "application/octet-stream" };
  const f = await fixture(t, { async configure({ dir }) {
    for (const file of Object.keys(more)) await writeFile(join(dir, file), "test content");
    await writeFile(join(dir, "outside-abc123.js"), "unhashed directory");
  } });
  const files = { "assets/app-abc123.js": "text/javascript", "assets/app.css": "text/css",
    "favicon.ico": "image/x-icon", "nested/hello.txt": "text/plain", "outside-abc123.js": "text/javascript", ...more };
  for (const [file, type] of Object.entries(files)) {
    const response = await f.request(`/${file}?v=1`);
    assert.equal(response.statusCode, 200, file);
    assert.equal(response.headers["content-type"].split(";")[0], type);
    assert.equal(response.headers["cache-control"], file === "assets/app-abc123.js"
      ? "public, max-age=31536000, immutable" : "no-store", file);
    assert.equal(response.headers["x-content-type-options"], "nosniff");
  }
  assert.equal((await f.request("/nested/hello.txt")).body, "nested content");
  assert.equal((await f.request("/nested/%68ello.txt")).body, "nested content");
});

test("HEAD preserves content headers and other methods never serve static files", async (t) => {
  const f = await fixture(t);
  for (const url of ["/", "/settings", "/assets/app-abc123.js"]) {
    const get = await f.request(url);
    const head = await f.request(url, { method: "HEAD" });
    assert.equal(head.statusCode, 200);
    assert.equal(head.body, "");
    for (const header of ["content-type", "content-length", "cache-control", "content-security-policy", "x-frame-options"])
      assert.equal(head.headers[header], get.headers[header], header);
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE"])
    failure(await f.request("/assets/app-abc123.js", { method, ...(method === "POST" ? { payload: {} } : {}) }), 404, "not-found");
  failure(await f.request("/assets/app-abc123.js", { method: "OPTIONS" }), 405, "unsupported");
});

test("API routes and reserved prefixes retain JSON errors even when UI files exist there", async (t) => {
  const f = await fixture(t, { async configure({ dir }) {
    await mkdir(join(dir, "api"));
    await writeFile(join(dir, "api", "client.js"), "must not be served");
  } });
  const session = await bootstrap(f);
  assert.equal((await f.request("/health")).json().ok, true);
  const projects = await f.request("/projects", { headers: { cookie: session.cookie } });
  assert.deepEqual(projects.json(), { apiVersion: API_VERSION, ok: true, projects: [] });
  failure(await f.request("/projects"), 401, "needs-auth");
  for (const url of ["/auth", "/auth/unknown", "/commands", "/commands/unknown", "/projects/unknown?tab=chat",
    "/health/missing", "/api", "/api/client.js", "/%61pi/client.js"])
    failure(await f.request(url, { headers: { cookie: session.cookie } }), 404, "not-found");
  const unknown = await f.request(`/projects/${randomUUID()}/tasks`, { headers: { cookie: session.cookie } });
  assert.equal(failure(unknown, 404, "not-found").error.message, "Project not found.");
});

test("bootstrap and command CSRF checks work on the same origin as the UI", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request("/")).statusCode, 200);
  const session = await bootstrap(f);
  const payload = { apiVersion: API_VERSION, commandId: randomUUID(), projectId: randomUUID(), type: "projects.create",
    payload: { name: "UI project", workspace: { kind: "directory", root: "/workspace/ui" } } };
  const headers = { cookie: session.cookie, origin, "x-csrf-token": session.csrf };
  failure(await f.request("/commands", { method: "POST", payload, headers: { ...headers, "x-csrf-token": "wrong" } }), 403, "forbidden");
  failure(await f.request("/commands", { method: "POST", payload, headers: { ...headers, origin: "http://evil.test" } }), 403, "forbidden");
  const result = await f.request("/commands", { method: "POST", payload, headers });
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().ok, true);
  const projects = await f.request("/projects", { headers: { cookie: session.cookie } });
  assert.equal(projects.json().projects[0].id, payload.projectId);
});

test("Host header protection applies to static paths and failures", async (t) => {
  const f = await fixture(t);
  for (const url of ["/", "/assets/app-abc123.js", "/settings", "/missing.js", "/%2e%2e/x"])
    failure(await f.request(url, { headers: { host: "evil.test" } }), 403, "forbidden");
});

test("raw and encoded traversal never expose files outside the UI directory", async (t) => {
  const f = await fixture(t);
  await f.app.listen({ host: "127.0.0.1", port: 0 });
  const port = f.app.server.address().port;
  const paths = ["/../x", "/%2e%2e/x", "/%2E%2E%2fx", "/..%5cx", "/a%00b", "//etc/passwd",
    "/assets/../../x", "/%252e%252e/x", "/%252E%252E%252Fx", "/%255c..%255cx",
    "/%25252e%25252e/x", "/%25%32%65%25%32%65/x", "/%2525%2532%2565%2525%2532%2565/x",
    "/assets%2f..%2fx", "/assets/..\\..\\x",
    "/C:%5csecret", "/nested/a%", "/assets/%ff"];
  for (const url of paths) {
    // app.inject's URL parser removes dot segments before dispatch; HTTP preserves the attack bytes.
    const response = await rawRequest(port, url);
    assert.ok([400, 404].includes(response.statusCode), `${url}: ${response.statusCode}`);
    failure(response, response.statusCode, response.statusCode === 400 ? "validation" : "not-found");
  }
});

test("symlink escapes are JSON 404s, including extensionless links", async (t) => {
  const f = await fixture(t);
  try {
    await symlink(join(f.root, "x"), join(f.dir, "linked.txt"), "file");
    await symlink(join(f.root, "x"), join(f.dir, "linked"), "file");
    await symlink(f.root, join(f.dir, "outside"), "junction");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS", "ENOTSUP"].includes(error.code)) {
      t.skip(`OS refuses symlink creation: ${error.code}`);
      return;
    }
    throw error;
  }
  for (const url of ["/linked.txt", "/linked", "/outside/x", "/outside", "/outside/"])
    failure(await f.request(url), 404, "not-found");
});

test("directory symlink escapes are blocked and internal directory links stay inside the UI", async (t) => {
  const f = await fixture(t);
  try {
    // Junctions let Windows exercise realpath containment without file-symlink privileges.
    await symlink(f.root, join(f.dir, "outside"), "junction");
    await symlink(join(f.dir, "nested"), join(f.dir, "inside"), "junction");
    await symlink(join(f.root, "missing-target"), join(f.dir, "dangling"), "junction");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS", "ENOTSUP"].includes(error.code)) {
      t.skip(`OS refuses directory symlink creation: ${error.code}`);
      return;
    }
    throw error;
  }
  for (const url of ["/outside/x", "/outside", "/outside/", "/outside/missing", "/dangling", "/dangling/missing"])
    failure(await f.request(url), 404, "not-found");
  assert.equal((await f.request("/inside/hello.txt")).body, "nested content");
  assert.equal((await f.request("/inside/missing")).body, indexHtml);
});

test("missing files, directories, and oversized files never fall back to HTML", async (t) => {
  const f = await fixture(t, { async configure({ dir }) {
    await writeFile(join(dir, "large.js"), Buffer.alloc(5 * 1024 * 1024 + 1));
    await writeFile(join(dir, "large"), Buffer.alloc(5 * 1024 * 1024 + 1));
    await writeFile(join(dir, "limit.txt"), Buffer.alloc(5 * 1024 * 1024, "x"));
  } });
  for (const url of ["/missing.js", "/missing.css", "/missing.map", "/missing.png", "/assets/missing-abc123.js",
    "/assets/", "/assets", "/nested/", "/large.js", "/large"])
    failure(await f.request(url), 404, "not-found");
  const limit = await f.request("/limit.txt");
  assert.equal(limit.statusCode, 200);
  assert.equal(limit.rawPayload.length, 5 * 1024 * 1024);
  assert.equal((await f.request("/missing-extensionless")).body, indexHtml);
  await writeFile(join(f.dir, "index.html"), Buffer.alloc(5 * 1024 * 1024 + 1));
  failure(await f.request("/"), 404, "not-found");
});
