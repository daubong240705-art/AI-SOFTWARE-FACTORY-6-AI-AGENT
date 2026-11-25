import type { InsightMetric } from '@factory/contracts';
import { i18n, useT } from '@/i18n';
import { formatNumber } from './presentation';

export function useInsightsLabels() {
  const t = useT();
  return (key: string, values: Record<string, string | number> = {}) => t(`insightsUi.${key}`).replace(/\{(\w+)\}/g, (token, name: string) => String(values[name] ?? token));
}

export const percent = (value: number) => new Intl.NumberFormat(i18n.locale, { style: 'percent', maximumFractionDigits: 1 }).format(value);

export function metric(item: InsightMetric, unknown: string, format = formatNumber) {
  return item.value === null ? unknown : format(item.value);
}
