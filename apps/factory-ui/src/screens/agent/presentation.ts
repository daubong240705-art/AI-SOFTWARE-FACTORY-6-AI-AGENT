import type { OfficeSeat } from '@/api/officeModels';
import type { MascotState } from '@/components/mascot';
import { i18n } from '@/i18n';
import type { Store } from '@/state/store';

export type OfficeNeed = OfficeSeat['needsYou'][number];
export type OpenOfficeTask = (taskId: string) => void;
export type ProjectAttempt = Awaited<ReturnType<Store['listProjectAttempts']>>['attempts'][number];
export const mascotFor: Record<OfficeSeat['status'], MascotState> = {
  working: 'working', waiting: 'attention', problem: 'error', done: 'success', queued: 'thinking', idle: 'idle',
};

const rank: Record<OfficeSeat['status'], number> = { working: 0, waiting: 1, problem: 2, queued: 3, done: 4, idle: 5 };
export function orderSeats(seats: OfficeSeat[]) {
  return [...seats].sort((a, b) => Number(b.isLead) - Number(a.isLead) || rank[a.status] - rank[b.status]);
}

export function tokensFor(attempt: Pick<ProjectAttempt, 'usage'> | undefined) {
  const usage = attempt?.usage;
  if (!usage) return '';
  if (usage.inputTokens === null || usage.outputTokens === null) return i18n.t('agentUi.tokensUnknown');
  const total = usage.inputTokens + usage.outputTokens;
  const count = total >= 1000 ? `${new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 1 }).format(total / 1000)}k`
    : new Intl.NumberFormat(i18n.locale).format(total);
  return i18n.t('agentUi.tokensTotal').replace('{count}', count);
}

export function durationSince(start: string | null, end: string | null, now: number) {
  if (!start) return i18n.t('agentUi.unknown');
  const seconds = Math.max(0, Math.floor(((end ? Date.parse(end) : now) - Date.parse(start)) / 1000));
  const hours = Math.floor(seconds / 3600);
  return `${hours ? `${hours}:` : ''}${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function newestFirst(a: ProjectAttempt, b: ProjectAttempt) {
  return (b.startedAt || b.endedAt ? Date.parse(b.startedAt ?? b.endedAt!) : 0)
    - (a.startedAt || a.endedAt ? Date.parse(a.startedAt ?? a.endedAt!) : 0) || b.epoch - a.epoch;
}
