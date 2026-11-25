import { artifactTraceResponseSchema, monitorResponseSchema, traceResponseSchema, tracesResponseSchema } from '@factory/contracts';

export const traceModels = {
  monitor: monitorResponseSchema,
  list: tracesResponseSchema,
  detail: traceResponseSchema,
  artifact: artifactTraceResponseSchema,
};

export type MonitorSnapshot = ReturnType<typeof monitorResponseSchema.parse>;
