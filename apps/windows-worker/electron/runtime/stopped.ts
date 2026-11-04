import type { ExecutionFailure } from "../../shared/execution";
import { failure } from "./failure";
export class ExecutionStopped extends Error {
  readonly failure: ExecutionFailure;
  constructor(
    readonly state: "cancelled" | "failed",
    reason?: ExecutionFailure,
  ) {
    super(reason?.message ?? "Đã yêu cầu dừng.");
    this.failure =
      reason ??
      failure(state === "cancelled" ? "cancelled" : "runtime", this.message);
  }
}
