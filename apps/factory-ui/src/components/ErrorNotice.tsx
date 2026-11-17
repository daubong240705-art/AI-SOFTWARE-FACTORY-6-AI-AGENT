import { AlertCircle } from 'lucide-react';
import { useT } from '../i18n';
import type { StoreError } from '../state/store';

export function ErrorNotice({ error }: { error: StoreError }) {
  const t = useT();
  // Translate categories and the fixed automation details recognized by the API client.
  const key = error.code ? `safeErrors.${error.code}` : `safeErrors.${error.kind}`;
  const known = ['validation', 'conflict', 'needs-auth', 'permission-configuration', 'resource-exhausted', 'runtime-unavailable', 'outcome-unknown', 'not-found', 'forbidden', 'unsupported', 'internal', 'network', 'bad-response'];
  return <div role="alert" className="flex items-start gap-2 rounded-lg border border-need/30 bg-need/5 p-3 text-sm text-need [overflow-wrap:anywhere]">
    <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><div className="space-y-2">
    <p>{t(known.includes(error.code ?? error.kind) ? key : 'safeErrors.unexpected')}</p>
    {error.detailKey && <p className="text-sm">{t(error.detailKey)}</p>}
    {error.correlationId && <p>{t('errors.correlationId')}: {error.correlationId}</p>}
  </div></div>;
}
