import { idSchema, successResponseSchema, textSchema } from '@factory/contracts';

const object = successResponseSchema.pick({ ok: true }).omit({ ok: true });
const text = textSchema.min(0);
const date = text.refine(value => Number.isFinite(Date.parse(value)));
const states = ['pending', 'done', 'failed', 'unknown'] as const;
const effect = object.extend({
  id: idSchema, attemptId: idSchema, kind: text,
  remote: text, branch: text,
  state: text.transform(value => value === 'outcome-unknown' ? 'unknown' : states.find(state => state === value) ?? 'unrecognized'),
  outcome: text.nullable().optional().transform(value => value ?? null),
  error: text.nullable().optional().transform(value => value ?? null),
  createdAt: date, completedAt: date.nullable().optional().transform(value => value ?? null),
}).strip();

// Both plain Host objects and responses with an envelope are accepted. Extra fields
// and future state/error values must not hide otherwise useful code activity.
export const codeReadModels = {
  effects: object.extend({ effects: effect.array() }).strip(),
  remotes: object.extend({ remotes: text.array() }).strip(),
};
export type CodeEffect = ReturnType<typeof effect.parse>;
