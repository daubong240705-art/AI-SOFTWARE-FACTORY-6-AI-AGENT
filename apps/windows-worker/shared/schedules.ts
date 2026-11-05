import { z } from "zod";
import type { createBoardItemSchema } from "./board";

// UX-08 starts with a passive backlog action. No shell, runtime/model overrides,
// event triggers or automatic execution can be supplied through this contract.
export const scheduleInstantSchema = z.iso
  .datetime({ precision: 3 })
  .refine((value) => {
    const date = new Date(value);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString() === value &&
      date.getUTCFullYear() >= 2000 &&
      date.getUTCFullYear() <= 2100
    );
  }, "Thời điểm phải là UTC hợp lệ từ năm 2000 đến 2100.");
const instant = scheduleInstantSchema;
const zone = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
      return true;
    } catch {
      return false;
    }
  }, "Múi giờ không hợp lệ.");
export const scheduleTimingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("once"), at: instant }).strict(),
  z
    .object({
      kind: z.literal("daily"),
      time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
      timeZone: zone,
      // ISO weekdays: Monday=1, Sunday=7.
      weekdays: z
        .array(z.number().int().min(1).max(7))
        .min(1)
        .max(7)
        .refine((days) => new Set(days).size === days.length),
    })
    .strict(),
]);
export const scheduleActionSchema = z
  .object({
    kind: z.literal("create_work_item"),
    title: z.string().trim().min(1).max(160),
    body: z.string().trim().max(12000),
    criteria: z.array(z.string().trim().min(1).max(500)).max(30),
  })
  .strict();
export const scheduleDraftSchema = z
  .object({
    projectId: z.string().uuid(),
    name: z.string().trim().min(1).max(100),
    timing: scheduleTimingSchema,
    action: scheduleActionSchema,
    missedPolicy: z.literal("skip"),
  })
  .strict();
export type ScheduleTiming = z.infer<typeof scheduleTimingSchema>;
export type ScheduleDraft = z.infer<typeof scheduleDraftSchema>;
export const scheduleRecordSchema = scheduleDraftSchema
  .extend({
    id: z.string().uuid(),
    enabled: z.boolean(),
    version: z.number().int().positive(),
    nextAt: instant.nullable(),
    createdAt: instant,
    updatedAt: instant,
  })
  .strict();
export type ScheduleRecord = z.infer<typeof scheduleRecordSchema>;
export const scheduleDeliverySchema = z
  .object({
    occurrenceKey: z.string().min(40).max(300),
    scheduleId: z.string().uuid(),
    scheduleVersion: z.number().int().positive(),
    dueAt: instant,
    observedAt: instant,
    state: z.enum(["created", "missed", "failed"]),
    workItemId: z.string().uuid().nullable(),
    reason: z.string().max(1000),
    config: scheduleDraftSchema,
  })
  .strict();
export type ScheduleDelivery = z.infer<typeof scheduleDeliverySchema>;
export const scheduleGraceMs = 5 * 60 * 1000;

function parts(format: Intl.DateTimeFormat, date: number): number[] {
  const p = Object.fromEntries(
    format.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return [p.year, p.month, p.day, p.hour, p.minute].map(Number);
}
function wallStamp(p: number[]): number {
  return Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4]);
}

// Resolve a local minute using the offsets around that date. A missing DST
// minute is skipped; a repeated minute uses its FIRST occurrence only.
function localInstant(
  format: Intl.DateTimeFormat,
  wall: number,
): number | null {
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const probe = wall + hours * 3600000;
    offsets.add(wallStamp(parts(format, probe)) - probe);
  }
  const candidates = [...offsets]
    .map((offset) => wall - offset)
    .filter((candidate) => wallStamp(parts(format, candidate)) === wall);
  return candidates.length ? Math.min(...candidates) : null;
}

/** Strictly after `after`, bounded to sixteen local dates; no cron dependency. */
export function nextScheduleOccurrence(
  input: ScheduleTiming,
  after: string,
): string | null {
  const timing = scheduleTimingSchema.parse(input);
  const start = new Date(instant.parse(after)).getTime();
  return nextOccurrence(timing, start);
}
function nextOccurrence(timing: ScheduleTiming, start: number): string | null {
  if (timing.kind === "once")
    return new Date(timing.at).getTime() > start ? timing.at : null;
  const format = new Intl.DateTimeFormat("en-GB", {
    timeZone: timing.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const [year, month, day] = parts(format, start);
  const [hour, minute] = timing.time.split(":").map(Number);
  for (let offset = 0; offset < 16; offset++) {
    const wall = Date.UTC(year, month - 1, day + offset, hour, minute);
    if (new Date(wall).getUTCFullYear() > 2100) return null;
    const weekday = new Date(wall).getUTCDay() || 7;
    if (!timing.weekdays.includes(weekday)) continue;
    const candidate = localInstant(format, wall);
    if (
      candidate !== null &&
      candidate > start &&
      new Date(candidate).getUTCFullYear() <= 2100
    )
      return new Date(candidate).toISOString();
  }
  return null;
}

export function previewSchedule(
  input: ScheduleDraft,
  after: string,
): {
  occurrences: string[];
  workItem: z.infer<typeof createBoardItemSchema>;
} {
  const draft = scheduleDraftSchema.parse(input);
  instant.parse(after);
  const occurrences: string[] = [];
  let cursor = after;
  for (let i = 0; i < 5; i++) {
    const next = nextScheduleOccurrence(draft.timing, cursor);
    if (!next) break;
    occurrences.push(next);
    cursor = next;
  }
  return {
    occurrences,
    workItem: {
      projectId: draft.projectId,
      title: draft.action.title,
      body: draft.action.body,
      criteria: draft.action.criteria,
      suggestedRole: null,
      priority: 0,
      planningState: "backlog",
    },
  };
}

/** A deterministic plan only; the caller must persist receipt + action atomically. */
export function planScheduleTick(input: {
  id: string;
  version: number;
  timing: ScheduleTiming;
  nextAt: string;
  now: string;
}): {
  key: string;
  state: "waiting" | "due" | "missed";
  nextAt: string | null;
} {
  const id = z.string().uuid().parse(input.id);
  const version = z.number().int().positive().max(1000000).parse(input.version);
  const nextAt = instant.parse(input.nextAt),
    now = instant.parse(input.now);
  const timing = scheduleTimingSchema.parse(input.timing);
  if (nextOccurrence(timing, new Date(nextAt).getTime() - 1) !== nextAt)
    throw Error("Thời điểm không thuộc lịch hiện tại.");
  const age = new Date(now).getTime() - new Date(nextAt).getTime();
  return {
    key: `${id}:${version}:${nextAt}`,
    state: age < 0 ? "waiting" : age <= scheduleGraceMs ? "due" : "missed",
    // One receipt represents the oldest due occurrence. Advance past NOW,
    // never replay every intervening occurrence after downtime.
    nextAt: age < 0 ? nextAt : nextScheduleOccurrence(input.timing, now),
  };
}
