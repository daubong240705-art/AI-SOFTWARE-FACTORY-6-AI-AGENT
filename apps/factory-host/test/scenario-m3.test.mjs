import assert from "node:assert/strict";
import { getApprovalView } from "../dist/approvals/service.js";
import { test } from "node:test";
import { fixture, until, packs, request } from "./scenario-m3-fixture.mjs";
import { getPrimaryEngagement, findLeadSeat } from "../dist/org/index.js";
import { seatLoad } from "../dist/dispatch/node.js";
import { snapshot } from "./requests-fixture.mjs";

const timeout = { timeout: 14000 };
const error = (result, message) => {
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, message);
};
const shareDraft = (f, value) => f.ok("artifacts.share", { ...value, visibility: "team-draft" });
const staleRows = (f, value) => f.raw.prepare("SELECT * FROM knowledge_stale WHERE project_id=? AND artifact_id=? AND version=?")
  .all(f.projectId, value.artifactId, value.version);

test("M3 Project X: four real teams collaborate through scripted Fake attempts", timeout, async t => {
  const f = fixture(t);
  const s = {};

  await t.test("1. Researcher is selected by capability and reviewed research passes the L1 gate", timeout, async () => {
    assert.equal(Object.keys(f.teams).length, 4);
    assert.equal(f.primary.teamId, f.teams.software.id);
    assert.equal(findLeadSeat(f.raw, getPrimaryEngagement(f.raw, f.projectId).teamId).id, f.seat("software", "Lead").id);
    for (const [key, team] of Object.entries(f.teams)) {
      const pinned = f.raw.prepare("SELECT pack_key,pack_version,pack_digest FROM teams WHERE id=?").get(team.id);
      assert.equal(pinned.pack_key, packs[key].manifest.key);
      assert.equal(pinned.pack_version, packs[key].manifest.version);
      assert.match(pinned.pack_digest, /^[0-9a-f]{64}$/);
      assert.equal(team.seats.length, packs[key].manifest.seats.length);
    }
    s.research = await f.start("research", { title: "Research Project X", requiredCapabilities: ["research.evidence"] });
    assert.equal(f.task(s.research.taskId).ownerSeatId, f.seat("research", "Researcher").id);
    assert.equal(f.attempts(s.research.taskId)[0].runtime, "fake");
    s.report = f.output(s.research, "research-report", "Project X research report");
    assert.equal(f.row(s.report).status, "draft");
    assert.ok(f.row(s.report).abstract_l1.length >= 80);
    const noSummary = f.output(s.research, "research-report", "Unfinished evidence", { abstractL1: undefined });
    f.artifactTransition(noSummary, "in-review"); f.artifactTransition(noSummary, "reviewed");
    const refused = f.execute("artifacts.transition", { ...noSummary, to: "approved", comment: "Missing summary" });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.message, "summary (L1) is required before approval");
    assert.equal(f.row(noSummary).status, "reviewed");
    f.artifactTransition(noSummary, "rejected");
    for (const status of ["in-review", "reviewed", "approved"]) {
      f.artifactTransition(s.report, status); assert.equal(f.row(s.report).status, status);
    }
    await f.finish(s.research);
    assert.equal(f.task(s.research.taskId).state, "in-review");
    f.accept(s.research.taskId);
    assert.equal(f.task(s.research.taskId).state, "done");
    assert.equal(f.row(s.report).status, "approved");
  });

  await t.test("2. BA receives L1 context, pinned instructions and only its own skills", timeout, async () => {
    s.ba = await f.start("software", { title: "Project X requirements analysis", ownerSeatId: f.seat("software", "BA").id, inputs: [s.report] });
    const pack = f.raw.prepare("SELECT * FROM context_packs WHERE project_id=? AND attempt_id=?").get(f.projectId, s.ba.attemptId);
    assert.equal(pack.l1_count, 1);
    const context = JSON.parse(pack.pack_json);
    assert.equal(context.sections.inputs.length, 1);
    assert.deepEqual(context.sections.inputs[0].ref, s.report);
    assert.equal(context.sections.inputs[0].tier, "L1");
    assert.equal(context.sections.inputs[0].status, "approved");
    const instructions = f.raw.prepare("SELECT * FROM attempt_instructions WHERE project_id=? AND attempt_id=?").get(f.projectId, s.ba.attemptId);
    const digest = f.raw.prepare("SELECT pack_digest FROM teams WHERE id=?").get(f.teams.software.id).pack_digest;
    assert.equal(instructions.pack_digest, digest);
    assert.equal(instructions.profile_path, "profiles/ba.md");
    assert.equal(instructions.skills_count, packs.software.files.skills.length);
    assert.ok(instructions.bytes > 0);
    const delivered = f.context(s.ba.attemptId).instructions;
    const profile = f.raw.prepare("SELECT content FROM pack_files WHERE digest=? AND path=?").get(digest, "profiles/ba.md").content;
    assert.equal(delivered.profile, profile);
    assert.deepEqual(delivered.skills.map(skill => skill.name).sort(), packs.software.files.skills.map(skill => skill.name).sort());
    assert.equal(f.call(s.ba, "skill.get", { name: "implement-feature" }).content[0].text,
      packs.software.files.skills.find(skill => skill.name === "implement-feature").content);
    error(f.call(s.ba, "skill.get", { name: "write-adr" }), "skill not found");
    assert.equal(f.call(s.ba, "task.progress", { summary: "Research incorporated", percent: 20 }).isError, false);
    const reviewer = await f.start("design", { title: "Review Project X", requiredCapabilities: ["review.design"] });
    assert.equal(f.task(reviewer.taskId).ownerSeatId, f.seat("design", "Design Reviewer").id);
    const tools = f.send(reviewer, "tools/list").tools.map(tool => tool.name);
    assert.equal(tools.includes("request.create"), false);
    assert.equal(tools.includes("request.reply"), true);
    const before = snapshot(f.raw);
    error(f.call(reviewer, "request.create", request(f.teams.architecture.id)), "tool is not available");
    assert.equal(snapshot(f.raw), before);
    await f.finish(reviewer); f.accept(reviewer.taskId);
  });

  await t.test("3. Parallel consult and blocking clarify enforce exact grants, deduplication and resume", timeout, async () => {
    s.requirementsDraft = f.output(s.ba, "requirements", "Project X requirements draft"); shareDraft(f, s.requirementsDraft);
    s.unrelated = f.output(s.ba, "other", "Unrelated BA working notes"); shareDraft(f, s.unrelated);
    const consult = f.value(s.ba, "request.create", request(f.teams.architecture.id, { contextRefs: [s.report, s.requirementsDraft] }));
    s.consult = consult.requestId;
    assert.equal(consult.merged, false);
    assert.equal(f.task(s.consult).state, "active");
    assert.equal(f.raw.prepare("SELECT triage_state FROM ctr_meta WHERE task_id=?").get(s.consult).triage_state, "accepted");
    assert.equal(f.attempts(s.ba.taskId).at(-1).state, "running", "async consult keeps BA running");
    s.architect = await f.live(s.consult);
    const requestContext = JSON.parse(f.raw.prepare("SELECT pack_json FROM context_packs WHERE attempt_id=?").get(s.architect.attemptId).pack_json);
    assert.deepEqual(requestContext.sections.inputs.map(item => item.ref), [s.report, s.requirementsDraft]);
    for (const value of [s.report, s.requirementsDraft]) {
      const document = f.value(s.architect, "knowledge.get", { ...value, level: "l2" });
      assert.equal(document.artifactId, value.artifactId);
      assert.match(document.text, /Project X/);
    }
    error(f.call(s.architect, "knowledge.get", { ...s.unrelated, level: "l2" }), "not found");
    assert.equal(f.row(s.requirementsDraft).visibility, "team-draft");
    s.adr = f.output(s.architect, "adr", "Project X architecture decision");
    s.model1 = f.output(s.architect, "data-model", "Project X data model");
    f.approve(s.adr); f.approve(s.model1);
    // Keep this consult open for the model revision in step 4: output version
    // lineage is task-scoped. Immediate acceptance is exercised independently below.
    await f.finish(s.architect);
    assert.equal(f.task(s.consult).state, "in-review");
    assert.deepEqual(f.value(s.ba, "request.get", { requestId: s.consult }).deliverables.map(item => item.title).sort(),
      ["Project X architecture decision", "Project X data model"]);

    const follower = await f.start("software", { title: "Parallel analysis", ownerSeatId: f.seat("software", "PM").id });
    s.follower = follower;
    const clarifyInput = request(f.teams.design.id, { kind: "clarify", subject: "Project X interaction clarification", ask: "[fake:hang] Clarify Project X screen states", responseMode: "blocking" });
    const clarify = f.value(s.ba, "request.create", clarifyInput);
    s.clarify = clarify.requestId;
    const duplicate = f.value(follower, "request.create", clarifyInput);
    assert.equal(duplicate.requestId, s.clarify);
    assert.equal(duplicate.merged, true);
    assert.match(clarify.message, /resumed with the answer/);
    // The synchronous tool response leaves a live grace period before parking.
    f.value(s.ba, "request.reply", { requestId: s.clarify, action: "message", message: "Include empty and error states" });
    await until(() => [s.ba, follower].every(grant => f.attempts(grant.taskId)[0].state === "parked"), "both requesters parked");
    for (const grant of [s.ba, follower]) {
      assert.equal(f.attempts(grant.taskId)[0].leaseId, null, "parked attempt releases its lease");
      assert.equal(seatLoad(f.raw, f.task(grant.taskId).ownerSeatId).used, 0, "parked attempt releases seat capacity");
      assert.equal(f.task(grant.taskId).holds.some(hold => hold.kind === "cross-team"), true);
    }
    s.designer = await f.live(s.clarify);
    assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM artifact_versions WHERE produced_by_attempt_id=?").get(s.designer.attemptId).n, 0);
    assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM ctr_followers WHERE task_id=?").get(s.clarify).n, 1);
    s.ui = f.output(s.designer, "ui-spec", "Project X interface specification");
    f.approve(s.ui);
    await f.finish(s.designer);
    s.ba = await f.live(s.ba.taskId);
    s.follower = await f.live(follower.taskId);
    for (const grant of [s.ba, s.follower]) {
      assert.equal(grant.epoch, 2);
      assert.equal(f.task(grant.taskId).holds.some(hold => hold.kind === "cross-team"), false);
      assert.match(f.context(grant.attemptId).handoff, /Request results:/);
      assert.match(f.context(grant.attemptId).handoff, /Project X interface specification/);
      const wait = f.raw.prepare("SELECT outcome,resolved_at FROM ctr_waits WHERE waiter_task_id=? AND ctr_task_id=?").get(grant.taskId, s.clarify);
      assert.equal(wait.outcome, "delivered"); assert.ok(wait.resolved_at);
    }
    const thread = f.value(s.ba, "request.get", { requestId: s.clarify });
    assert.equal(thread.thread.filter(message => message.text === "Include empty and error states").length, 1);
    assert.equal(thread.waiting, 0);
    f.value(s.ba, "request.reply", { requestId: s.clarify, action: "accept" });
    assert.equal(f.task(s.clarify).state, "done");
  });

  await t.test("4. Model supersession marks dependants stale and appears in dossier and briefing", timeout, async () => {
    s.dependent = f.output(s.ba, "plan", "Project X integration assumptions", { inputs: [s.model1] });
    s.openBa = await f.start("software", { title: "Validate model inputs", ownerSeatId: f.seat("software", "BE").id, inputs: [s.model1] });
    const baseline = f.refresh();
    const since = f.row(baseline).created_at;
    f.tick();
    f.value(s.ba, "request.reply", { requestId: s.consult, action: "request-changes", message: "Revise the model for the clarified screen states" });
    s.architect = await f.live(s.consult);
    assert.equal(s.architect.epoch, 2);
    s.model2 = f.output(s.architect, "data-model", "Project X data model", { inputs: [s.report, s.ui] });
    assert.equal(s.model2.artifactId, s.model1.artifactId);
    assert.equal(s.model2.version, 2);
    assert.equal(f.row(s.model2).supersedes_version, 1);
    assert.equal(f.row(s.model1).status, "superseded");
    f.approve(s.model2);
    assert.equal(f.row(s.model2).status, "approved");
    assert.equal(staleRows(f, s.dependent).length, 1);
    assert.equal(staleRows(f, s.dependent)[0].because_version, 2);
    const inputHold = f.task(s.openBa.taskId).holds.find(hold => hold.kind === "input");
    assert.ok(inputHold); assert.equal(inputHold.needsAction, true);
    const dossier = f.refresh();
    assert.equal(f.row(dossier).status, "draft");
    const document = await f.read("dossier");
    assert.match(document.dossier.markdown, /Project X integration assumptions/);
    assert.match(document.dossier.markdown, /Superseded input/);
    const briefing = await f.read(`briefing?since=${encodeURIComponent(since)}`);
    assert.equal(briefing.freshness.stale.some(item => item.ref.artifactId === s.dependent.artifactId), true);
    assert.equal(briefing.suggestions.some(text => /Refresh .*stale artifacts/.test(text)), true);
    assert.ok(briefing.changes.artifactsSuperseded.count >= 1);
    f.ok("artifacts.clear-stale", { ...s.dependent, becauseArtifactId: s.model2.artifactId, becauseVersion: 2 });
    assert.deepEqual(staleRows(f, s.dependent), []);
    assert.equal(f.value(s.ba, "knowledge.get", s.dependent).stale, false);
    await f.finish(s.architect);
    f.value(s.ba, "request.reply", { requestId: s.consult, action: "accept" });
    assert.equal(f.task(s.consult).state, "done");
    await f.finish(s.openBa); f.accept(s.openBa.taskId);
  });

  await t.test("5. Approved requirements pin all inputs and implementation waits in the Go inbox", timeout, async () => {
    const inputs = [s.report, s.adr, s.model2, s.ui];
    s.requirements = f.output(s.ba, "requirements", "Project X requirements", { inputs });
    const pinned = f.raw.prepare("SELECT input_artifact_id AS artifactId,input_version AS version FROM artifact_inputs WHERE project_id=? AND artifact_id=? AND version=?")
      .all(f.projectId, s.requirements.artifactId, s.requirements.version);
    assert.deepEqual(pinned.sort((a,b) => a.artifactId.localeCompare(b.artifactId)), [...inputs].sort((a,b) => a.artifactId.localeCompare(b.artifactId)));
    assert.equal(f.row(s.requirements).status, "draft");
    assert.ok(f.row(s.requirements).abstract_l1);
    await f.finish(s.ba);
    assert.equal(f.row(s.requirements).status, "in-review");
    f.accept(s.ba.taskId);
    assert.equal(f.task(s.ba.taskId).state, "done");
    assert.equal(f.row(s.requirements).status, "approved");
    s.implementation = f.createTask("software", { title: "Implement Project X", ownerSeatId: f.seat("software", "FE").id, inputs: [s.requirements], requiresGo: true });
    assert.equal(f.task(s.implementation).state, "awaiting-go");
    assert.equal(f.attempts(s.implementation).length, 0);
    const inbox = await f.read("inbox");
    assert.equal(inbox.startGates.some(item => item.taskId === s.implementation && item.title === "Implement Project X"), true);
    assert.equal(inbox.counts.startGates, 1);
  });

  await t.test("6. Nested requests stop at three hops and reject own-team requests", timeout, async () => {
    let by = s.follower;
    const chain = [];
    for (const [index, team] of ["research", "architecture", "design"].entries()) {
      const result = f.value(by, "request.create", request(f.teams[team].id, { subject: `Nested question ${index + 1}`, ask: `[fake:hang] Nested Project X question ${index + 1}` }));
      chain.push(result.requestId);
      assert.equal(f.task(result.requestId).origin.hop, index + 1);
      by = await f.live(result.requestId);
    }
    let before = snapshot(f.raw);
    error(f.call(by, "request.create", request(f.teams.software.id)), "request chain is too deep");
    assert.equal(snapshot(f.raw), before);
    before = snapshot(f.raw);
    error(f.call(s.follower, "request.create", request(f.teams.software.id)), "ask another team");
    assert.equal(snapshot(f.raw), before);
    assert.equal(new Set(chain).size, 3);
    assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM ctr_meta WHERE root_task_id=?").get(s.follower.taskId).n, 3);
    // Close the nested work so the final dossier has room for the implementation task.
    for (const id of chain.reverse()) { const grant = await f.live(id); await f.finish(grant); f.transition(id, "done"); }
  });

  await t.test("7. Closing dossier names canonical versions and Go work; later approval outdates it", timeout, async () => {
    await f.finish(s.follower); f.accept(s.follower.taskId);
    s.designBrief = await f.start("design", { title: "Read final Project X briefing", requiredCapabilities: ["design.ui"] });
    const architecture = await f.start("architecture", { title: "Private architecture exploration", requiredCapabilities: ["architecture.adr"] });
    const privateDraft = f.output(architecture, "plan", "Private architecture alternative"); shareDraft(f, privateDraft);
    const dossier = f.refresh();
    const document = await f.read("dossier");
    assert.equal(document.dossier.state, "current");
    assert.equal(document.dossier.status, "draft");
    assert.deepEqual(document.dossier.ref, dossier);
    for (const title of ["Software Team", "Research Team", "Architecture Team", "Design Team", "Project X research report", "Project X architecture decision", "Project X data model", "Project X interface specification", "Project X requirements", "Implement Project X"])
      assert.ok(document.dossier.markdown.includes(title), `dossier contains ${title}`);
    assert.ok(document.dossier.markdown.includes(`${s.model2.artifactId}@2`));
    assert.equal(document.dossier.markdown.includes(`${s.model1.artifactId}@1`), false);
    assert.match(document.dossier.markdown, /Awaiting Go: 1/);
    const since = f.row(dossier).created_at;
    f.tick();
    const extra = f.output(s.designBrief, "ui-spec", "Project X accessibility addendum"); f.approve(extra);
    assert.equal((await f.read("dossier")).dossier.state, "outdated");
    const briefing = await f.read(`briefing?since=${encodeURIComponent(since)}`);
    assert.equal(briefing.baseline.since, since);
    assert.equal(briefing.changes.artifactsApproved.examples.some(text => text.includes("Project X accessibility addendum")), true);
    assert.equal(briefing.changes.artifactsRegistered.count, 1);
    const scoped = f.value(s.designBrief, "project.briefing", {});
    assert.equal(JSON.stringify(scoped).includes("Private architecture alternative"), false);
    error(f.call(s.designBrief, "knowledge.get", privateDraft), "not found");
    assert.equal(scoped.teams.length, 4);
    assert.equal(scoped.suggestions.some(text => /wait for your Go/.test(text)), true);
  });
});

