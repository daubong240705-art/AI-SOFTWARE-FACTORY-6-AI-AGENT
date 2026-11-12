import { useId } from 'react';
import { Info } from 'lucide-react';
import type { RuntimeConfig } from '@/api/agentRuntime';
import type { ModelSettingsResponse } from '@/api/modelSettings';
import { Select } from '@/components/Select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { displayName } from '@/screens/system/ModelPicker';
import type { RuntimeChoice } from './RuntimeCards';

export type RuntimeDraft = { choice: RuntimeChoice; model: string; effort: RuntimeConfig['effort']; permission: RuntimeConfig['permission'] };
export function RuntimeFields({ draft, onChange, models, disabled }: {
  draft: RuntimeDraft; onChange: (draft: RuntimeDraft) => void; models: ModelSettingsResponse | null; disabled: boolean;
}) {
  const t = useT(); const id = useId(); const { choice, model, effort, permission } = draft;
  if (choice === 'inherit') return null;
  const isCli = choice === 'codex' || choice === 'claude';
  const configured = [...new Set([...(models?.settings.agentModels ?? []), ...(choice === 'native-opencode' && model ? [model] : [])])];
  const gateway = [...(models?.available ?? []), ...(models?.catalog?.map(item => item.id) ?? [])];
  const suggestions = choice === 'codex' ? [...new Set(['gpt-6.1-sol', 'gpt-6-sol', 'gpt-5.6-sol', ...gateway.filter(value => value.startsWith('cx/')).map(value => value.slice(3))])] : ['opus', 'sonnet', 'haiku'];
  return <div className="space-y-5">
    <div className="space-y-2"><Label htmlFor={`${id}-model`}>{t('agentConfig.model')}</Label>
      {isCli ? <><Input id={`${id}-model`} list={`${id}-models`} value={model} disabled={disabled} maxLength={200} onChange={event => onChange({ ...draft, model: event.target.value })} placeholder={t('agentConfig.cliModelDefault')} />
        <datalist id={`${id}-models`}>{suggestions.map(value => <option key={value} value={value} />)}</datalist>
        <p className="text-xs text-muted-foreground">{t('agentConfig.cliModelDefault')}</p></>
        : <Select id={`${id}-model`} value={model} disabled={disabled} onValueChange={model => onChange({ ...draft, model })} options={[{ value: '', label: t('agentConfig.default') }, ...configured.map(value => { const name = models?.catalog?.find(item => item.id === value)?.name; return { value, label: displayName({ id: value, ...(name ? { name } : {}) }) }; })]} />}
    </div>
    {choice === 'claude' ? <p className="text-xs text-muted-foreground">{t('agentConfig.claudeEffort')}</p> : <div className="space-y-2"><Label htmlFor={`${id}-effort`}>{t('agentConfig.effort')}</Label>
      <Select id={`${id}-effort`} value={effort ?? ''} disabled={disabled} onValueChange={effort => onChange({ ...draft, effort: effort ? effort as RuntimeConfig['effort'] : null })} options={[{ value: '', label: t('agentConfig.default') }, ...(['low', 'medium', 'high', 'xhigh'] as const).map(value => ({ value, label: t(`modelsUi.efforts.${value}`) }))]} />
    </div>}
    {isCli && <div className="space-y-3"><Label>{t('agentConfig.permission')}</Label>
      <RadioGroup value={permission} disabled={disabled} onValueChange={permission => onChange({ ...draft, permission: permission as RuntimeConfig['permission'] })} aria-label={t('agentConfig.permission')} className="gap-2">
        {(['autonomous', 'workspace-write'] as const).map(value => <div key={value} className={cn('flex items-start gap-3 rounded-xl border border-border p-3', permission === value && 'bg-secondary')}>
          <RadioGroupItem id={`${id}-${value}`} value={value} className="mt-0.5" /><Label htmlFor={`${id}-${value}`} className="text-sm leading-relaxed">{t(`agentConfig.permissions.${value}`)}</Label>
        </div>)}
      </RadioGroup>
      {permission === 'autonomous' && <Alert className="border-border bg-info/10 text-info"><Info aria-hidden="true" /><AlertDescription className="text-foreground">{t('agentConfig.warning')}</AlertDescription></Alert>}
    </div>}
  </div>;
}
