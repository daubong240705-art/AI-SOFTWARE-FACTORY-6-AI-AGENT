import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { startProcess } from "../dist/exec/process-group.js";
import { buildSandboxCommand, isSandboxAvailable, startSandboxed, SANDBOX_RELAY_PORT } from "../dist/sandbox/index.js";
import { assertInside, cloneProject, createWorktree, runGit } from "../dist/workspace/index.js";

const available = await isSandboxAvailable();
const integration = (name, fn) => test(name, { timeout: 30_000,
  skip: available ? false : "Real bubblewrap requires Linux with working user namespaces" }, fn);
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const relayFile = fileURLToPath(new URL("../dist/sandbox/relay-main.js", import.meta.url));

async function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "factory-sandbox-integration-")));
  t.after(() => { assert.ok(root.includes("factory-sandbox-integration-")); fs.rmSync(assertInside(fs.realpathSync(tmpdir()), root), { recursive: true, force: true }); });
  const source = join(root, "source"); fs.mkdirSync(source);
  await runGit(source, ["init", "--initial-branch=main", "--template="]);
  await runGit(source, ["config", "user.name", "Fixture"]); await runGit(source, ["config", "user.email", "fixture@localhost"]);
  fs.writeFileSync(join(source, "base.txt"), "base\n"); await runGit(source, ["add", "-A"]);
  const tree = (await runGit(source, ["write-tree"])).stdout.trim();
  const head = (await runGit(source, ["commit-tree", tree, "-m", "base"])).stdout.trim();
  await runGit(source, ["update-ref", "refs/heads/main", head]);
  const roots = { projectsRoot: join(root, "projects"), worktreesRoot: join(root, "worktrees"), stateDir: join(root, "state") };
  fs.mkdirSync(roots.stateDir); fs.writeFileSync(join(roots.stateDir, "private-marker"), "private");
  const project = await cloneProject(roots, { name: "Sandbox Project", source });
  const attempt = await createWorktree(roots, { projectRoot: project.root, projectSlug: project.slug, taskCode: "DEV-001", epoch: 1 });
  const common = join(project.root, ".git");
  const worktree = fs.readFileSync(join(attempt.path, ".git"), "utf8").trim().slice("gitdir: ".length);
  const nodeBinary = fs.realpathSync(process.execPath);
  const nodeRoot = dirname(dirname(nodeBinary));
  // Distro Node lives in /usr (already mounted); mounting that broad directory as a tool would be unsafe.
  const readOnlyBinds = nodeRoot === "/usr"
    ? [{ host: dirname(relayFile), guest: "/opt/factory-dist" }]
    : [{ host: nodeRoot, guest: "/opt/node" }];
  const spec = { bwrapPath: "/usr/bin/bwrap", workspace: attempt.path, roots,
    readOnlyBinds, gitDirs: { common, worktree }, env: {}, command: nodeRoot === "/usr" ? "/usr/bin/node" : "/opt/node/bin/node", args: [] };
  return { root, roots, source, project, attempt, spec, nodeBinary };
}
function launch(t, spec, options = {}) {
  const handle = startSandboxed({ spec, timeoutMs: 10_000, ...options });
  t.after(async () => { await handle.stop().catch(() => {}); await handle.result; }); return handle;
}
async function node(t, f, source, options = {}) {
  const result = await launch(t, { ...f.spec, args: ["-e", source] }, options).result;
  assert.equal(result.exitCode, 0, "sandbox command must succeed"); assert.equal(result.groupGone, true); return result;
}
function scanSleep(duration) {
  const found = [];
  for (const entry of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const args = fs.readFileSync(`/proc/${entry}/cmdline`).toString().split("\0");
      if ((args[0] === "sleep" || args[0] === "/usr/bin/sleep") && args[1] === duration) found.push(Number(entry));
    } catch (error) { if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error; }
  }
  return found;
}
async function until(predicate) {
  const deadline = performance.now() + 5_000;
  while (!predicate()) { assert.ok(performance.now() < deadline, "condition did not become true"); await delay(20); }
}

