import type { AttemptEvent } from '../api/client';

export const cleanText = (value: unknown): string => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '').slice(0, 20_000) : '';
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const token = (v: unknown): v is number | null => v === null || count(v);
export type TokenUsage = { inputTokens: number | null; cachedInputTokens: number | null; outputTokens: number | null; reasoningOutputTokens: number | null };
export type AgentDetails = { cli?: string; model?: string | null; effort?: string | null; permission?: string };
export type EventDescription =
  | { kind: 'milestone'; state: string; agent?: AgentDetails; branch?: string; baseSha?: string; summary?: string; failureKind?: string; message?: string; reason?: string }
  | { kind: 'progress'; text: string; percent?: number }
  | { kind: 'message'; text: string }
  | { kind: 'criterion'; criterion: string; passed: boolean; evidence: string }
  | { kind: 'tool'; detail: string }
  | { kind: 'diff'; totals: { files: number; additions: number; deletions: number } }
  | { kind: 'question'; text: string }
  | ({ kind: 'usage' } & TokenUsage)
  | { kind: 'other'; text: string };

export function describeEvent(event: Pick<AttemptEvent, 'kind' | 'body'>): EventDescription {
  const body = object(event.body);
  const other = (): EventDescription => ({ kind: 'other', text: cleanText(body.text) || cleanText(body.message) || cleanText(body.detail) || cleanText(body.summary) || cleanText(body.reason) || cleanText(body.to) || cleanText(body.name) || cleanText(event.body) });
  if (event.kind === 'output') return { kind: typeof body.text === 'string' ? 'message' : 'other', text: cleanText(body.text) };
  if (event.kind === 'progress') {
    if (typeof body.message !== 'string' || (body.percent !== undefined && (typeof body.percent !== 'number' || !Number.isFinite(body.percent) || body.percent < 0 || body.percent > 100))) return other();
    return { kind: 'progress', text: cleanText(body.message), ...(body.percent === undefined ? {} : { percent: body.percent as number }) };
  }
  if (event.kind === 'state') {
    if (typeof body.to !== 'string') return other();
    const result: Extract<EventDescription, { kind: 'milestone' }> = { kind: 'milestone', state: cleanText(body.to) };
    for (const key of ['branch', 'baseSha', 'summary', 'message', 'reason'] as const) {
      if (body[key] !== undefined) { if (typeof body[key] !== 'string') return other(); result[key] = cleanText(body[key]); }
    }
    if (body.kind !== undefined) { if (typeof body.kind !== 'string') return other(); result.failureKind = cleanText(body.kind); }
    if (body.to === 'runtime-configured') {
      if (!body.agent || typeof body.agent !== 'object' || Array.isArray(body.agent)) return other();
      const agent = object(body.agent); const details: AgentDetails = {};
      for (const key of ['cli', 'model', 'effort', 'permission'] as const) {
        const value = agent[key];
        if (value === undefined) continue;
        if (value === null && (key === 'model' || key === 'effort')) { details[key] = null; continue; }
        if (typeof value !== 'string') return other();
        if (key === 'effort' && !['low', 'medium', 'high', 'xhigh'].includes(value)) return other();
        details[key] = cleanText(value);
      }
      result.agent = details;
    }
    if (body.to === 'workspace-ready' && (typeof body.branch !== 'string' || typeof body.baseSha !== 'string')) return other();
    if (body.to === 'submitting' && typeof body.summary !== 'string') return other();
    return result;
  }
  if (event.kind === 'evidence') {
    if (body.name === 'criterion') return typeof body.criterion === 'string' && typeof body.passed === 'boolean' && typeof body.evidence === 'string'
      ? { kind: 'criterion', criterion: cleanText(body.criterion), passed: body.passed, evidence: cleanText(body.evidence) } : other();
    if (body.name === 'external-tool') return typeof body.detail === 'string' ? { kind: 'tool', detail: cleanText(body.detail) } : other();
    const diff = evidenceView(body);
    if (diff.totals) return { kind: 'diff', totals: diff.totals };
  }
  if (event.kind === 'question') {
    const text = body.text ?? body.message ?? body.question;
    return typeof text === 'string' ? { kind: 'question', text: cleanText(text) } : other();
  }
  if (event.kind === 'usage') {
    const usage = object(body.usage);
    if (token(usage.inputTokens) && token(usage.cachedInputTokens) && token(usage.outputTokens) && token(usage.reasoningOutputTokens))
      return { kind: 'usage', inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens, outputTokens: usage.outputTokens, reasoningOutputTokens: usage.reasoningOutputTokens };
  }
  return other();
}

export type EventSummary = { kind: AttemptEvent['kind']; text: string; percent?: number };
export function summariseEvent(event: Pick<AttemptEvent, 'kind' | 'body'>): EventSummary {
  const view = describeEvent(event);
  let text: string;
  switch (view.kind) {
    case 'milestone': text = view.summary || view.message || view.reason || view.state; break;
    case 'criterion': text = view.criterion; break;
    case 'tool': text = view.detail; break;
    case 'diff': text = `${view.totals.files} · +${view.totals.additions} −${view.totals.deletions}`; break;
    case 'usage': text = `${view.inputTokens ?? '?'} / ${view.outputTokens ?? '?'}`; break;
    default: text = view.text;
  }
  return { kind: event.kind, text, ...(view.kind === 'progress' && view.percent !== undefined ? { percent: view.percent } : {}) };
}
export function evidenceView(body: unknown): { files: { path: string; status: string }[]; totals: { files: number; additions: number; deletions: number } | null } {
  const value = object(body);
  const files = Array.isArray(value.files) ? value.files.slice(0, 5000).flatMap(item => {
    const f = object(item);
    return typeof f.path === 'string' && typeof f.status === 'string' ? [{ path: cleanText(f.path), status: cleanText(f.status) }] : [];
  }) : [];
  const totals = object(value.totals);
  return { files, totals: count(totals.files) && count(totals.additions) && count(totals.deletions) ? { files: totals.files, additions: totals.additions, deletions: totals.deletions } : null };
}
