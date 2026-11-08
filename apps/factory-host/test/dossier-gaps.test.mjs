// Closes mutation survivors of the X1b review: credential redaction, canonical selection, open-request and
// next-step filters, risk causes, suggestion texts and the default briefing baseline.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fixture, BEFORE, AFTER } from "./dossier-fixture.mjs";

test("credential-looking text in titles and summaries never reaches the dossier", (t) => {
  const f = fixture(t);
  f.artifact({ title: "Plan Bearer abcdef123456 here", l0: "Use password: hunter2value for the setup" });
  const text = JSON.stringify(f.build());
  assert.doesNotMatch(text, /abcdef123456|hunter2value/);
});
test("an approved version stays canonical while a newer draft exists", (t) => {
  const f = fixture(t); const id = randomUUID();
  f.artifact({ artifactId: id, version: 1, status: "approved", title: "Spec v1" });
  f.artifact({ artifactId: id, version: 2, status: "draft", title: "Spec v2", supersedes: 1 });
  const items = f.build().canonical.flatMap((group) => group.items);
  assert.deepEqual(items.map((item) => `${item.ref.artifactId}@${item.ref.version}`), [`${id}@1`]);
});
test("finished and abandoned requests are not listed as open", (t) => {
  const f = fixture(t); const seatId = f.grant().seatId;
  const make = (state) => { const id = f.request({ triageState: "accepted" });
    f.raw.prepare("UPDATE tasks SET state = ?, owner_seat_id = ? WHERE id = ?").run(state, seatId, id); return id; };
  const open = make("active");
  for (const state of ["done", "cancelled", "declined", "superseded"]) make(state);
  assert.deepEqual(f.build().openRequests.length, 1);
  assert.ok(open);
});
test("next steps list only ready, awaiting-go and active tasks", (t) => {
  const f = fixture(t);
  for (const state of ["ready", "awaiting-go", "active"]) f.task({ state, title: `Step ${state}` });
  for (const state of ["done", "failed", "cancelled", "proposed", "draft"]) f.task({ state, title: `Skip ${state}` });
  const titles = f.build().nextSteps.map((step) => step.title).sort();
  assert.deepEqual(titles, ["Step active", "Step awaiting-go", "Step ready"]);
});
test("a newer approved version is not reported as a newer draft risk", (t) => {
  const f = fixture(t); const id = randomUUID();
  f.artifact({ artifactId: id, version: 1, status: "approved" });
  f.artifact({ artifactId: id, version: 2, status: "approved", supersedes: 1 });
  assert.equal(f.build().risks.length, 0);
});
test("a newer draft makes the approved version a risk with its cause", (t) => {
  const f = fixture(t); const id = randomUUID();
  f.artifact({ artifactId: id, version: 1, status: "approved" });
  f.artifact({ artifactId: id, version: 2, status: "draft", supersedes: 1 });
  const risks = f.build().risks; assert.equal(risks.length, 1); assert.match(risks[0].because, new RegExp(`${id}@2`));
});
test("the stale suggestion names the count and the research request", (t) => {
  const f = fixture(t); const source = f.artifact({ title: "Source" }); const derived = f.artifact({ title: "Derived" });
  f.artifact({ artifactId: source.artifactId, version: 2, status: "approved", supersedes: 1 });
  f.raw.prepare("INSERT INTO knowledge_stale VALUES (?,?,?,?,?,?)").run(f.projectId, derived.artifactId, derived.version, source.artifactId, source.version + 1, AFTER);
  assert.ok(f.briefing().suggestions.includes("Refresh 1 stale artifacts through a research request"));
});
test("the default baseline is the newest dossier, not the first project event", (t) => {
  const f = fixture(t);
  f.event({ type: "entity.changed", entity: { kind: "project", id: f.projectId, revision: 1 } }, BEFORE);
  const ref = f.refresh(); const created = f.row(ref).created_at;
  assert.notEqual(created, BEFORE);
  assert.equal(f.briefing().baseline.since, created);
});
test("the digest ignores risks that concern the dossier itself", async (t) => {
  const { dossierDigest } = await import("../dist/dossier/build.js");
  const f = fixture(t); const id = randomUUID();
  f.artifact({ artifactId: id, version: 1, kind: "dossier", status: "approved", title: "Project Dossier" });
  f.artifact({ artifactId: id, version: 2, kind: "dossier", status: "draft", title: "Project Dossier", supersedes: 1 });
  const dossier = f.build();
  assert.ok(dossier.risks.some((risk) => risk.ref.artifactId === id));
  assert.equal(dossierDigest(dossier), dossierDigest({ ...dossier, risks: dossier.risks.filter((risk) => risk.ref.artifactId !== id) }));
});
