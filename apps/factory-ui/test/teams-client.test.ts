import { it, expect, vi } from 'vitest';
import { createApiClient } from '../src/api/client';
import { orgTeam } from './m3-fixtures';
import { envelope, response } from './fixtures';
const client = (value: unknown) => createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response(value)) });
it('accepts documented teams and additive fields', async () => { expect(await client({ ...envelope, teams: [{ ...orgTeam, extra: true }], extra: true }).listTeams()).toBeTruthy(); });
it.each(Object.keys(orgTeam))('rejects malformed teams field %s', async key => { await expect(client({ ...envelope, teams: [{ ...orgTeam, [key]: {} }] }).listTeams()).rejects.toMatchObject({ kind: 'bad-response' }); });
it.each(['revision','slots','name','capabilities','tools','live'])('rejects malformed seat %s', async key => { await expect(client({ teams: [{ ...orgTeam, seats: [{ ...orgTeam.seats[0], [key]: {} }] }] }).listTeams()).rejects.toMatchObject({ kind:'bad-response' }); });
it.each(['revision','priority','maxConcurrent','state','live'])('rejects malformed engagement %s', async key => { await expect(client({ teams: [{ ...orgTeam, engagements: [{ ...orgTeam.engagements[0], [key]: {} }] }] }).listTeams()).rejects.toMatchObject({ kind:'bad-response' }); });
