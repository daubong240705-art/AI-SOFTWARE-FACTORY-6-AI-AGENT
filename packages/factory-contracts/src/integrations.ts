import { z } from "zod";
import { idSchema, labelSchema, revisionSchema, timestampSchema } from "./base.js";
import { jsonSubsetSchema } from "./flow.js";

export const integrationNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,29}$/);
export const integrationToolNameSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const line = z.string().max(8192).regex(/^[^\x00-\x1f\x7f]*$/);
const url = line.refine((value) => {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password && !parsed.hash && !parsed.search;
  } catch { return false; }
}, "Expected an HTTP URL without user info, query, or fragment");
const envName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/);
const headerName = z.string().max(128).regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/).refine((name) =>
  !/^(?:proxy-|sec-|x-forwarded-)/i.test(name) && !/^(host|connection|content-length|transfer-encoding|cookie|set-cookie|upgrade|expect|origin|referer|forwarded|mcp-session-id|mcp-protocol-version|content-type|accept)$/i.test(name));
export const sensitiveIntegrationName = (name: string): boolean => /key|token|password|passwd|secret|credential|auth|cookie/i.test(name);
export const integrationValueSchema = z.union([z.strictObject({ credential: idSchema }), z.strictObject({ value: line })]);
const values = (key: z.ZodString) => z.record(key, integrationValueSchema).refine((entries) => Object.keys(entries).length <= 32
  && Object.entries(entries).every(([name, value]) => !sensitiveIntegrationName(name) || "credential" in value), "Use a credential reference for sensitive values");
export const httpOperationSchema = z.strictObject({
  name: integrationToolNameSchema, method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]),
  path: line.regex(/^\/(?!\/)(?:[^{}\\?#]|\{[A-Za-z_][A-Za-z0-9_]*\})*$/), inputSchema: jsonSubsetSchema,
  sideEffect: z.enum(["none", "external"]),
});
const configs = {
  stdio: z.strictObject({ command: line.min(1), args: z.array(line).max(64).default([]), env: values(envName).default({}) }),
  mcpHttp: z.strictObject({ url, headers: values(headerName).default({}).refine((headers) =>
    new Set(Object.keys(headers).map((name) => name.toLowerCase())).size === Object.keys(headers).length) }),
  httpApi: z.strictObject({ baseUrl: url, auth: z.union([z.literal("none"), z.strictObject({ bearer: idSchema }),
    z.strictObject({ header: headerName, credential: idSchema })]), operations: z.array(httpOperationSchema).min(1).max(64)
    .refine((operations) => new Set(operations.map(({ name }) => name)).size === operations.length) }),
};
const variants = <Shape extends z.ZodRawShape>(shape: Shape) => z.discriminatedUnion("kind", [
  z.strictObject({ ...shape, kind: z.literal("mcp-stdio"), config: configs.stdio }),
  z.strictObject({ ...shape, kind: z.literal("mcp-http"), config: configs.mcpHttp }),
  z.strictObject({ ...shape, kind: z.literal("http-api"), config: configs.httpApi }),
]);
const scope = { name: integrationNameSchema, scopeGroupId: idSchema.nullable().default(null) };
const change = { id: idSchema, expectedRevision: revisionSchema };
export const integrationSpecSchema = variants(scope);
export const integrationsCreatePayloadSchema = variants({ ...scope, id: idSchema });
export const integrationsUpdatePayloadSchema = variants({ ...scope, ...change });
export const integrationsDeletePayloadSchema = z.strictObject(change);
export const integrationsTestPayloadSchema = z.strictObject(change);
export const integrationCheckSchema = z.strictObject({ ok: z.boolean(), message: z.string() });
export const integrationToolSchema = z.strictObject({ name: integrationToolNameSchema, description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()), discoveredAt: timestampSchema });
export const integrationSchema = variants({ ...scope, id: idSchema, revision: revisionSchema,
  status: z.enum(["untested", "checking", "ready", "error"]), lastCheckAt: timestampSchema.nullable(),
  lastCheck: integrationCheckSchema.nullable(), createdAt: timestampSchema, updatedAt: timestampSchema, tools: z.array(integrationToolSchema) });
export const credentialsCreatePayloadSchema = z.strictObject({ id: idSchema, name: labelSchema, scopeGroupId: idSchema.nullable().default(null),
  value: z.string().min(1).max(8192) });
export const credentialsReplacePayloadSchema = z.strictObject({ ...change, value: credentialsCreatePayloadSchema.shape.value });
export const credentialsDeletePayloadSchema = z.strictObject(change);
export const credentialSchema = z.strictObject({ id: idSchema, name: labelSchema, scopeGroupId: idSchema.nullable(), revision: revisionSchema,
  last4: z.string().max(8), createdAt: timestampSchema, updatedAt: timestampSchema });
export type IntegrationSpec = z.infer<typeof integrationSpecSchema>;
export type Integration = z.infer<typeof integrationSchema>;
export type Credential = z.infer<typeof credentialSchema>;
export type HttpOperation = z.infer<typeof httpOperationSchema>;