test("3a. Async architecture consult can be accepted immediately after delivery", timeout, async t => {
  const f = fixture(t);
  const ba = await f.start("software", { ownerSeatId: f.seat("software", "BA").id });
  const result = f.value(ba, "request.create", request(f.teams.architecture.id));
  const architect = await f.live(result.requestId);
  const adr = f.output(architect, "adr", "Accepted architecture decision");
  const model = f.output(architect, "data-model", "Accepted data model");
  await f.finish(architect);
  assert.equal(f.task(result.requestId).state, "in-review");
  const delivered = f.value(ba, "request.get", { requestId: result.requestId });
  assert.deepEqual(new Set(delivered.deliverables.map(item => item.artifactId)), new Set([adr.artifactId, model.artifactId]));
  f.value(ba, "request.reply", { requestId: result.requestId, action: "accept" });
  assert.equal(f.task(result.requestId).state, "done");
  assert.equal(f.attempts(ba.taskId).at(-1).state, "running");
});

for (const [kind, requestLimits] of [
  ["request", { maxRequestsPerRoot: 1, maxAttemptsPerRoot: 4 }],
  ["attempt", { maxRequestsPerRoot: 4, maxAttemptsPerRoot: 2 }],
]) test(`6a. Injected root ${kind} budget refuses without writes on Project X`, timeout, async t => {
  const f = fixture(t, { requestLimits });
  const ba = await f.start("software", { ownerSeatId: f.seat("software", "BA").id });
  const first = f.value(ba, "request.create", request(f.teams.architecture.id));
  await f.live(first.requestId);
  const before = snapshot(f.raw);
  error(f.call(ba, "request.create", request(f.teams.design.id)), "request budget exhausted");
  assert.equal(snapshot(f.raw), before);
  assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM ctr_meta WHERE root_task_id=?").get(ba.taskId).n, 1);
});

