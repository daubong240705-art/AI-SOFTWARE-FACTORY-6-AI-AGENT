import { it, expect, vi } from 'vitest';
import { createApiClient } from '../src/api/client';
import { context } from './m3-fixtures';
import { id, envelope, response } from './fixtures';
const client = (value: unknown) => createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response(value)) });
it('accepts documented context and additive fields', async () => { expect(await client({ ...envelope, packs: [{ ...context, extra: true }], extra: true }).getTaskContext(id,id)).toBeTruthy(); });
it.each(Object.keys(context))('rejects malformed context field %s', async key => { await expect(client({ ...envelope, packs: [{ ...context, [key]: {} }] }).getTaskContext(id,id)).rejects.toMatchObject({ kind: 'bad-response' }); });
it.each(['packDigest','profilePath','skillsCount','bytes'])('rejects malformed instruction %s', async key => { await expect(client({ ...envelope, packs: [{ ...context,instructions:{ ...context.instructions,[key]:{} } }] }).getTaskContext(id,id)).rejects.toMatchObject({kind:'bad-response'}); });
it('rejects invalid omitted reason', async () => { await expect(client({ ...envelope,packs:[{ ...context, pack:{ omitted:[{ ref:{artifactId:id,version:1},reason:'unknown' }] } }] }).getTaskContext(id,id)).rejects.toMatchObject({kind:'bad-response'}); });
