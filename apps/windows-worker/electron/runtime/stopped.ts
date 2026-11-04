export class ExecutionStopped extends Error {
  constructor(readonly state: "cancelled" | "failed") {
    super("Đã yêu cầu dừng.");
  }
}
