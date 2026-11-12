import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { Fact, SystemCard, SystemRead, SystemTime } from './SystemCard';

export function BackupCard({ store, now }: { store: Store; now: number }) {
  const t = useT(); const backup = store.useStoreSelector(state => state.system.backups?.backup);
  const file = backup?.lastFile?.split(/[\\/]/).pop();
  return <SystemCard title={t('systemUi.backups')}><SystemRead store={store} area="backups">
    {backup ? <>
      <dl className="space-y-4">
        <Fact label={t('systemUi.lastSuccess')}><SystemTime value={backup.lastSuccessAt} now={now} /></Fact>
        <Fact label={t('systemUi.count')}>{backup.count}</Fact>
        <Fact label={t('systemUi.file')} mono><span className="break-all">{file || t('systemUi.unknown')}</span></Fact>
      </dl>
      {backup.lastError && <div className="space-y-1 border-t border-border pt-4 text-sm text-info">
        <p className="font-medium">{t('systemUi.lastError')} · <SystemTime value={backup.lastErrorAt} now={now} /></p>
        <p className="break-words">{backup.lastError}</p>
      </div>}
    </> : <p className="text-sm text-muted-foreground">{t('systemUi.noBackups')}</p>}
  </SystemRead></SystemCard>;
}
