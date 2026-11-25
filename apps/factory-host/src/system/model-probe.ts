import { validModelName, validModelUrl } from "../config/schema.js";

export class ModelProbeError extends Error {
  constructor(readonly status?: number) { super("Không kiểm tra được model provider."); }
}

async function modelJson(base: string, key: string | undefined, path: string, fetchImpl: typeof fetch, body?: object): Promise<unknown> {
  if (!validModelUrl(base)) throw new ModelProbeError();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImpl(`${new URL(base).href.replace(/\/+$/, "")}${path}`, {
      redirect: "manual", signal: controller.signal, method: body === undefined ? "GET" : "POST",
      headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status !== 200 || !response.body) throw new ModelProbeError(response.status);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 1_048_576) throw new ModelProbeError();
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks, size).toString("utf8")) as unknown;
  } finally { clearTimeout(timer); controller.abort(); }
}

export async function probeModels(base: string, key: string | undefined, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const body = await modelJson(base, key, "/models", fetchImpl);
  if (!body || typeof body !== "object" || !("data" in body) || !Array.isArray(body.data)) throw new ModelProbeError();
  return [...new Set(body.data.flatMap((item: { id?: unknown } | null) => typeof item?.id === "string" && validModelName(item.id)
    && !/[\p{Cf}]/u.test(item.id) && (!key || !item.id.includes(key)) ? [item.id] : []))];
}

export async function probeCompletion(base: string, key: string | undefined, model: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const body = await modelJson(base, key, "/chat/completions", fetchImpl, { model, messages: [{ role: "user", content: "Hi" }], max_tokens: 1 });
  if (!body || typeof body !== "object" || !("choices" in body) || !Array.isArray(body.choices) || !body.choices.length
    || !body.choices[0]?.message || typeof body.choices[0].message !== "object") throw new ModelProbeError();
}
