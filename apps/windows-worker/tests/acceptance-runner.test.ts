import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { runInNewContext } from "node:vm";

const directory = join(process.cwd(), "scripts");
const source = readFileSync(join(directory, "run-acceptance.cjs"), "utf8");

function invoke(scenario?: string, extra: string[] = []) {
  const calls: { executable: string; args: string[]; options: any }[] = [];
  const messages: string[] = [];
  const processMock = {
    argv: [
      "node",
      "run-acceptance.cjs",
      ...(scenario ? [scenario] : []),
      ...extra,
    ],
    env: { ELECTRON_RUN_AS_NODE: "1", PATH: "fixture" },
    exitCode: 0,
  };
  runInNewContext(source, {
    __dirname: directory,
    process: processMock,
    console: { error: (message: string) => messages.push(message) },
    require: (id: string) => {
      if (id === "node:path") return { join };
      if (id === "electron") return "fixture-electron.exe";
      assert.equal(id, "node:child_process");
      return {
        spawn: (executable: string, args: string[], options: unknown) => {
          calls.push({ executable, args, options });
          return { on: () => {} };
        },
      };
    },
  });
  return { calls, messages, code: processMock.exitCode };
}

test("acceptance runner refuses missing/unknown scenarios without launching a live run", () => {
  for (const scenario of [undefined, "chat-iu", "../acceptance-live.cjs"]) {
    const result = invoke(scenario);
    assert.equal(result.code, 1);
    assert.equal(result.calls.length, 0);
    assert.match(result.messages[0], /Usage:/);
  }
});

test("all advertised acceptance scenarios resolve locally and preserve launch arguments", () => {
  const usage = invoke().messages[0].split("Scenarios: ")[1].split(", ");
  for (const scenario of usage) {
    const result = invoke(scenario, ["fixture-argument"]);
    assert.equal(result.calls.length, 1, scenario);
    const call = result.calls[0];
    assert.ok(existsSync(call.args[0]), scenario);
    assert.equal(call.args[1], "fixture-argument");
    assert.equal(call.options.env.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(call.options.windowsHide, true);
    assert.equal(
      basename(call.args[0]) === "acceptance-live.cjs",
      scenario === "live",
    );
  }
  assert.equal(
    invoke("board-ui").calls[0].args[0],
    invoke("work-items-ui").calls[0].args[0],
  );
});
