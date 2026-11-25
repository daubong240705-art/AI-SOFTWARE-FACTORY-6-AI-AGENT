import type { InsightMetric } from "@factory/contracts";
import { countedTokens } from "../policy/budget.js";
import { reported, type Usage } from "../trace/sources.js";

export type Sample = { ref: string };
export type Measurement = Sample & { value: number };
export type TokenSample = Sample & { usage: (Usage & { cost_kind: string })[] };

export const evidence = (refs: Iterable<string>): string[] => [...new Set(refs)].slice(0, 10);
export const metric = (value: number | null, samples: Sample[], support = samples): InsightMetric => ({
  value, samples: samples.length, evidence: evidence(support.map(({ ref }) => ref)),
});
export const count = (rows: Sample[]) => metric(rows.length, rows);
export const tally = <Row extends Sample>(rows: Row[], predicate: (row: Row) => boolean): InsightMetric => {
  const matches = rows.filter(predicate);
  return metric(matches.length, rows, matches.length ? matches : rows);
};
export const ratio = (part: number, total: number) => total ? part / total : null;
export const rate = (part: InsightMetric, rows: Sample[]) => ({ ...metric(ratio(part.value ?? 0, rows.length), rows),
  evidence: evidence([...part.evidence, ...rows.map(({ ref }) => ref)]) });
export const duration = (from: string | null, until: string | null): number | null => {
  if (from === null || until === null) return null;
  const elapsed = Date.parse(until) - Date.parse(from);
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
};
export const measure = <Row extends Sample>(rows: Row[], read: (row: Row) => number | null): Measurement[] => rows.flatMap((row) => {
  const value = read(row);
  return value === null ? [] : [{ ref: row.ref, value }];
});
export function percentiles(rows: Measurement[]) {
  const sorted = [...rows].sort((first, second) => first.value - second.value);
  if (!sorted.length) return { medianMs: metric(null, []), p90Ms: metric(null, []) };
  const lower = sorted[Math.floor((sorted.length - 1) / 2)]!;
  const upper = sorted[Math.floor(sorted.length / 2)]!;
  const p90 = sorted[Math.ceil(sorted.length * 0.9) - 1]!;
  return { medianMs: metric((lower.value + upper.value) / 2, rows, [lower, upper, ...rows]),
    p90Ms: metric(p90.value, rows, [p90, ...rows]) };
}

export function tokenTotals(rows: TokenSample[]) {
  const totals = { knownTokens: 0, estimatedTokens: 0, unknownCount: 0 };
  const support: Record<keyof typeof totals, Sample[]> = { knownTokens: [], estimatedTokens: [], unknownCount: [] };
  for (const row of rows) {
    if (!row.usage.length) { totals.unknownCount++; support.unknownCount.push(row); }
    for (const usage of row.usage) {
      const known = reported(usage);
      if (!known || usage.cost_kind === "unknown") { totals.unknownCount++; support.unknownCount.push(row); }
      if (known || usage.estimated_tokens !== null) {
        const key = known ? "knownTokens" : "estimatedTokens";
        totals[key] += countedTokens(usage);
        support[key].push(row);
      }
    }
  }
  const total = (key: keyof typeof totals) => metric(
    key !== "unknownCount" && totals.unknownCount > 0 && !support[key].length ? null : totals[key],
    rows, support[key].length ? support[key] : rows);
  return { knownTokens: total("knownTokens"), estimatedTokens: total("estimatedTokens"), unknownCount: total("unknownCount") };
}