test("6c. Produce request follows operator triage, capability ownership and the release gate", timeout, async t => {
  const f = fixture(t);
  const ba = await f.start("software", { ownerSeatId: f.seat("software", "BA").id });
  const result = f.value(ba, "request.create", request(f.teams.design.id, { kind: "produce", subject: "Produce Project X screens" }));
  assert.equal(f.task(result.requestId).state, "proposed");
  assert.equal(f.attempts(result.requestId).length, 0);
  f.ok("requests.triage", { requestTaskId: result.requestId, decision: "need-info", reason: "Which screen states?" });
  assert.equal(f.value(ba, "request.get", { requestId: result.requestId }).triageState, "need-info");
  f.value(ba, "request.reply", { requestId: result.requestId, action: "message", message: "Include loading and empty states" });
  assert.equal(f.value(ba, "request.get", { requestId: result.requestId }).triageState, "submitted");
  f.ok("requests.triage", { requestTaskId: result.requestId, decision: "accept", reason: "Scope is ready", ownerSeatId: f.seat("design", "UI Designer").id });
  assert.equal(f.task(result.requestId).ownerSeatId, f.seat("design", "UI Designer").id);
  assert.equal(f.task(result.requestId).state, "awaiting-go");
  assert.equal((await f.read("inbox")).startGates.some(item => item.taskId === result.requestId), true);
  f.ok("tasks.release", { taskId: result.requestId, expectedRevision: f.task(result.requestId).revision });
  const designer = await f.live(result.requestId);
  const ui = f.output(designer, "ui-spec", "Triaged screen specification");
  await f.finish(designer);
  assert.equal(f.row(ui).status, "in-review");
  f.value(ba, "request.reply", { requestId: result.requestId, action: "accept" });
  assert.equal(f.task(result.requestId).state, "done");
});

