import { idSchema, successResponseSchema, textSchema } from '@factory/contracts';
import { activitySeatModel } from './activityModels';

// The project office: seats of the engaged teams and the structured exchanges between them (GET /projects/:id/interactions).
const ok = successResponseSchema.pick({ ok: true, apiVersion: true });
const object = ok.omit({ ok: true, apiVersion: true });
const text = textSchema.min(0);
const date = text.refine(value => /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)));
export const interactionKinds = ['message', 'assign', 'rework', 'request', 'handoff', 'progress', 'question', 'review', 'start-gate', 'answer', 'output', 'finished', 'failed'] as const;
export type InteractionKind = typeof interactionKinds[number] | 'unknown';
const party = object.extend({ kind: text, seatId: idSchema.optional().catch(undefined), name: text.optional().catch(undefined) }).strip()
  .nullable().catch(null)
  .transform(value => value === null ? null : value.kind === 'seat' && value.seatId ? { kind: 'seat' as const, seatId: value.seatId, name: value.name ?? '' }
    : value.kind === 'operator' ? { kind: 'operator' as const } : value.kind === 'knowledge' ? { kind: 'knowledge' as const } : null);
export type Party = NonNullable<ReturnType<typeof party.parse>>;
const item = object.extend({
  id: text.min(1), at: date,
  kind: text.transform((value): InteractionKind => interactionKinds.find(kind => kind === value) ?? 'unknown').catch('unknown' as const),
  from: party, to: party.optional().transform(value => value ?? null),
  taskId: idSchema.nullable().catch(null), code: text.nullable().catch(null), text: text.catch(''),
}).strip();
// chat: the Lead is answering the operator (a chat turn, not a task attempt).
const seat = activitySeatModel.and(object.extend({ teamId: idSchema, teamName: text,
  chat: object.extend({ since: date }).strip().nullable().optional().catch(null).transform(value => value ?? null) }).strip());
export const officeReadModel = ok.extend({
  generatedAt: date,
  seats: seat.nullable().catch(null).array().catch([]).transform(items => items.filter(value => value !== null)),
  // An item without a known sender is dropped; the rest always have one.
  items: item.nullable().catch(null).array().catch([]).transform(items => items.flatMap(value => value?.from ? [{ ...value, from: value.from }] : [])),
}).strip();
export type Office = ReturnType<typeof officeReadModel.parse>;
export type OfficeSeat = Office['seats'][number];
export type Interaction = Office['items'][number];

/** Runtime/tool lifecycle lines are transport diagnostics, not a progress report for the operator. */
export function meaningfulOfficeItems(items: Interaction[]): Interaction[] {
  return items.filter(item => item.kind !== 'progress'
    || (item.text.trim() !== '' && !/^(?:tool(?: failed)?:|working$|starting$)/i.test(item.text.trim())));
}
