import type { Database } from "better-sqlite3";
import { TraceEventHub, TraceRecorder } from "../trace/recorder.js";

type ActionScope = { projectId: string; messageId: string; commandId?: string; runId?: string; briefRef?: string };

export class LeadTraceRecorder extends TraceRecorder {
  action: ActionScope | undefined;

  override begin(...args: Parameters<TraceRecorder["begin"]>): ReturnType<TraceRecorder["begin"]> {
    return this.action?.commandId === args[1] ? undefined : super.begin(...args);
  }
}

export class LeadEventHub extends TraceEventHub {
  constructor(raw: Database, private readonly leadTrace: LeadTraceRecorder, options: ConstructorParameters<typeof TraceEventHub>[2]) {
    super(raw, leadTrace, options);
  }

  leadAction<Value>(scope: ActionScope, invoke: () => Value): Value {
    const previous = this.leadTrace.action;
    this.leadTrace.action = scope;
    try { return invoke(); } finally { this.leadTrace.action = previous; }
  }

  override append(input: Parameters<TraceEventHub["append"]>[0]) {
    const scope = this.leadTrace.action;
    if (scope?.projectId === input.projectId) {
      const entity = input.payload.type === "entity.changed" ? input.payload.entity : undefined;
      const runId = scope.runId;
      const isRun = entity?.kind === "flow-run" && runId === entity.id;
      if (isRun && runId && scope.briefRef) this.leadTrace.entity(input.projectId, { kind: "flow-run", ref: runId }, undefined,
        { kind: "artifact", ref: scope.briefRef });
      if (isRun || (scope.commandId !== undefined && input.causationId === scope.commandId)
        || (scope.commandId === undefined && entity?.kind === "artifact-version"))
        input = { ...input, causationId: scope.messageId, rootCausationId: scope.messageId };
    }
    return super.append(input);
  }
}