test("6b. Flag-off fixture hides and refuses requests without writing anything", timeout, async t => {
  const f = fixture(t, { multiTeam: false });
  const ba = await f.start("software", { ownerSeatId: f.seat("software", "BA").id });
  assert.equal(f.send(ba, "tools/list").tools.some(tool => tool.name.startsWith("request.")), false);
  const before = snapshot(f.raw);
  error(f.call(ba, "request.create", request(f.teams.software.id)), "multi-team is disabled");
  assert.equal(snapshot(f.raw), before);
  assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM ctr_meta").get().n, 0);
});

test("an automatic architecture consult is owned by a worker seat, never by the Lead", timeout, async t => {
  // Regression for a defect found by this scenario: insertRequest used to pin the Lead (api-agent runtime) as owner.
  const f = fixture(t);
  const explicitCapabilityTask = await f.start("architecture", { requiredCapabilities: ["architecture.adr"] });
  assert.equal(f.task(explicitCapabilityTask.taskId).ownerSeatId, f.seat("architecture", "Architect").id);
  const ba = await f.start("software", { ownerSeatId: f.seat("software", "BA").id });
  const result = f.value(ba, "request.create", request(f.teams.architecture.id));
  const grant = await f.live(result.requestId);
  const owner = f.task(result.requestId).ownerSeatId;
  assert.notEqual(owner, f.seat("architecture", "Lead").id);
  assert.notEqual(f.context(grant.attemptId).seat.name, "Lead");
  assert.ok(f.raw.prepare("SELECT 1 FROM seats WHERE id = ? AND team_id = ? AND is_lead = 0").get(owner, f.teams.architecture.id));
  // The Architect is busy: the least-loaded worker takes the consult, in manifest order (Data Designer before the Reviewer).
  assert.equal(owner, f.seat("architecture", "Data Designer").id);
});

