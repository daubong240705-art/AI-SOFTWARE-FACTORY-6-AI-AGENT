import { createHash } from "node:crypto";
import type { Database } from "better-sqlite3";
import { credentialSchema, integrationSchema, type Integration, type IntegrationSpec } from "@factory/contracts";
import { groupChain, projectGroupId } from "../groups/settings.js";
import { CommandError } from "../commands/errors.js";
import type { ExternalDefinition } from "../mcp-external/client.js";
import type { credentialCrypto } from "./crypto.js";

type Crypto = ReturnType<typeof credentialCrypto>;
type IntegrationRow = { id: string; revision: number; name: string; kind: string; scope_group_id: string | null; config_json: string;
  status: string; last_check_at: string | null; last_check_json: string | null; created_at: string; updated_at: string };
type CredentialRow = { id: string; name: string; revision: number; scope_group_id: string | null; last4: string;
  created_at: string; updated_at: string; ciphertext: Buffer; nonce: Buffer; key_id: string };
export const integrationToolPattern = /^(ext|http)\.([a-z0-9][a-z0-9-]{1,29})\.([A-Za-z0-9_-]{1,64}|\*)$/;
export const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export const callHash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
export function credentialIds(spec: IntegrationSpec): string[] {
  if (spec.kind === "http-api") {
    const { auth } = spec.config;
    return auth === "none" ? [] : ["bearer" in auth ? auth.bearer : auth.credential];
  }
  return Object.values(spec.kind === "mcp-stdio" ? spec.config.env : spec.config.headers)
    .flatMap((value) => "credential" in value ? [value.credential] : []);
}
export function createIntegrationStore(raw: Database, crypto: () => Crypto, clock: () => Date) {
  const now = () => clock().toISOString();
  const rows = () => raw.prepare<[], IntegrationRow>("SELECT * FROM integrations ORDER BY name,id").all();
  const row = (id: string) => raw.prepare<[string], IntegrationRow>("SELECT * FROM integrations WHERE id=?").get(id);
  const cred = (id: string) => raw.prepare<[string], CredentialRow>("SELECT * FROM credentials WHERE id=?").get(id);
  const groups = (scope: string | null) => [...groupChain(raw, scope).map(({ id }) => id), null];
  const view = (record: IntegrationRow): Integration => integrationSchema.parse({ id: record.id, revision: record.revision,
    kind: record.kind, name: record.name, scopeGroupId: record.scope_group_id, config: JSON.parse(record.config_json), status: record.status,
    lastCheckAt: record.last_check_at, lastCheck: record.last_check_json ? JSON.parse(record.last_check_json) : null,
    createdAt: record.created_at, updatedAt: record.updated_at, tools: raw.prepare<[string], { name: string; description: string;
      input_schema_json: string; discovered_at: string }>("SELECT * FROM integration_tools WHERE integration_id=? ORDER BY name").all(record.id)
      .map((tool) => ({ name: tool.name, description: tool.description, inputSchema: JSON.parse(tool.input_schema_json), discoveredAt: tool.discovered_at })) });
  const get = (id: string) => { const record = raw.open ? row(id) : undefined; return record && view(record); };
  const putTools = (id: string, tools: ExternalDefinition[]) => {
    raw.prepare("DELETE FROM integration_tools WHERE integration_id=?").run(id);
    const insert = raw.prepare("INSERT INTO integration_tools VALUES (?,?,?,?,?)");
    for (const tool of tools) insert.run(id, tool.name, tool.description, JSON.stringify(tool.inputSchema), now());
  };
  const validateGroup = (scope: string | null) => {
    if (scope !== null && !raw.prepare("SELECT 1 FROM groups WHERE id=?").get(scope))
      throw new CommandError("not-found", "Integration scope group not found", "correct-input");
  };
  const checkRevision = (record: { revision: number } | undefined, expected: number) => {
    if (!record) throw new CommandError("not-found", "Integration or credential not found", "correct-input");
    if (record.revision !== expected) throw new CommandError("conflict", "Revision changed", "refresh", { currentRevision: record.revision });
  };
  const read = (id: string, scope: string | null) => {
    const record = cred(id);
    if (!record || !groups(scope).includes(record.scope_group_id)) throw new Error("Integration credential unavailable");
    return crypto().decrypt(id, record);
  };
  const visible = (scope: string | null) => {
    const chain = groups(scope);
    const selected = new Map<string, IntegrationRow>();
    for (const record of rows()) {
      if (!chain.includes(record.scope_group_id)) continue;
      const prior = selected.get(record.name);
      if (!prior || chain.indexOf(prior.scope_group_id) > chain.indexOf(record.scope_group_id)) selected.set(record.name, record);
    }
    return [...selected.values()].map(view);
  };
  return {
    get, read, visible, validateGroup,
    list: (scope?: string) => scope === undefined ? rows().map(view) : visible(scope),
    forProject: (projectId: string) => visible(projectGroupId(raw, projectId)),
    credentials: () => raw.prepare<[], CredentialRow>("SELECT id,name,revision,scope_group_id,last4,created_at,updated_at FROM credentials ORDER BY name,id").all()
      .map((record) => credentialSchema.parse({ id: record.id, name: record.name, revision: record.revision, scopeGroupId: record.scope_group_id,
        last4: record.last4, createdAt: record.created_at, updatedAt: record.updated_at })),
    save(id: string, spec: IntegrationSpec, expected?: number) {
      validateGroup(spec.scopeGroupId);
      const prior = row(id);
      if (expected !== undefined) checkRevision(prior, expected);
      if ((prior && expected === undefined) || raw.prepare("SELECT 1 FROM integrations WHERE name=? AND scope_group_id IS ? AND id<>?")
        .get(spec.name, spec.scopeGroupId, id)) throw new CommandError("conflict", "Integration already exists", "refresh");
      if (Buffer.byteLength(JSON.stringify(spec.config)) > 128 * 1024) throw new CommandError("validation", "Integration config is too large", "correct-input");
      for (const credentialId of credentialIds(spec)) {
        const record = cred(credentialId);
        if (!record || !groups(spec.scopeGroupId).includes(record.scope_group_id))
          throw new CommandError("validation", "Credential is not available in this scope", "correct-input");
      }
      const timestamp = now();
      raw.prepare(`INSERT INTO integrations VALUES (?,?,?,?,?,?,'untested',NULL,NULL,?,?) ON CONFLICT(id) DO UPDATE SET
        revision=excluded.revision, kind=excluded.kind, name=excluded.name, scope_group_id=excluded.scope_group_id,
        config_json=excluded.config_json, status='untested', last_check_at=NULL,last_check_json=NULL,updated_at=excluded.updated_at`)
        .run(id, (prior?.revision ?? 0) + 1, spec.kind, spec.name, spec.scopeGroupId, JSON.stringify(spec.config), timestamp, timestamp);
      putTools(id, spec.kind === "http-api" ? spec.config.operations.map((op) => ({ name: op.name,
        description: `${op.method} operation ${op.name}`, inputSchema: { ...op.inputSchema } })) : []);
    },
    remove(id: string, expected: number) { checkRevision(row(id), expected); raw.prepare("DELETE FROM integrations WHERE id=?").run(id); },
    startCheck(id: string, expected: number) {
      const record = row(id);
      checkRevision(record, expected);
      if (record?.status === "checking") throw new CommandError("conflict", "Connection check already running", "refresh");
      // A connection check is not a config change: keep the revision so the operator's next edit/delete is not a false conflict.
      // finishCheck still drops the result when the config changed meanwhile (it matches on the revision read here).
      raw.prepare("UPDATE integrations SET status='checking',updated_at=? WHERE id=?").run(now(), id);
      return get(id)!;
    },
    finishCheck(id: string, revision: number, ok: boolean, tools: ExternalDefinition[]) {
      if (!raw.open) return;
      raw.transaction(() => {
        const result = raw.prepare(`UPDATE integrations SET status=?,last_check_at=?,last_check_json=?,updated_at=?
          WHERE id=? AND revision=? AND status='checking'`).run(ok ? "ready" : "error", now(), JSON.stringify({ ok,
            message: ok ? "Kết nối thành công" : "Kiểm tra kết nối thất bại" }), now(), id, revision);
        if (result.changes && ok && row(id)?.kind !== "http-api") putTools(id, tools);
      })();
    },
    recoverChecks() {
      for (const record of rows()) if (record.status === "checking") this.finishCheck(record.id, record.revision, false, []);
    },
    createCredential(id: string, name: string, scope: string | null, value: string) {
      validateGroup(scope);
      if (cred(id)) throw new CommandError("conflict", "Credential already exists", "refresh");
      const encrypted = crypto().encrypt(id, value);
      raw.prepare("INSERT INTO credentials VALUES (?,1,?,?,?,?,?,?,?,?)").run(id, name, scope, encrypted.ciphertext, encrypted.nonce,
        encrypted.keyId, encrypted.last4, now(), now());
    },
    replaceCredential(id: string, expected: number, value: string) {
      checkRevision(cred(id), expected);
      const encrypted = crypto().encrypt(id, value);
      raw.prepare("UPDATE credentials SET revision=revision+1,ciphertext=?,nonce=?,key_id=?,last4=?,updated_at=? WHERE id=?")
        .run(encrypted.ciphertext, encrypted.nonce, encrypted.keyId, encrypted.last4, now(), id);
    },
    deleteCredential(id: string, expected: number) {
      checkRevision(cred(id), expected);
      if (rows().some((record) => credentialIds(view(record)).includes(id)))
        throw new CommandError("conflict", "Credential is in use", "correct-input");
      raw.prepare("DELETE FROM credentials WHERE id=?").run(id);
    },
  };
}
export type IntegrationStore = ReturnType<typeof createIntegrationStore>;
