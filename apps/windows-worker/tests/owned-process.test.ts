import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
  readdir,
  readFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { OpenCodeRuntime } from "../electron/runtime/opencode";
import { defaultSettings } from "../shared/defaults";
import type { Run } from "../shared/runs";
import { once } from "node:events";
import {
  spawnOwned,
  recoverOwnedJobs,
} from "../electron/runtime/owned-process";

test(
  "Windows Job Object contains descendants and kills them on host crash or lifetime pipe close",
  { skip: process.platform !== "win32", timeout: 45000 },
  async () => {
    const root = resolve("../../.cache/asf-research/process-tests");
    await mkdir(root, { recursive: true });
    const directory = await mkdtemp(join(root, "job-"));
    try {
      for (const crash of [false, true]) {
        const child = await spawnOwned(
          process.execPath,
          [
            "-e",
            `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(JSON.stringify({root:process.pid,child:c.pid,arg:process.argv[1]}));setInterval(()=>{},1000);`,
            'spaces "quote" \\',
          ],
          directory,
          process.env,
          directory,
        );
        let error = "",
          output = "";
        child.stderr!.on("data", (data) => {
          error += data;
        });
        const ready = new Promise<{ root: number; child: number; arg: string }>(
          (ok, bad) => {
            child.stdout!.on("data", (data) => {
              output += data;
              try {
                ok(JSON.parse(output.trim()));
              } catch {}
            });
            child.once("exit", () =>
              bad(new Error(error || output || "Host exited before ready")),
            );
          },
        );
        const pids = await ready;
        assert.equal(pids.arg, 'spaces "quote" \\');
        const closed = once(child, "close");
        if (crash) child.kill();
        else child.stdin!.end();
        await closed;
        for (const pid of [pids.root, pids.child]) {
          for (let i = 0; i < 30; i++) {
            try {
              process.kill(pid, 0);
            } catch {
              break;
            }
            await new Promise((r) => setTimeout(r, 50));
          }
          assert.throws(
            () => process.kill(pid, 0),
            "owned descendant must exit",
          );
        }
        await recoverOwnedJobs(directory);
      }
    } finally {
      assert.ok(directory.startsWith(root + "\\"));
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  "cancellation during asynchronous runtime spawn waits for its host to close",
  { skip: process.platform !== "win32", timeout: 15000 },
  async () => {
    const root = resolve("../../.cache/asf-research/process-tests");
    await mkdir(root, { recursive: true });
    const directory = await mkdtemp(join(root, "startup-"));
    const runtime = new OpenCodeRuntime(
      process.execPath,
      join(directory, "runtime/run/task"),
      {
        workspace: directory,
        role: "be",
        model: "fixture",
        settings: defaultSettings(),
      } as Run,
      { url: "http://127.0.0.1:1/v1", token: "synthetic" },
      { event: () => {}, permission: () => {}, failure: () => {} },
      {
        prompt: "",
        instructions: "",
        readOnly: false,
        allowShell: true,
        allowedPaths: ["."],
      },
    );
    try {
      let ended = false;
      const startup = runtime
        .start()
        .then(
          () => null,
          (error) => error,
        )
        .finally(() => {
          ended = true;
        });
      // Observe the actual pending spawn, rather than replacing the runtime with a mock.
      const inspect = runtime as unknown as { spawning?: Promise<unknown> };
      while (!inspect.spawning && !ended)
        await new Promise((r) => setTimeout(r, 1));
      assert.ok(inspect.spawning);
      await runtime.close();
      assert.ok((await startup) instanceof Error);
      await recoverOwnedJobs(directory);
      assert.equal((await readdir(join(directory, "owned-jobs"))).length, 0);
    } finally {
      await runtime.close();
      assert.ok(directory.startsWith(root + "\\"));
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  "parent crash closes owned descendants; recovery refuses a live previous job and never kills unrelated processes",
  { skip: process.platform !== "win32", timeout: 45000 },
  async () => {
    const root = resolve("../../.cache/asf-research/process-tests");
    await mkdir(root, { recursive: true });
    const directory = await mkdtemp(join(root, "parent-"));
    const unrelated = spawn(
      process.execPath,
      ["-e", "setInterval(()=>{},1000)"],
      { windowsHide: true, stdio: "ignore" },
    );
    let parent: ReturnType<typeof spawn> | undefined;
    try {
      const modulePath = resolve("electron/runtime/owned-process.ts");
      const preload = require.resolve("tsx/cjs");
      const fixture = join(directory, "parent.cjs");
      await writeFile(
        fixture,
        `require(${JSON.stringify(preload)});const {spawnOwned}=require(${JSON.stringify(modulePath)});(async()=>{const child=await spawnOwned(process.execPath,['-e',"const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(JSON.stringify({root:process.pid,child:c.pid}));setInterval(()=>{},1000);"],__dirname,process.env,__dirname);child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);setInterval(()=>{},1000);})();`,
      );
      parent = spawn(process.execPath, [fixture], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "",
        error = "";
      parent.stderr!.on("data", (d) => {
        error += d;
      });
      const pids = await new Promise<{ root: number; child: number }>(
        (ok, bad) => {
          parent!.stdout!.on("data", (d) => {
            output += d;
            try {
              ok(JSON.parse(output.trim()));
            } catch {}
          });
          parent!.once("exit", () =>
            bad(new Error(error || output || "Parent exited")),
          );
        },
      );
      await assert.rejects(recoverOwnedJobs(directory), /process|job/i);
      process.kill(pids.root, 0);
      const closed = once(parent, "exit");
      parent.kill();
      await closed;
      for (const pid of [pids.root, pids.child]) {
        for (let i = 0; i < 100; i++) {
          try {
            process.kill(pid, 0);
          } catch {
            break;
          }
          await new Promise((r) => setTimeout(r, 50));
        }
        assert.throws(() => process.kill(pid, 0));
      }
      const manifests = await readdir(join(directory, "owned-jobs"));
      assert.equal(
        manifests.length,
        1,
        "crashed parent leaves ownership manifest for recovery",
      );
      const saved = JSON.parse(
        await readFile(join(directory, "owned-jobs", manifests[0]), "utf8"),
      );
      assert.match(saved.name, /^Local\\ASF-/);
      await recoverOwnedJobs(directory);
      assert.equal((await readdir(join(directory, "owned-jobs"))).length, 0);
      process.kill(unrelated.pid!, 0);
    } finally {
      parent?.kill();
      unrelated.kill();
      assert.ok(directory.startsWith(root + "\\"));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