integration("real sandbox writes only the mounted worktree", async (t) => {
  const f = await fixture(t); await node(t, f, "require('node:fs').writeFileSync('created.txt','created')");
  assert.equal(fs.readFileSync(join(f.attempt.path, "created.txt"), "utf8"), "created");
});
integration("real sandbox system mounts resist writes and private temporary writes vanish", async (t) => {
  const f = await fixture(t); const name = `factory-sandbox-${randomUUID()}`;
  const result = await node(t, f, `const fs=require('node:fs'); const paths=${JSON.stringify([`/usr/${name}`, `/etc/${name}`, `/home/agent/${name}`, `/tmp/${name}`])};
    const outcomes=paths.map((p)=>{try{fs.writeFileSync(p,'private');return 'ok'}catch(e){return e.code}});process.stdout.write(JSON.stringify(outcomes))`);
  const outcomes = JSON.parse(result.stdout); assert.notEqual(outcomes[0], "ok"); assert.notEqual(outcomes[1], "ok");
  assert.equal(outcomes[2], "ok"); assert.equal(outcomes[3], "ok");
  for (const path of [`/usr/${name}`, `/etc/${name}`, `/home/agent/${name}`, `/tmp/${name}`]) assert.equal(fs.existsSync(path), false);
});
integration("real sandbox hides state, host home, other projects and worktrees, and drive mounts", async (t) => {
  const f = await fixture(t); const other = await cloneProject(f.roots, { name: "Other Project", source: f.source });
  const second = await createWorktree(f.roots, { projectRoot: f.project.root, projectSlug: f.project.slug, taskCode: "DEV-001", epoch: 2 });
  // Use a synthetic home file only; no existing home/config/auth contents are opened.
  const fakeHome = join(f.root, "synthetic-home"); fs.mkdirSync(fakeHome); const marker = join(fakeHome, "private-marker"); fs.writeFileSync(marker, "private");
  const paths = [join(f.roots.stateDir, "private-marker"), marker,
    join(other.root, "base.txt"), join(second.path, "base.txt"), "/mnt"];
  const result = await node(t, f, `const fs=require('node:fs');process.stdout.write(JSON.stringify(${JSON.stringify(paths)}.map(p=>{try{fs.statSync(p);return 'visible'}catch(e){return e.code}})))`);
  assert.deepEqual(JSON.parse(result.stdout), paths.map(() => "ENOENT"));
});
integration("real sandbox environment exactly matches the builder without inherited variables", async (t) => {
  const f = await fixture(t); f.spec.env = { ATTEMPT: "one", FACTORY_MODEL_TOKEN: "synthetic-attempt" };
  const expected = {};
  const args = buildSandboxCommand(f.spec).args;
  for (let i = 0; i < args.indexOf("--"); i++) if (args[i] === "--setenv") { expected[args[i + 1]] = args[i + 2]; i += 2; }
  // Run the wrapper in a test process with synthetic secrets; never read the actual Host env.
  const input = { ...f.spec, args: ["-e", "process.stdout.write(JSON.stringify(process.env))"] };
  const moduleUrl = new URL("../dist/sandbox/index.js", import.meta.url).href;
  const source = `import {startSandboxed} from ${JSON.stringify(moduleUrl)};const r=await startSandboxed({spec:${JSON.stringify(input)}}).result;process.stdout.write(r.stdout);process.exitCode=r.exitCode??1`;
  const result = await startProcess({ command: f.nodeBinary, args: ["--input-type=module", "-e", source], cwd: f.root,
    env: { PATH: "/usr/bin:/bin", NINE_ROUTER_API_KEY: "synthetic-host-only", AWS_SECRET_ACCESS_KEY: "synthetic-host-only",
      FACTORY_HOST_SENTINEL: "synthetic-host-only", NODE_OPTIONS: "--no-warnings", NODE_V8_COVERAGE: join(f.root, "coverage") },
    timeoutMs: 10_000 }).result;
  assert.equal(result.exitCode, 0);
  const observed = JSON.parse(result.stdout);
  // bwrap itself exports PWD for --chdir; it must be the workspace and is not one of the builder's variables.
  assert.equal(observed.PWD, f.attempt.path); delete observed.PWD;
  assert.deepEqual(Object.keys(observed).sort(), Object.keys(expected).sort());
  assert.ok(Object.entries(expected).every(([name, value]) => observed[name] === value), "guest environment must match exactly");
});
integration("real sandbox cannot connect to host loopback or a public address", async (t) => {
  const f = await fixture(t); const server = createServer((socket) => socket.destroy());
  await new Promise((done) => server.listen(0, "127.0.0.1", done)); t.after(() => new Promise((done) => server.close(done)));
  const result = await node(t, f, `const net=require('node:net'); const attempt=(host,port)=>new Promise(resolve=>{
    const s=net.createConnection({host,port});const finish=ok=>{s.destroy();resolve(ok)};s.setTimeout(500,()=>finish(false));s.once('error',()=>finish(false));s.once('connect',()=>finish(true));
  });Promise.all([attempt('127.0.0.1',${server.address().port}),attempt('1.1.1.1',80)]).then(r=>process.stdout.write(JSON.stringify(r)))`);
  assert.deepEqual(JSON.parse(result.stdout), [false, false]);
});
integration("real sandbox relay reaches only its bound socket and streams incrementally", async (t) => {
  const f = await fixture(t); const directory = join(f.root, "proxy"); fs.mkdirSync(directory, { mode: 0o700 });
  const socketPath = join(directory, "model.sock"); fs.writeFileSync(join(directory, "hidden"), "private");
  let release; const releaseReady = new Promise((done) => { release = done; });
  const server = createHttpServer(async (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" }); res.write("data: first\n\n");
    await releaseReady; res.end("data: last\n\n");
  });
  await new Promise((done) => server.listen(socketPath, done));
  t.after(() => { release(); server.closeAllConnections(); return new Promise((done) => server.close(done)); });
  // A minimal private Node prefix handles both distro and standalone installations.
  const prefix = join(f.root, "node-prefix"); fs.mkdirSync(join(prefix, "bin"), { recursive: true });
  fs.copyFileSync(f.nodeBinary, join(prefix, "bin", "node")); fs.chmodSync(join(prefix, "bin", "node"), 0o755);
  const spec = { ...f.spec, command: "/opt/node/bin/node", readOnlyBinds: [
    { host: prefix, guest: "/opt/node" }, { host: fs.realpathSync(relayFile), guest: "/opt/factory/relay.js" }],
    socket: { host: socketPath, guest: "/opt/factory/model.sock" }, args: ["-e", `
      const fs=require('node:fs'); for(const p of ${JSON.stringify([directory, join(directory, "hidden")])}){
        try{fs.statSync(p);process.exit(4)}catch(e){if(e.code!=='ENOENT')process.exit(5)}}
      require('node:http').get('http://127.0.0.1:${SANDBOX_RELAY_PORT}/v1/models',res=>{
        res.on('data',chunk=>process.stdout.write(chunk));res.on('end',()=>process.exit(0));
      }).on('error',()=>process.exit(6));`] };
  let output = "";
  const handle = launch(t, spec, { onOutput(stream, chunk) { if (stream === "stdout") output += chunk; } });
  await until(() => output.includes("data: first")); assert.equal(output.includes("data: last"), false); release();
  const result = await handle.result; assert.equal(result.exitCode, 0); assert.equal(result.stdout, "data: first\n\ndata: last\n\n");
});
integration("real sandbox supports git status and diff while denying commits and ref changes", async (t) => {
  const f = await fixture(t); const before = (await runGit(f.project.root, ["show-ref"])).stdout;
  const configBefore = fs.readFileSync(join(f.spec.gitDirs.common, "config"));
  const result = await node(t, f, `const fs=require('node:fs'),{spawnSync}=require('node:child_process');fs.writeFileSync('base.txt','changed\\n');
    const git=(args)=>spawnSync('/usr/bin/git',['-c','safe.directory='+process.cwd(),...args],{encoding:'utf8'});
    const status=git(['status','--porcelain']);const diff=git(['diff']);
    const commit=git(['-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-am','attempt']);
    const ref=git(['update-ref','refs/heads/forbidden','HEAD']);
    process.stdout.write(JSON.stringify({status:status.status,text:status.stdout,diff:diff.stdout,commit:commit.status,ref:ref.status}));`);
  const data = JSON.parse(result.stdout); assert.equal(data.status, 0); assert.match(data.text, / M base.txt/); assert.match(data.diff, /\+changed/);
  assert.notEqual(data.commit, 0); assert.notEqual(data.ref, 0);
  assert.equal((await runGit(f.project.root, ["show-ref"])).stdout, before);
  assert.deepEqual(fs.readFileSync(join(f.spec.gitDirs.common, "config")), configBefore);
  assert.equal(fs.readFileSync(join(f.project.root, "base.txt"), "utf8"), "base\n");
});
integration("real sandbox workspace symlinks cannot reveal host files", async (t) => {
  const f = await fixture(t); fs.symlinkSync(join(f.roots.stateDir, "private-marker"), join(f.attempt.path, "escape"));
  const result = await node(t, f, "try{require('node:fs').readFileSync('escape');process.exit(3)}catch(e){process.stdout.write(e.code)}");
  assert.equal(result.stdout, "ENOENT");
});
integration("real sandbox stop kills background and detached session children", async (t) => {
  const f = await fixture(t); const duration = String(400_000 + Math.floor(Math.random() * 500_000));
  assert.deepEqual(scanSleep(duration), []);
  const spec = { ...f.spec, command: "/bin/sh", args: ["-c", `sleep ${duration} & setsid sleep ${duration} & wait`] };
  const handle = launch(t, spec); await until(() => scanSleep(duration).length >= 2);
  await handle.stop(); const result = await handle.result; assert.equal(result.stopped, true); assert.equal(result.groupGone, true);
  await until(() => scanSleep(duration).length === 0);
});
integration("real sandbox timeout leaves no processes behind", async (t) => {
  const f = await fixture(t); const duration = String(1_000_000 + Math.floor(Math.random() * 500_000));
  const handle = launch(t, { ...f.spec, command: "/bin/sh", args: ["-c", `setsid sleep ${duration} & wait`] }, { timeoutMs: 300 });
  const result = await handle.result; assert.equal(result.timedOut, true); assert.equal(result.groupGone, true);
  await until(() => scanSleep(duration).length === 0);
});
integration("real sandbox bounds captured output and observer output", async (t) => {
  const f = await fixture(t); let emitted = 0;
  const result = await node(t, f, "process.stdout.write('x'.repeat(1024*1024))", { maxOutputBytes: 4096, onOutput(_stream, chunk) { emitted += Buffer.byteLength(chunk); } });
  assert.equal(result.truncated, true); assert.equal(Buffer.byteLength(result.stdout), 4096); assert.equal(emitted, 4096);
});
integration("two real sandboxes cannot see each other's workspace", async (t) => {
  const f = await fixture(t); const second = await createWorktree(f.roots, { projectRoot: f.project.root, projectSlug: f.project.slug, taskCode: "DEV-002", epoch: 1 });
  const ownSource = (other) => `const fs=require('node:fs');fs.writeFileSync('own','private');setTimeout(()=>{try{fs.statSync(${JSON.stringify(other)});process.exit(3)}catch(e){process.stdout.write(e.code)}},100)`;
  const first = launch(t, { ...f.spec, args: ["-e", ownSource(second.path)] });
  const metadata = fs.readFileSync(join(second.path, ".git"), "utf8").trim().slice("gitdir: ".length);
  const other = launch(t, { ...f.spec, workspace: second.path, gitDirs: { common: f.spec.gitDirs.common, worktree: metadata }, args: ["-e", ownSource(f.attempt.path)] });
  const results = await Promise.all([first.result, other.result]);
  for (const result of results) { assert.equal(result.exitCode, 0); assert.equal(result.stdout, "ENOENT"); assert.equal(result.groupGone, true); }
});
