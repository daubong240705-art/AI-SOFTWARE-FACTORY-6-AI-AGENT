import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLeadOutput } from "../dist/lead/protocol.js";

const task = (overrides = {}) => ({ title: "Check result", goal: "Verify behavior", acceptance: ["Works"], expectedFiles: 1,
  requiredCapabilities: ["test.unit"], placement: "repo-bound", sideEffect: "artifact", reviewPolicy: "human-final", dependsOn: [], ...overrides });
const plan = (overrides = {}) => ({ tasks: [task()], ...overrides });
const block = (value) => `\`\`\`factory-plan\n${JSON.stringify(value)}\n\`\`\``;
const parse = (text, intent = "delegate") => parseLeadOutput(text, intent);

test("plain replies and other info strings are preserved", () => {
  assert.deepEqual(parse("  Hello\n\n\nthere  "), { reply: "Hello\n\n\nthere", plan: null, note: null });
  const text = "```json\n{}\n```";
  assert.deepEqual(parse(text), { reply: text, plan: null, note: null });
  assert.equal(parse("").reply, "I have no answer for that.");
});

test("one plan is removed with prose on both sides; block-only reply and CRLF", () => {
  const value = plan();
  assert.deepEqual(parse(`Before\n\n\n${block(value)}\n\nAfter`), { reply: "Before\n\nAfter", plan: value, note: null });
  assert.deepEqual(parse(block(value)), { reply: "I proposed 1 task(s) for your review.", plan: value, note: null });
  assert.deepEqual(parse(block(value).replaceAll("\n", "\r\n")).plan, value);
});

test("invalid JSON gets a fixed note", () => {
  assert.deepEqual(parse("```factory-plan\nsecret invalid\n```"), {
    reply: "I have no answer for that.", plan: null, note: "plan is not valid JSON",
  });
});

for (const [name, value] of [
  ["eleven tasks", plan({ tasks: Array.from({ length: 11 }, () => task()) })],
  ["forward dependency", plan({ tasks: [task({ dependsOn: [1] }), task()] })],
  ["self dependency", plan({ tasks: [task({ dependsOn: [0] })] })],
  ["duplicate dependency", plan({ tasks: [task(), task({ dependsOn: [0, 0] })] })],
  ["empty acceptance", plan({ tasks: [task({ acceptance: [] })] })],
  ["unknown root key", plan({ "MODEL-SECRET": "MODEL-SECRET" })],
  ["unknown task key", plan({ tasks: [task({ "MODEL-SECRET": "MODEL-SECRET" })] })],
  ["bad capability", plan({ tasks: [task({ requiredCapabilities: ["MODEL-SECRET"] })] })],
]) test(`schema rejects ${name} without echoing model values`, () => {
  const result = parse(block(value));
  assert.equal(result.plan, null);
  assert.match(result.note, /^plan rejected: /);
  assert.ok(!result.note.includes("MODEL-SECRET"));
});

test("schema notes contain at most three issue paths", () => {
  const result = parse(block(plan({ tasks: [task({ title: 42, goal: 42, acceptance: [], expectedFiles: -1 })] })));
  assert.equal(result.note, "plan rejected: tasks.0.title, tasks.0.goal, tasks.0.acceptance");
});

test("plans without tests need a nonblank testing reason", () => {
  const value = plan({ tasks: [task({ requiredCapabilities: ["code.typescript"] })] });
  assert.equal(parse(block(value)).note, "plan rejected: no test task and no testingReason");
  assert.equal(parse(block({ ...value, testingReason: "   " })).plan, null);
  assert.deepEqual(parse(block({ ...value, testingReason: "Documentation only" })).plan,
    { ...value, testingReason: "Documentation only" });
});

test("multiple blocks are all removed; discussion never returns a plan", () => {
  assert.deepEqual(parse(`${block(plan())}\nHello\n${block(plan())}`), {
    reply: "Hello", plan: null, note: "multiple plan blocks ignored",
  });
  assert.deepEqual(parse(block(plan()), "discuss"), {
    reply: "I have no answer for that.", plan: null, note: "plan ignored: the message was a discussion",
  });
});

test("reply cap does not truncate JSON input", () => {
  const text = `${"x".repeat(60_010)}\n${block(plan())}`;
  assert.equal(parse(text).reply.length, 60_000);
  assert.deepEqual(parse(text).plan, plan());
  assert.equal(parse("x".repeat(60_001)).reply.length, 60_000);
});

test("a factory-plan example inside a longer fence is ignored", () => {
  const example = `\`\`\`\`markdown\n${block(plan())}\n\`\`\`\``;
  assert.deepEqual(parse(example), { reply: example, plan: null, note: null });
  assert.deepEqual(parse(`${example}\n${block(plan())}`).plan, plan());
});
