import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { commandCatalog, LocalCommands } from "../electron/workspace/commands";

async function until(fn: () => boolean, ms = 15000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("Local command timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
}
test(
  "project commands revalidate script keys, contain real npm descendants, redact output and restore interrupted state",
  { skip: process.platform !== "win32", timeout: 45000 },
  async () => {
    const root = resolve("../../.cache/asf-research/process-tests");
    await mkdir(root, { recursive: true });
    const directory = await mkdtemp(join(root, "local-"));
    const secret = "synthetic-local-credential-long-value";
    const manager = new LocalCommands(directory, () => [secret]);
    const packagePath = join(directory, "package.json");
    try {
      await writeFile(
        packagePath,
        JSON.stringify({
          scripts: {
            dev: "node server.cjs",
            "bad & name": "exit 0",
            info: "node -v",
          },
        }),
      );
      const catalog = await commandCatalog(directory);
      assert.deepEqual(
        catalog.map((c) => c.id),
        ["dev", "info"],
      );
      await assert.rejects(
        manager.start("project", directory, "dev & echo injected"),
      );
      await writeFile(
        join(directory, "server.cjs"),
        `const {spawn}=require('node:child_process'); const fs=require('node:fs');const http=require('node:http');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync('pids.json',JSON.stringify([process.pid,c.pid]));console.log('password=secret-value');process.stdout.write(${JSON.stringify(secret.slice(0, 12))});setTimeout(()=>{console.log(${JSON.stringify(secret.slice(12))});console.log('x'.repeat(1024));const s=http.createServer((q,r)=>r.end('fixture'));s.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+s.address().port));},150);`,
      );
      const starting = manager.start("project", directory, "dev");
      await assert.rejects(manager.start("project", directory, "info"), /Dừng/);
      await starting;
      await until(() => !!manager.view()?.url).catch((error) => {
        throw new Error(error.message + ": " + JSON.stringify(manager.view()));
      });
      const live = manager.view()!;
      assert.match(live.url!, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.doesNotMatch(live.output, /secret-value|synthetic-local/);
      assert.match(live.output, /REDACTED/);
      const preview = await fetch(live.url!);
      assert.equal(await preview.text(), "fixture");
      const pids = JSON.parse(
        await readFile(join(directory, "pids.json"), "utf8"),
      ) as number[];
      await manager.stop();
      assert.equal(manager.busy(), false);
      assert.equal(manager.view()?.state, "interrupted");
      assert.equal(manager.view()?.output.includes(secret), false);
      for (const pid of pids) {
        await until(() => {
          try {
            process.kill(pid, 0);
            return false;
          } catch {
            return true;
          }
        });
      }
      const persisted = JSON.parse(
        await readFile(join(directory, "local-command.json"), "utf8"),
      );
      assert.equal(persisted.state, "interrupted");
      persisted.state = "running";
      await writeFile(
        join(directory, "local-command.json"),
        JSON.stringify(persisted),
      );
      const reopened = new LocalCommands(directory, () => [secret]);
      await reopened.restore();
      assert.equal(reopened.view()?.state, "interrupted");
      assert.equal(reopened.view()?.url, undefined);
      assert.equal(reopened.busy(), false);
      await writeFile(packagePath, JSON.stringify({ scripts: {} }));
      await assert.rejects(
        manager.start("project", directory, "dev"),
        /package.json/,
      );
    } finally {
      await manager.stop();
      assert.ok(directory.startsWith(root + "\\"));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
