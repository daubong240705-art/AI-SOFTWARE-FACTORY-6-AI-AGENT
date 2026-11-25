import { credentialSchema, idSchema, integrationSchema, successResponseSchema, textSchema } from '@factory/contracts';

const ok = successResponseSchema.pick({ ok: true, apiVersion: true });
const effect = ok.omit({ ok: true, apiVersion: true }).extend({
  id: idSchema,
  state: textSchema.transform(value => value as 'pending' | 'done' | 'failed' | 'unknown')
    .refine(value => ['pending', 'done', 'failed', 'unknown'].includes(value)),
  error: textSchema.min(0).nullable(),
});

export const integrationModels = {
  list: ok.extend({ integrations: integrationSchema.array() }),
  detail: ok.extend({ integration: integrationSchema }),
  credentials: ok.extend({ credentials: credentialSchema.array() }),
  effects: ok.extend({ effects: effect.array() }),
  reconciled: ok,
};
export type HttpEffect = ReturnType<typeof effect.parse>;
