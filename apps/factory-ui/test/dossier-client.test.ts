import { it, expect, vi } from 'vitest';
import { createApiClient } from '../src/api/client';
import { dossier } from './m3-fixtures';
import { id, envelope, response } from './fixtures';
const client = (value: unknown) => createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response(value)) });
it('accepts documented dossier and additive fields', async () => { expect(await client({ ...envelope, dossier: { ...dossier, extra: true }, extra: true }).getDossier(id)).toBeTruthy(); });
it.each(Object.keys(dossier))('rejects malformed dossier field %s', async key => { await expect(client({ ...envelope, dossier: { ...dossier, [key]: {} } }).getDossier(id)).rejects.toMatchObject({ kind: 'bad-response' }); });
