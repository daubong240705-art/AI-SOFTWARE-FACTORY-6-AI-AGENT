import type { Usage } from "@factory/contracts";
import { ModelError, type ModelErrorKind, type ModelGateway, type ModelRequest } from "./gateway.js";

export type FakeStep = { text: string; usage?: Usage | null; delayMs?: number }
  | { error: ModelErrorKind; delayMs?: number };

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new ModelError("cancelled"));
  return new Promise((resolve, reject) => {
    const onAbort = (): void => { clearTimeout(timer); reject(new ModelError("cancelled")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function createFakeGateway(script: FakeStep[]): ModelGateway & { readonly calls: ModelRequest[] } {
  const steps = structuredClone(script);
  const calls: ModelRequest[] = [];
  let next = 0;
  return {
    providerId: "fake", calls,
    async complete(request) {
      // AbortSignal is not structured-cloneable; snapshot its state without retaining the caller's reason.
      const { signal, ...input } = request;
      const recordedSignal = signal?.aborted ? AbortSignal.abort() : new AbortController().signal;
      calls.push({ ...structuredClone(input), ...(signal === undefined ? {} : { signal: recordedSignal }) });
      const step = steps[next++];
      if (!step) throw new ModelError("config");
      await delay(step.delayMs ?? 0, signal);
      if ("error" in step) throw new ModelError(step.error);
      return { text: step.text, usage: structuredClone(step.usage ?? null),
        provider: "fake", model: input.model, finishReason: "stop" };
    },
  };
}
