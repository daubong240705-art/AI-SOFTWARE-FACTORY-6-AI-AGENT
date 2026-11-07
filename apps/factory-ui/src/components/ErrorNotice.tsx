import { useT } from '../i18n';
import type { StoreError } from '../state/store';

export function ErrorNotice({ error }: { error: StoreError }) {
  const t = useT();
  // The core supplies safe error categories. Translate categories, never transport/server text.
  const key = error.code ? `safeErrors.${error.code}` : `safeErrors.${error.kind}`;
  const known = ['validation', 'conflict', 'needs-auth', 'permission-configuration', 'resource-exhausted', 'runtime-unavailable', 'outcome-unknown', 'not-found', 'forbidden', 'unsupported', 'internal', 'network', 'bad-response'];
  return <div role="alert" className="error-notice stack">
    <p>{t(known.includes(error.code ?? error.kind) ? key : 'safeErrors.unexpected')}</p>
    {error.correlationId && <p>{t('errors.correlationId')}: {error.correlationId}</p>}
  </div>;
}
