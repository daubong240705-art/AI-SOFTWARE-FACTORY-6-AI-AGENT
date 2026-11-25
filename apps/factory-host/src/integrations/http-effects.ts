import type { Database } from "better-sqlite3";
import type { EventHub } from "../events/hub.js";
import type { HttpOperation } from "@factory/contracts";
import { authHeaders, requestParams, responseBody, type HttpIntegration } from "./http.js";
import { callHash, type IntegrationStore } from "./store.js";

type HttpEffect = { id: string; state: "pending" | "done" | "failed" | "unknown"; error: string | null; output: unknown };
type Row = { id: string; state: HttpEffect["state"]; error: string | null; output_json: string | null; target_json: string };
type Input = { projectId: string; caller: string; attemptId?: string; nodeAttempt?: number; beforeSend?: () => void;
  integration: HttpIntegration; operation: HttpOperation; args: unknown };
export function createHttpEffects(deps: { raw: Database; hub: EventHub; clock: () => Date; newId: () => string; store: IntegrationStore; fetch?: typeof fetch }) {
  const { raw, hub } = deps;
  const fetcher = deps.fetch ?? fetch;
  const running = new Map<string, Promise<HttpEffect>>();
  const controllers = new Set<AbortController>();
  let closed = false;
  const getRow = (projectId: string, id: string) => raw.prepare<[string, string], Row>("SELECT * FROM effects WHERE project_id=? AND id=? AND kind='http.request'").get(projectId, id);
  const view = (row: Row): HttpEffect => ({ id: row.id, state: row.state, error: row.error, output: row.output_json ? JSON.parse(row.output_json) : null });
  const publish = (projectId: string, id: string, revision: number) => {
    if (hub.currentCursor(projectId) !== null) hub.append({ projectId, causationId: id,
      payload: { type: "entity.changed", entity: { kind: "effect", id, revision } } });
  };
  const update = (projectId: string, id: string, from: HttpEffect["state"], state: HttpEffect["state"], error: string | null, output: unknown) => hub.transaction(() => {
    const changed = raw.prepare(`UPDATE effects SET state=?,error=?,output_json=?,completed_at=? WHERE project_id=? AND id=? AND state=? AND kind='http.request'`)
      .run(state, error, state === "done" ? JSON.stringify(output) : null, state === "unknown" ? null : deps.clock().toISOString(), projectId, id, from);
    if (changed.changes) publish(projectId, id, from === "unknown" ? 3 : 2);
    return view(getRow(projectId, id)!);
  });
  const latest = (projectId: string, caller: string) => raw.prepare<[string, string], Row>(`SELECT * FROM effects WHERE project_id=?
    AND kind='http.request' AND json_extract(target_json,'$.caller')=? ORDER BY rowid DESC LIMIT 1`).get(projectId, caller);
  return {
    latest(projectId: string, caller: string) { const row = latest(projectId, caller); return row ? view(row) : null; },
    list(projectId: string) { return raw.prepare<[string], Row>("SELECT * FROM effects WHERE project_id=? AND kind='http.request' ORDER BY rowid").all(projectId)
      .map(({ id, state, error }) => ({ id, state, error })); },
    reconcile(projectId: string, id: string, resolution: "done" | "failed") {
      const row = getRow(projectId, id);
      if (!row || row.state !== "unknown") return false;
      update(projectId, id, "unknown", resolution, resolution === "failed" ? "Operator confirmed request failed" : null, null);
      return true;
    },
    async check(integration: HttpIntegration): Promise<void> {
      const { headers } = authHeaders(deps.store, integration);
      const response = await fetcher(integration.config.baseUrl, { headers, signal: AbortSignal.timeout(10_000), redirect: "error", credentials: "omit" });
      await response.body?.cancel();
      if (!response.ok) throw new Error("Integration connection check failed");
    },
    proxyHeaders(integration: Extract<import("@factory/contracts").Integration, { kind: "mcp-http" }>) {
      return Object.fromEntries(Object.entries(integration.config.headers).map(([name, val]) => [name,
        "credential" in val ? deps.store.read(val.credential, integration.scopeGroupId) : val.value]));
    },
    submit(input: Input): Promise<HttpEffect> {
      const { integration, operation, args, projectId, caller } = input;
      if (closed) throw new Error("HTTP effect executor unavailable");
      const request = requestParams(integration, operation, args);
      const key = `${caller}:${input.nodeAttempt ?? 0}:${callHash({ integration: integration.id, operation: operation.name, args })}`;
      const row = hub.transaction(() => {
        const prior = input.nodeAttempt === undefined ? undefined : latest(projectId, caller);
        const existing = raw.prepare<[string, string], Row>("SELECT * FROM effects WHERE project_id=? AND idempotency_key=?").get(projectId, key)
          ?? (prior && (prior.state !== "failed" || JSON.parse(prior.target_json).nodeAttempt === input.nodeAttempt) ? prior : undefined);
        if (existing) return { ...existing, created: false };
        const id = deps.newId();
        raw.prepare(`INSERT INTO effects (project_id,id,attempt_id,kind,idempotency_key,target_json,state,created_at)
          VALUES (?,?,?,'http.request',?,?,'pending',?)`).run(projectId, id, input.attemptId ?? null, key,
          JSON.stringify({ caller, nodeAttempt: input.nodeAttempt, integrationId: integration.id, operation: operation.name, sideEffect: operation.sideEffect }), deps.clock().toISOString());
        publish(projectId, id, 1);
        return { ...getRow(projectId, id)!, created: true };
      });
      if (!row.created) return running.get(row.id) ?? Promise.resolve(view(row));
      const job = Promise.resolve().then(async () => {
        if (!raw.open || !getRow(projectId, row.id)) return { ...view(row), state: "failed" as const, error: "HTTP effect was not committed" };
        const controller = new AbortController();
        controllers.add(controller);
        const timer = setTimeout(() => controller.abort(), 10_000);
        let sent = false;
        try {
          if (closed) throw new Error();
          input.beforeSend?.();
          const { headers, secrets } = authHeaders(deps.store, integration);
          if (request.body !== undefined) headers.set("content-type", "application/json");
          if (operation.sideEffect === "external") headers.set("idempotency-key", row.id);
          sent = true;
          const response = await fetcher(request.url, { method: request.method, headers, signal: controller.signal,
            redirect: "error", credentials: "omit", ...(request.body === undefined ? {} : { body: request.body }) });
          if (!response.ok) {
            await response.body?.cancel();
            return update(projectId, row.id, "pending", operation.sideEffect === "external" && response.status >= 500 ? "unknown" : "failed",
              `HTTP response status ${response.status}`, null);
          }
          return update(projectId, row.id, "pending", "done", null, await responseBody(response, secrets));
        } catch {
          const state = sent && operation.sideEffect === "external" ? "unknown" : "failed";
          return update(projectId, row.id, "pending", state, state === "unknown" ? "HTTP outcome unknown; reconcile before retrying" : "HTTP request failed", null);
        } finally { clearTimeout(timer); controllers.delete(controller); }
      }).finally(() => { running.delete(row.id); });
      running.set(row.id, job);
      return job;
    },
    recoverAtStart() {
      for (const row of raw.prepare<[], { project_id: string } & Row>("SELECT * FROM effects WHERE kind='http.request' AND state='pending'").all()) {
        const state = JSON.parse(row.target_json).sideEffect === "none" ? "failed" : "unknown";
        update(row.project_id, row.id, "pending", state, "HTTP request interrupted", null);
      }
    },
    async close() {
      closed = true;
      for (const controller of controllers) controller.abort();
      await Promise.allSettled(running.values());
    },
  };
}
export type HttpEffects = ReturnType<typeof createHttpEffects>;
