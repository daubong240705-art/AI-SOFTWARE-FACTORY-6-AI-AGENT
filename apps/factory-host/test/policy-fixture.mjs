import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./org-fixture.mjs";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { budgetsSetHandler, DEFAULT_BUDGET_CONFIG, recordUsage } from "../dist/policy/budget.js";
import { setAutonomyHandler } from "../dist/policy/autonomy.js";

export function policyFixture(t) {
  const f = fixture(t);
  const config = { ...DEFAULT_BUDGET_CONFIG };
  const pipeline = createCommandPipeline({ storage: f.storage, hub: f.hub, clock: f.clock,
    handlers: { "budgets.set": budgetsSetHandler, "autonomy.set": setAutonomyHandler } });
  const command = (type, payload, projectId = f.projectId) => ({ apiVersion: 1, commandId: randomUUID(), projectId, type, payload });
  const execute = (type, payload, projectId) => pipeline.execute(command(type, payload, projectId));
  const budget = (scope, scopeRef, limitTokens = 100, patch = {}) => execute("budgets.set", {
    budgetId: randomUUID(), expectedRevision: null, scope, scopeRef, limitTokens, warnAtPercent: 80, ...patch,
  });
  const set = (subject, subjectRef, level, expectedRevision = null, projectId) =>
    execute("autonomy.set", { subject, subjectRef, level, expectedRevision }, projectId);
  const conversationId = randomUUID();
  f.raw.prepare("INSERT INTO conversations (project_id,id,revision,seat_id,task_id,title) VALUES (?,?,1,?,NULL,'Policy')")
    .run(f.projectId, conversationId, f.seats.find(s => s.isLead).id);
  const usage = (tokens, taskId = null, patch = {}) => recordUsage(f.raw, {
    id: randomUUID(), projectId: f.projectId, taskId, attemptId: null, conversationId,
    provider: "fake", model: "fake", effort: null, usage: null, estimatedTokens: tokens,
    recordedAt: f.clock().toISOString(), ...patch,
  });
  const mustBudget = (...args) => { const r = budget(...args); assert.equal(r.status, 200, JSON.stringify(r.body)); return r; };
  return { ...f, config, pipeline, command, execute, budget, mustBudget, set, usage };
}