test("accepting a task review refuses to approve a document without its L1 summary and changes nothing", timeout, async t => {
  // Regression for a defect found by this scenario: setTaskArtifactStatus skipped the multi-team L1 gate.
  const f = fixture(t);
  const researcher = await f.start("research", { requiredCapabilities: ["research.evidence"] });
  const report = f.output(researcher, "research-report", "Evidence without summary", { abstractL1: undefined });
  await f.finish(researcher);
  assert.equal(f.row(report).abstract_l1, null);
  assert.equal(f.row(report).status, "in-review");
  const pending = f.raw.prepare("SELECT id FROM approvals WHERE project_id=? AND task_id=? AND state='pending'").get(f.projectId, researcher.taskId);
  const approval = getApprovalView(f.raw, f.projectId, pending.id);
  const result = f.execute("approvals.decide", { approvalId: approval.id, expectedRevision: approval.revision, contextDigest: approval.context.digest, optionId: "accept", comment: "Verified" });
  assert.equal(result.status, 409, JSON.stringify(result.body));
  assert.equal(result.body.error.message, "summary (L1) is required before approval");
  assert.equal(f.row(report).status, "in-review");
  assert.equal(f.task(researcher.taskId).state, "in-review");
  assert.equal(getApprovalView(f.raw, f.projectId, pending.id).state, "pending");
});
