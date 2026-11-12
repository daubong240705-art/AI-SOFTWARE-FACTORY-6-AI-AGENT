import { Badge } from '@/components/ui/badge';
import { useT } from '@/i18n';
import type { ModelSettings } from '@/api/modelSettings';

export function ModelPickerSummary({ settings, agents = true }: { settings: Pick<ModelSettings, 'leadModel' | 'leadEffort' | 'agentModels'>; agents?: boolean }) {
  const t = useT();
  return <dl className="grid gap-4 text-sm sm:grid-cols-[70px_1fr] sm:items-start">
    <dt className="pt-1 text-muted-foreground">{t('modelsUi.lead')}</dt><dd className="flex min-w-0 flex-wrap items-center gap-2">
      <Badge variant="outline" className="max-w-full rounded-full border-border px-3 py-1 font-medium whitespace-normal break-all">{settings.leadModel}</Badge>
      <Badge variant="secondary">{t(`modelsUi.efforts.${settings.leadEffort}`)}</Badge>
    </dd>
    {agents && <><dt className="pt-1 text-muted-foreground">{t('modelsUi.agents')}</dt><dd><ol className="flex flex-wrap gap-2">{settings.agentModels.map((model, index) => <li key={model} className="min-w-0 max-w-full"><Badge variant="outline" className="max-w-full flex-wrap rounded-full border-border px-3 py-1 font-medium whitespace-normal break-all"><span>{model}</span>{index === 0 && <span className="text-xs text-muted-foreground">{t('modelsUi.default')}</span>}</Badge></li>)}</ol></dd></>}
  </dl>;
}
