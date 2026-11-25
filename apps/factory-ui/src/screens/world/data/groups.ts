import { groupsResponseSchema, successResponseSchema } from '@factory/contracts';

const schema = successResponseSchema.pick({ ok: true, apiVersion: true }).extend(groupsResponseSchema.shape);
export async function listGroups(signal: AbortSignal) {
  const response = await fetch(`${import.meta.env.DEV ? '/api' : ''}/groups`, { signal, credentials: 'same-origin', cache: 'no-store' });
  if (response.status === 404) return { groups: [], membership: {} };
  if (!response.ok) throw new Error('Groups unavailable');
  return schema.parse(await response.json());
}
