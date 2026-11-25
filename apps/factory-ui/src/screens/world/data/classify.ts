import type { ActivitySeat } from '@/api/activityModels';
import type { PodKey } from './types';

export function classifyPod(seat: Pick<ActivitySeat, 'name' | 'role' | 'isLead'>): PodKey {
  if (seat.isLead) return 'lead';
  const label = `${seat.name} ${seat.role}`.toLowerCase();
  if (/qa|test|review/.test(label)) return 'qa';
  if (/art|\bui\b|visual/.test(label)) return 'art';
  if (/design|research/.test(label)) return 'design';
  if (/rule|policy/.test(label)) return 'rules';
  if (/client|engineer|developer|integrat/.test(label)) return 'client';
  return 'annex';
}
