import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import * as c from "@factory/contracts";
import {
  acceptsCallback,
  adapterCallbackSchema,
  adapterProbeSchema,
  grantMatches,
} from "@factory/contracts/adapter";

const id = () => randomUUID();
const projectId = id(),
  conversationId = id(),
  epoch = id();
const ref = () => ({ id: id(), revision: 1 });
const send = () => ({
  apiVersion: 1,
  commandId: id(),
  projectId,
  type: "chat.send",
  payload: {
    conversationId,
    expectedRevision: 1,
    messageId: id(),
    text: "Trao đổi phạm vi trước",
    attachmentIds: [],
    intent: "discuss",
    context: [],
    draftRevision: 1,
  },
});
const attempt = () => ({
  projectId,
  runId: id(),
  assignmentId: id(),
  epoch: 2,
  leaseId: id(),
});
const callback = (identity) => ({
  attempt: identity,
  callbackId: id(),
  sequence: 1,
  observedAt: "2026-11-06T01:00:00Z",
  payload: { type: "text.delta", text: "Đang xử lý" },
});
const event = (sequence = "1", previous = "0") => ({
  apiVersion: 1,
  eventId: id(),
  projectId,
  occurredAt: "2026-11-06T01:00:00Z",
  cursor: { epoch, sequence },
  previousCursor: { epoch, sequence: previous },
  causationId: id(),
  rootCausationId: id(),
  payload: { type: "entity.changed", entity: { kind: "work", ...ref() } },
});
const profile = () => ({
  ...ref(),
  environmentId: id(),
  name: "Full access · project environment",
  mode: "full-environment",
  filesystem: [{ root: "/home/lazy/projects/demo", access: "read-write" }],
  toolIds: [],
  network: { mode: "environment" },
  actions: ["read", "edit", "shell", "build", "test"],
  limits: {
    maxConcurrentRuns: 2,
    maxConcurrentJobs: 1,
    maxRunSeconds: 3600,
    maxOutputBytes: 1000000,
    maxAutoFixRoundsPerIssue: 3,
  },
});
test("wire round-trip preserves Vietnamese and canonicalizes UUID identity", () => {
  const value = send();
  value.commandId = value.commandId.toUpperCase();
  const parsed = c.commandSchema.parse(JSON.parse(JSON.stringify(value)));
  assert.equal(parsed.payload.text, value.payload.text);
  assert.equal(parsed.commandId, value.commandId.toLowerCase());
  assert.equal(parsed.payload.intent, "discuss");
});
test("browser cannot claim actor, grant, credentials or presentation-triggered execution", () => {
  for (const key of [
    "actor",
    "sessionId",
    "grant",
    "credentials",
    "windowId",
  ]) {
    assert.equal(
      c.commandSchema.safeParse({ ...send(), [key]: id() }).success,
      false,
      key,
    );
    const value = send();
    value.payload[key] = id();
    assert.equal(c.commandSchema.safeParse(value).success, false, key);
  }
});
test("mutations require revisions; new entities use explicit null where allowed", () => {
  const value = send();
  delete value.payload.expectedRevision;
  assert.equal(c.commandSchema.safeParse(value).success, false);
  for (const revision of [0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1])
    assert.equal(
      c.commandSchema.safeParse({
        ...send(),
        payload: { ...send().payload, expectedRevision: revision },
      }).success,
      false,
    );
  const draft = {
    ...send(),
    type: "drafts.save",
    payload: {
      conversationId,
      expectedRevision: null,
      text: "",
      attachmentIds: [],
    },
  };
  assert.equal(c.commandSchema.safeParse(draft).success, true);
  assert.equal(
    c.commandSchema.safeParse({
      ...draft,
      payload: { ...draft.payload, expectedRevision: 4 },
    }).success,
    true,
  );
});
test("agent and model definitions accept custom domains without seven-role enums", () => {
  const value = {
    ...send(),
    type: "agents.configure",
    payload: {
      agentId: id(),
      expectedRevision: null,
      name: "Biên tập video",
      role: "Motion designer / kiểm duyệt",
      connectionId: id(),
      modelId: "provider/custom-model",
      executionProfile: ref(),
      skillRevisions: [],
      toolRevisions: [],
    },
  };
  assert.equal(c.commandSchema.parse(value).payload.role, value.payload.role);
  assert.equal(
    c.commandSchema.safeParse({
      ...value,
      payload: { ...value.payload, role: " " },
    }).success,
    false,
  );
});
test("size/version/unknown-command boundaries reject invalid transport input", () => {
  assert.equal(
    c.commandSchema.safeParse({ ...send(), apiVersion: 2 }).success,
    false,
  );
  assert.equal(
    c.commandSchema.safeParse({ ...send(), type: "rules.publish" }).success,
    false,
  );
  for (const patch of [
    { text: "" },
    { text: "x".repeat(32001) },
    { attachmentIds: Array.from({ length: 21 }, id) },
  ])
    assert.equal(
      c.commandSchema.safeParse({
        ...send(),
        payload: { ...send().payload, ...patch },
      }).success,
      false,
    );
  const host = { apiVersion: 1, hostId: id(), commands: ["chat.send"] };
  assert.equal(c.hostCapabilitiesSchema.safeParse(host).success, true);
  assert.equal(
    c.hostCapabilitiesSchema.safeParse({ ...host, commands: ["shell.exec"] })
      .success,
    false,
  );
});
test("Linux path guard rejects traversal/Windows paths without changing Linux case", () => {
  for (const path of [
    "C:\\Projects",
    "../repo",
    "/home/lazy/../etc",
    "/home/./repo",
    "/tmp/\0secret",
    "/tmp\\x",
  ])
    assert.equal(c.linuxPathSchema.safeParse(path).success, false, path);
  assert.equal(
    c.linuxPathSchema.parse("/home/lazy/MyProject"),
    "/home/lazy/MyProject",
  );
});
test("decisions/reviews pin context and output versions, separate from run cancellation", () => {
  const decision = {
    ...send(),
    type: "decisions.answer",
    payload: {
      decisionId: id(),
      expectedRevision: 2,
      context: [ref()],
      answer: "Dùng phương án B",
    },
  };
  assert.equal(c.commandSchema.safeParse(decision).success, true);
  assert.equal(
    c.commandSchema.safeParse({
      ...decision,
      payload: { ...decision.payload, context: [] },
    }).success,
    false,
  );
  const review = {
    ...send(),
    type: "reviews.submit",
    payload: {
      reviewId: id(),
      expectedRevision: 2,
      output: ref(),
      verdict: "accepted",
      comment: "",
    },
  };
  assert.equal(c.commandSchema.safeParse(review).success, true);
  assert.equal(
    c.commandSchema.safeParse({
      ...review,
      payload: { ...review.payload, bash: "accept" },
    }).success,
    false,
  );
  assert.equal(
    c.commandSchema.safeParse({
      ...send(),
      type: "runs.cancel",
      payload: { runId: id(), expectedRevision: 1 },
    }).success,
    true,
  );
});
test("receipts distinguish durable acceptance, completed effects and unknown external outcomes", () => {
  const value = { commandId: id(), projectId, state: "accepted", effects: [] };
  assert.equal(c.receiptSchema.safeParse(value).success, true);
  assert.equal(
    c.receiptSchema.safeParse({
      ...value,
      effects: [{ kind: "work", ...ref() }],
    }).success,
    false,
  );
  assert.equal(
    c.receiptSchema.safeParse({ ...value, state: "rejected" }).success,
    false,
  );
  const error = {
    code: "outcome-unknown",
    message: "Kiểm tra đầu ra trước khi thử lại",
    correlationId: id(),
    nextAction: "reconcile",
  };
  assert.equal(
    c.receiptSchema.safeParse({ ...value, state: "outcome-unknown", error })
      .success,
    true,
  );
  assert.equal(
    c.receiptSchema.safeParse({ ...value, state: "completed", error }).success,
    false,
  );
});
test("event reducer classifies replay, gap, stale epoch and cross-project without numeric rounding", () => {
  const value = c.eventSchema.parse(
    event("9007199254740993", "9007199254740992"),
  );
  const current = { epoch, sequence: "9007199254740992" };
  assert.equal(c.classifyEvent(projectId, current, value), "apply");
  assert.equal(c.classifyEvent(projectId, value.cursor, value), "duplicate");
  assert.equal(
    c.classifyEvent(projectId, { epoch, sequence: "9007199254740991" }, value),
    "snapshot-required",
  );
  assert.equal(c.classifyEvent(id(), current, value), "snapshot-required");
  assert.equal(
    c.classifyEvent(projectId, { ...current, epoch: id() }, value),
    "snapshot-required",
  );
  assert.equal(c.eventSchema.safeParse(event("3", "1")).success, false);
  assert.equal(c.eventSchema.safeParse(event("01", "0")).success, false);
  assert.equal(
    c.cursorSchema.safeParse({ epoch, sequence: "9223372036854775808" })
      .success,
    false,
  );
});
test("nested event payload cannot contradict its project; freshness uses timestamps", () => {
  const value = event();
  value.payload = {
    type: "command.receipted",
    receipt: {
      commandId: id(),
      projectId: id(),
      state: "accepted",
      effects: [],
    },
  };
  assert.equal(c.eventSchema.safeParse(value).success, false);
  assert.equal(
    c.freshnessSchema.safeParse({
      observedAt: "2026-11-06T01:00:00.900Z",
      staleAfter: "2026-11-06T01:00:00Z",
    }).success,
    false,
  );
  assert.equal(
    c.agentActivitySchema.safeParse({
      state: "unknown",
      activeRunIds: [],
      activeJobIds: [],
      reason: "Host probe is stale",
      freshness: {
        observedAt: "2026-11-06T01:00:00Z",
        staleAfter: "2026-11-06T01:01:00Z",
      },
    }).success,
    true,
  );
});
test("run attempt identity and lease expiry fence callbacks from an old worker", () => {
  const active = attempt(),
    value = adapterCallbackSchema.parse(callback(active));
  assert.equal(acceptsCallback(active, 100, value, 99), true);
  assert.equal(acceptsCallback(active, 100, value, 100), false);
  for (const key of [
    "projectId",
    "runId",
    "assignmentId",
    "leaseId",
    "epoch",
  ]) {
    const stale = {
      ...value,
      attempt: { ...active, [key]: key === "epoch" ? 1 : id() },
    };
    assert.equal(acceptsCallback(active, 100, stale, 99), false, key);
  }
  assert.equal(acceptsCallback(active, 100, value, NaN), false);
});
test("stop acknowledgement cannot pretend to be terminal evidence", () => {
  const value = callback(attempt());
  assert.equal(
    adapterCallbackSchema.safeParse({
      ...value,
      payload: {
        type: "exited",
        result: "interrupted",
        externalEffects: "unknown",
      },
    }).success,
    false,
  );
  assert.equal(
    adapterCallbackSchema.safeParse({
      ...value,
      payload: {
        type: "exited",
        result: "interrupted",
        externalEffects: "unknown",
        evidence: {
          source: "owned-process-exit",
          reference: "host-exit-record:123",
        },
      },
    }).success,
    true,
  );
});
test("installed, auth, compatibility and capabilities are distinct probe facts", () => {
  const no = {
    supported: false,
    reason: "Not available in this runtime version",
  };
  const value = {
    adapterId: "example",
    connectionId: id(),
    observedAt: "2026-11-06T01:00:00Z",
    installed: true,
    version: "1.0",
    authentication: "needs-auth",
    compatibility: "unknown",
    capabilities: {
      streaming: { supported: true },
      resume: no,
      interrupt: no,
      modelSelection: no,
      managedPermissions: no,
      childSessionVisibility: no,
    },
  };
  assert.equal(adapterProbeSchema.parse(value).authentication, "needs-auth");
  assert.equal(
    adapterProbeSchema.safeParse({
      ...value,
      capabilities: { ...value.capabilities, resume: { supported: false } },
    }).success,
    false,
  );
});
test("profile is scoped explicit configuration; only matching Host attestations allow start", () => {
  const value = c.executionProfileSchema.parse(profile());
  const grant = {
    state: "ready",
    profile: { id: value.id, revision: value.revision },
    environmentId: value.environmentId,
    adapterId: "example",
    observedAt: "2026-11-06T01:00:00Z",
    configurationDigest: "a".repeat(64),
  };
  assert.equal(grantMatches(value, "example", grant), true);
  assert.equal(grantMatches(value, "other", grant), false);
  assert.equal(
    grantMatches({ ...value, revision: 2 }, "example", grant),
    false,
  );
  assert.equal(
    grantMatches({ ...value, environmentId: id() }, "example", grant),
    false,
  );
  const blocked = {
    ...grant,
    state: "blocked",
    blockers: [
      {
        dimension: "runtime-policy",
        reason: "Cannot configure unattended shell",
        remedy: "Configure adapter before start",
      },
    ],
  };
  delete blocked.configurationDigest;
  assert.equal(c.effectiveGrantSchema.safeParse(blocked).success, true);
  assert.equal(grantMatches(value, "example", blocked), false);
  assert.equal(
    c.executionProfileSchema.safeParse({
      ...value,
      limits: { ...value.limits, maxAutoFixRoundsPerIssue: 4 },
    }).success,
    false,
  );
  assert.equal(
    c.executionProfileSchema.safeParse({
      ...value,
      rootPassword: "not-allowed",
    }).success,
    false,
  );
  for (const origin of [
    "https://user:pass@example.com",
    "file:///tmp/x",
    "https://example.com/path",
    "https://example.com/?token=secret",
  ])
    assert.equal(
      c.executionProfileSchema.safeParse({
        ...value,
        network: { mode: "allow-list", origins: [origin] },
      }).success,
      false,
      origin,
    );
  assert.equal(
    c.executionProfileSchema.safeParse({
      ...value,
      network: { mode: "allow-list", origins: ["https://router.example:8443"] },
    }).success,
    true,
  );
});
test("layout is presentation-only and bounded; appearance never translates stored messages", () => {
  const window = {
    windowId: id(),
    projectId,
    conversationId,
    mode: "open",
    x: 0,
    y: 0,
    width: 420,
    height: 560,
    order: 1,
  };
  const layout = { schemaVersion: 1, revision: 1, windows: [window] };
  assert.equal(c.windowLayoutSchema.safeParse(layout).success, true);
  for (const key of [
    "text",
    "draft",
    "credentials",
    "runId",
    "autoSend",
    "stop",
  ])
    assert.equal(
      c.windowLayoutSchema.safeParse({
        ...layout,
        windows: [{ ...window, [key]: true }],
      }).success,
      false,
      key,
    );
  assert.equal(
    c.windowLayoutSchema.safeParse({ ...layout, windows: [window, window] })
      .success,
    false,
  );
  assert.equal(
    c.windowLayoutSchema.safeParse({
      ...layout,
      windows: Array.from({ length: 6 }, () => ({ ...window, windowId: id() })),
    }).success,
    false,
  );
  assert.equal(
    c.appearanceSchema.safeParse({
      schemaVersion: 1,
      revision: 1,
      theme: "system",
      locale: "vi",
    }).success,
    true,
  );
});
