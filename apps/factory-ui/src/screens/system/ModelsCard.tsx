import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { SystemCard, SystemRead, SystemStatus } from './SystemCard';
import { ModelPickerSummary } from './ModelPickerSummary';
import { ModelPickerDialog } from './ModelPickerDialog';

export function ModelsCard({ store }: { store: Store }) {
  const t = useT(); const [open, setOpen] = useState(false);
  const { models, projectId } = store.useStoreSelector(state => ({ models: state.system.models, projectId: state.selectedProjectId ?? state.projects[0]?.id }));
  return <SystemCard title={t('setupUi.provider.title')}>
    <div className="space-y-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">
      <p>{t('setupUi.provider.intro')} <code className="text-foreground">factory setup</code>. {t('setupUi.provider.noKey')}</p>
      <p>{t('setupUi.provider.defaultPath')} <code className="text-foreground">~/.factory/config/factory.env</code>. {t('setupUi.provider.actualPath')} <code className="text-foreground">factory config path</code>.</p>
      <details>
        <summary className="cursor-pointer font-medium text-foreground">{t('setupUi.provider.guide')}</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>{t('setupUi.provider.hosted')}</li>
          <li>{t('setupUi.provider.local')}</li>
          <li>{t('setupUi.provider.anthropic')}</li>
        </ul>
        <p className="mt-2">{t('setupUi.provider.urlRules')}</p>
      </details>
    </div>
    <SystemRead store={store} area="models">
    {models && <div className="space-y-5"><div className="flex flex-wrap items-start justify-between gap-4"><Badge variant="secondary">{t(`modelsUi.${models.settings.source}`)}</Badge><Button type="button" onClick={() => setOpen(true)}>{t('modelsUi.change')}</Button></div>
      <ModelPickerSummary settings={models.settings} agents={models.runtime.opencode || models.settings.agentModels.length > 0} />
      {models.runtime.leadCli && <SystemStatus tone="ok" label={t('modelsUi.leadCli')} />}
      {!projectId && <p className="text-sm text-muted-foreground">{t('modelsUi.noProject')}</p>}
      <p className="max-w-5xl text-xs leading-relaxed text-muted-foreground">{t(models.runtime.leadCli ? 'modelsUi.cliNote' : 'setupUi.provider.modelNote')}</p>
      {open && <ModelPickerDialog store={store} onClose={() => setOpen(false)} />}
    </div>}
  </SystemRead></SystemCard>;
}
