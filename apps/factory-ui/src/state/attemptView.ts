import type { AttemptEvent } from '../api/client';

export const cleanText = (value: unknown): string => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, 300) : '';
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export type EventSummary = { kind: AttemptEvent['kind']; text: string; percent?: number };
export function summariseEvent(event: Pick<AttemptEvent, 'kind' | 'body'>): EventSummary {
  const body = object(event.body);
  let text = '';
  if (event.kind === 'progress') text = cleanText(body.message);
  else if (event.kind === 'state') text = cleanText(body.summary) || cleanText(body.message) || cleanText(body.reason) || cleanText(body.to);
  else if (event.kind === 'evidence') text = cleanText(body.detail) || cleanText(body.name);
  else text = cleanText(body.message) || cleanText(event.body);
  const percent = body.percent;
  return { kind: event.kind, text, ...(event.kind === 'progress' && typeof percent === 'number' && Number.isFinite(percent) && percent >= 0 && percent <= 100 ? { percent } : {}) };
}
export function evidenceView(body: unknown): { files: { path: string; status: string }[]; totals: { files: number; additions: number; deletions: number } | null } {
  const value = object(body);
  const files = Array.isArray(value.files) ? value.files.slice(0, 5000).flatMap(item => {
    const f = object(item);
    return typeof f.path === 'string' && typeof f.status === 'string' ? [{ path: cleanText(f.path), status: cleanText(f.status) }] : [];
  }) : [];
  const totals = object(value.totals);
  const valid = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  return { files, totals: valid(totals.files) && valid(totals.additions) && valid(totals.deletions) ? { files: totals.files, additions: totals.additions, deletions: totals.deletions } : null };
}
