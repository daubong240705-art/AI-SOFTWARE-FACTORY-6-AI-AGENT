import type { ActivitySeat } from '@/api/activityModels';
import type { OrgTeam } from '@/api/m3Models';
import type { PodKey } from './types';
export function classifyPod(seat: Pick<ActivitySeat, 'id' | 'name' | 'isLead'>, org?: OrgTeam): PodKey {
  if (org?.packKey === 'portal-ops')
    return 'portal';
  if (seat.isLead)
    return 'lead';
  const caps = org?.seats.find(s => s.id === seat.id)?.capabilities;
  if (!caps)
    return classifyName(seat.name);
  const has = (prefix: string) => caps.some(c => c === prefix || c.startsWith(`${prefix}.`));
  if (has('test') || caps.includes('review.game'))
    return 'qa';
  if (has('game.design'))
    return 'design';
  if (has('game.rules'))
    return 'rules';
  if (has('game.ui') || has('design.asset'))
    return 'art';
  if (has('game.client') || has('game.integrate'))
    return 'client';
  return 'annex';
}
function classifyName(name: string): PodKey {
  const n = name.toLowerCase();
  if (/portal/.test(n))
    return 'portal';
  if (/qa|test|review/.test(n))
    return 'qa';
  if (/design/.test(n))
    return 'design';
  if (/rule/.test(n))
    return 'rules';
  if (/art|ui/.test(n))
    return 'art';
  if (/client|integrat/.test(n))
    return 'client';
  return 'annex';
}
