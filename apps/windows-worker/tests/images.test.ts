import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Store } from "../electron/storage/database";
import { inspectImage, serveImage } from "../electron/storage/images";
import { imageLimits, imageURL } from "../shared/images";
import { chatSendSchema, type ChatSend } from "../shared/chat";
import { RunController } from "../electron/controller/runs";
import { OpenCodeRuntime } from "../electron/runtime/opencode";
import { defaultSettings } from "../shared/defaults";
import { redact } from "../electron/runtime/security";
import type { Run } from "../shared/runs";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==",
  "base64",
);
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "asf-images-"));
  const store = new Store(directory),
    project = store.addProject(directory),
    conversation = store.conversations.create(project.id);
  const settings = defaultSettings();
  settings.gatewayUrl = "https://unused.example/v1";
  settings.agents.forEach((agent) => {
    agent.enabled = true;
    agent.model = "fixture";
  });
  store.save(settings, undefined);
  return {
    directory,
    store,
    project,
    conversation,
    cleanup: () => {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
function runFor(x: ReturnType<typeof fixture>, imageIds: string[]): Run {
  return {
    id: crypto.randomUUID(),
    projectId: x.project.id,
    projectName: x.project.name,
    conversationId: x.conversation.id,
    workspace: x.directory,
    prompt: "Review image",
    role: "lead",
    model: "fixture",
    imageIds,
    mode: "direct",
    tasks: [],
    profiles: [],
    currentTaskId: null,
    fixRound: 0,
    review: null,
    state: "cancelled",
    createdAt: "2020-01-01T00:00:00.000Z",
    startedAt: null,
    endedAt: "2020-01-01T00:00:01.000Z",
    sessionId: null,
    summary: "",
    error: "",
    settings: x.store.settings(),
    changes: [],
    commands: [],
    permissions: [],
    requests: 0,
    baselineComplete: true,
    toolsCompleted: 0,
    runtimeVersion: "",
    inputTokens: 0,
    outputTokens: 0,
  };
}
test("image headers reject active formats, malformed JPEG, oversized dimensions and bytes", () => {
  assert.deepEqual(inspectImage(png), {
    width: 1,
    height: 1,
    mime: "image/png",
  });
  for (const data of [
    Buffer.from("<svg onload='alert(1)'/>"),
    Buffer.from("GIF89a"),
    Buffer.from([255, 216, 255, 192, 0, 1]),
  ])
    assert.throws(() => inspectImage(data));
  const large = Buffer.from(png);
  large.writeUInt32BE(5000, 16);
  assert.throws(() => inspectImage(large));
  large.writeUInt32BE(4000, 16);
  large.writeUInt32BE(4000, 20);
  assert.throws(() => inspectImage(large));
  assert.throws(() => inspectImage(Buffer.alloc(imageLimits.inputBytes + 1)));
});
test("asset protocol serves exact scoped immutable bytes, rejects paths, external URLs and corruption", async () => {
  const x = fixture();
  try {
    const image = x.store.images.add(
      x.project.id,
      x.conversation.id,
      "../a.png",
      png,
    )[0];
    assert.equal(image.name, ".._a.png");
    const response = serveImage(x.store.images, new Request(imageURL(image)));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
    const other = x.store.conversations.create(x.project.id);
    for (const url of [
      imageURL(image).replace(x.conversation.id, other.id),
      imageURL(image) + "?path=C:/Windows",
      "https://asset/" + image.id,
      "asf-image://asset/C:/Windows/win.ini",
      "asf-image://asset/../../secret",
    ])
      assert.equal(serveImage(x.store.images, new Request(url)).status, 404);
    assert.equal(
      serveImage(
        x.store.images,
        new Request(imageURL(image), { method: "POST" }),
      ).status,
      404,
    );
    const db = new Database(join(x.directory, "worker.sqlite"));
    db.prepare("UPDATE chat_images SET data=? WHERE id=?").run(
      Buffer.from("corrupt"),
      image.id,
    );
    db.close();
    assert.equal(
      serveImage(x.store.images, new Request(imageURL(image))).status,
      404,
    );
  } finally {
    x.cleanup();
  }
});
test("draft images survive reopen; detach collects only unreferenced bytes and enforces count/project scope", () => {
  const x = fixture();
  try {
    for (let i = 0; i < 4; i++)
      x.store.images.add(x.project.id, x.conversation.id, `${i}.png`, png);
    assert.throws(
      () =>
        x.store.images.add(x.project.id, x.conversation.id, "extra.png", png),
      /4/,
    );
    const [image] = x.store.images.drafts(x.project.id, x.conversation.id);
    assert.throws(() =>
      x.store.images.refs(crypto.randomUUID(), x.conversation.id, [image.id]),
    );
    assert.throws(() =>
      x.store.images.refs(x.project.id, x.conversation.id, [
        image.id,
        image.id,
      ]),
    );
    assert.throws(() =>
      x.store.images.add(
        x.project.id,
        x.conversation.id,
        "huge.png",
        Buffer.alloc(imageLimits.bytes + 1),
      ),
    );
    const reopened = new Store(x.directory);
    assert.equal(
      reopened.images.drafts(x.project.id, x.conversation.id).length,
      4,
    );
    reopened.close();
    x.store.images.detach(x.project.id, x.conversation.id, image.id);
    assert.throws(() =>
      x.store.images.read(x.project.id, x.conversation.id, image.id),
    );
  } finally {
    x.cleanup();
  }
});
test("chat image send rolls back atomically, deduplicates, keeps queue/retry refs and exports unmodified base64", async () => {
  const x = fixture();
  let controller: RunController | undefined;
  try {
    const [image] = x.store.images.add(
      x.project.id,
      x.conversation.id,
      "fixture.png",
      png,
    );
    const input: ChatSend = {
      requestId: crypto.randomUUID(),
      projectId: x.project.id,
      conversationId: x.conversation.id,
      prompt: "Review image",
      role: "lead",
      mode: "direct",
      imageIds: [image.id],
    };
    assert.throws(() =>
      x.store.sendChat(input, () => {
        throw Error("rollback");
      }),
    );
    assert.equal(
      x.store.images.drafts(x.project.id, x.conversation.id).length,
      1,
    );
    x.store.queue.add({
      projectId: x.project.id,
      conversationId: x.conversation.id,
      prompt: "Held",
      role: "lead",
      mode: "direct",
      settings: x.store.settings(),
      afterRunId: null,
      state: "held",
      reason: "fixture",
    });
    controller = new RunController(x.store, x.directory, () => undefined);
    const receipt = controller.sendChat(input);
    assert.equal(
      x.store.images.drafts(x.project.id, x.conversation.id).length,
      0,
    );
    assert.deepEqual(controller.sendChat(input), receipt);
    assert.deepEqual(x.store.queue.get(receipt.followUpId!).imageIds, [
      image.id,
    ]);
    assert.throws(() => controller!.sendChat({ ...input, imageIds: [] }));
    x.store.images.gc();
    assert.equal(
      x.store.images.read(x.project.id, x.conversation.id, image.id).data
        .length,
      png.length,
    );
    x.store.queue.remove(x.store.queue.list()[0].id);
    // Avoid starting a provider process: capture the scheduled run before shutdown.
    const run = controller.resume(receipt.followUpId!);
    assert.deepEqual(run.imageIds, [image.id]);
    await controller.stop(run.id);
    const retry = controller.retry(run.id);
    assert.deepEqual(retry.imageIds, [image.id]);
    await controller.stop(retry.id);
    const exported = JSON.parse(x.store.report(run.id, ["iVBOR"]));
    assert.equal(exported.images[0].base64, png.toString("base64"));
    assert.equal(exported.imageRefs[0].hash, image.hash);
    const context = x.store.conversations.context(
      x.conversation.id,
      x.project.id,
    );
    assert.ok(context.text.includes('"included":false'));
    assert.ok(!context.text.includes(png.toString("base64")));
    assert.throws(() =>
      chatSendSchema.parse({ ...input, imageIds: ["../../file"] }),
    );
  } finally {
    await controller?.shutdown();
    x.cleanup();
  }
});
test("retention keeps draft and surviving run images while reclaiming pruned run and removed queue images", () => {
  const x = fixture();
  try {
    const [sent, queued, draft] = [1, 2, 3].map(
      (n) =>
        x.store.images
          .add(x.project.id, x.conversation.id, `${n}.png`, png)
          .at(-1)!,
    );
    const old = runFor(x, [sent.id]);
    x.store.createRun(old);
    x.store.updateRun(old);
    x.store.images.sent(x.project.id, x.conversation.id, [sent.id, queued.id]);
    const queue = x.store.queue.add({
      projectId: x.project.id,
      conversationId: x.conversation.id,
      imageIds: [queued.id],
      prompt: "queued",
      role: "lead",
      mode: "direct",
      settings: x.store.settings(),
      afterRunId: null,
      state: "held",
      reason: "fixture",
    });
    x.store.images.gc();
    assert.equal(
      x.store.images.read(x.project.id, x.conversation.id, sent.id).image.id,
      sent.id,
    );
    const preview = x.store.retention(1, 0);
    assert.equal(preview.count, 1);
    assert.equal(x.store.prune(preview.token), 1);
    assert.throws(() =>
      x.store.images.read(x.project.id, x.conversation.id, sent.id),
    );
    assert.equal(
      x.store.images.read(x.project.id, x.conversation.id, queued.id).image.id,
      queued.id,
    );
    x.store.queue.remove(queue.id);
    x.store.images.gc();
    assert.throws(() =>
      x.store.images.read(x.project.id, x.conversation.id, queued.id),
    );
    assert.deepEqual(
      x.store.images
        .drafts(x.project.id, x.conversation.id)
        .map((image) => image.id),
      [draft.id],
    );
  } finally {
    x.cleanup();
  }
});
test("schema12 upgrade creates backup before images, preserves drafts, source and credentials", () => {
  const x = fixture();
  try {
    x.store.conversations.draft(x.conversation.id, "kept");
    const db = new Database(join(x.directory, "worker.sqlite"));
    db.exec("DROP TABLE chat_images; PRAGMA user_version=12");
    db.close();
    const reopened = new Store(x.directory);
    assert.ok(
      existsSync(join(x.directory, "worker.schema12.pre-images.backup.sqlite")),
    );
    assert.equal(
      reopened.conversations.get(x.conversation.id).conversation.draft,
      "kept",
    );
    assert.equal(
      reopened.images.drafts(x.project.id, x.conversation.id).length,
      0,
    );
    reopened.close();
  } finally {
    x.cleanup();
  }
});
test("OpenCode prompt transports bounded image parts alongside text without storing data in run", async () => {
  const x = fixture();
  try {
    const [image] = x.store.images.add(
        x.project.id,
        x.conversation.id,
        "fixture.png",
        png,
      ),
      run = runFor(x, [image.id]);
    const parts = x.store.images.parts(x.project.id, x.conversation.id, [
      image.id,
    ]);
    const runtime = new OpenCodeRuntime(
      "unused",
      x.directory,
      run,
      { url: "http://127.0.0.1:1", token: "fixture" },
      { event: () => {}, permission: () => {}, failure: () => {} },
      {
        prompt: "Look",
        instructions: "fixture",
        readOnly: true,
        allowShell: false,
        allowedPaths: ["."],
        images: parts,
      },
    );
    let request: { parts: unknown[] } | undefined;
    Object.assign(runtime, {
      session: "fixture",
      client: {
        session: {
          prompt: async (input: { parts: unknown[] }) => {
            request = input;
            return { data: { parts: [{ type: "text", text: "Reply" }] } };
          },
          messages: async () => ({ data: [] }),
        },
      },
    });
    assert.equal((await runtime.prompt()).text, "Reply");
    assert.deepEqual(request!.parts, [
      { type: "text", text: "Look" },
      ...parts,
    ]);
    assert.equal(
      parts[0].url,
      `data:image/png;base64,${png.toString("base64")}`,
    );
    assert.equal(redact(parts[0].url), "[IMAGE DATA]");
    assert.equal(
      runtime.errorInfo(Error("Model does not support image input")).code,
      "configuration",
    );
    assert.ok(!JSON.stringify(run).includes(png.toString("base64")));
  } finally {
    x.cleanup();
  }
});
