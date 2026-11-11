import { ErrorNotice } from '../components/ErrorNotice';
import { useT } from '../i18n';
import type { Store } from '../state/store';

const states = ['draft', 'active', 'awaiting-approval', 'paused', 'resuming', 'completed', 'failed', 'cancelled', 'superseded', 'stalled', 'unknown', 'pending', 'ready', 'done', 'blocked', 'skipped', 'enabled', 'quarantined', 'ok', 'tripped', 'open', 'half-open'] as const;
export function M5Status({ value }: { value: string }) {
  const t = useT(); const known = states.find(state => state === value) ?? 'unknown';
  const tone = known === 'awaiting-approval' ? 'need' : ['active', 'resuming'].includes(known) ? 'run' : ['completed', 'done', 'ok'].includes(known) ? 'ok' : ['quarantined', 'tripped', 'open', 'half-open', 'stalled', 'failed', 'blocked'].includes(known) ? 'info' : 'neutral';
  return <span className={`m5-status m5-status-${tone}`}>{t(`m5Ui.states.${known}`)}</span>;
}
export function M5ReadState({ store, area, retry, empty = false, emptyKey }: { store: Store; area: string; retry: () => Promise<void>; empty?: boolean; emptyKey?: string }) {
  const t = useT(); const { loading, errors } = store.useStoreSelector(s => s);
  return <>{loading[area] && <p role="status">{t('viewStates.loading')}</p>}{errors[area] && <div className="stack"><ErrorNotice error={errors[area]} /><button type="button" disabled={loading[area]} onClick={() => void retry()}>{t('errors.retry')}</button></div>}{empty && emptyKey && !loading[area] && !errors[area] && <p className="m5-empty">{t(emptyKey)}</p>}</>;
}
