/** Shared by all execution proxies in one run. Reservations are never refunded. */
export class RequestBudget {
  private used = 0;
  constructor(readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new Error("Invalid request budget");
  }
  get requests(): number {
    return this.used;
  }
  reserve(): boolean {
    // No await between checking and reserving: concurrent HTTP handlers share this ledger.
    if (this.used >= this.limit) return false;
    this.used++;
    return true;
  }
}
