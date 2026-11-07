import type { ApiError } from "@factory/contracts";

export class CommandError extends Error {
  constructor(
    readonly code: ApiError["code"],
    message: string,
    readonly nextAction: ApiError["nextAction"],
    readonly extra?: { currentRevision?: number },
  ) {
    super(message);
    this.name = "CommandError";
  }
}
