import { useT } from '../i18n';
import type { StoreError } from '../state/store';

export function ErrorNotice({ error }: { error: StoreError }) {
  const t = useT();
  // Translate categories and the fixed automation details recognized by the API client.
  const key = error.code ? `safeErrors.${error.code}` : `safeErrors.${error.kind}`;
  const known = ['validation', 'conflict', 'needs-auth', 'permission-configuration', 'resource-exhausted', 'runtime-unavailable', 'outcome-unknown', 'not-found', 'forbidden', 'unsupported', 'internal', 'network', 'bad-response'];
  return <div role="alert" className="error-notice stack">
    <p>{t(known.includes(error.code ?? error.kind) ? key : 'safeErrors.unexpected')}</p>
    {error.detailKey && <p className="text-sm">{t(error.detailKey)}</p>}
    {error.correlationId && <p>{t('errors.correlationId')}: {error.correlationId}</p>}
  </div>;
}
