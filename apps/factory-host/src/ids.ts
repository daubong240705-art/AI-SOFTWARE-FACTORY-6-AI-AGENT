import { randomBytes } from "node:crypto";

export type Clock = () => Date;
export const systemClock: Clock = () => new Date();

/** Monotonic UUIDv7 IDs, including when the wall clock stops or moves backwards. */
export function createIdGenerator(clock: Clock = systemClock): () => string {
  let lastMs = -1;
  let counter = 0;
  return () => {
    const now = clock().getTime();
    if (!Number.isSafeInteger(now) || now < 0 || now > 0xffffffffffff)
      throw new Error("UUIDv7 clock must be a valid 48-bit Unix timestamp");
    if (now > lastMs) {
      lastMs = now;
      counter = 0;
    } else if (++counter > 0xfff) {
      lastMs += 1;
      counter = 0;
    }
    if (lastMs > 0xffffffffffff) throw new Error("UUIDv7 timestamp exhausted");
    const bytes = randomBytes(16);
    bytes.writeUIntBE(lastMs, 0, 6);
    bytes.writeUInt16BE(0x7000 | counter, 6);
    bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}
