import { useId, useMemo, useRef, useState } from 'react';
import { modelSettingsSetSchema } from '@factory/contracts';
import { modelsSet } from '@/api/commands';
import { modelSettingsPendingKey, type ModelSettingsResponse } from '@/api/modelSettings';
import { ErrorNotice } from '@/components/ErrorNotice';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { ModelPicker, type PickerModel } from './ModelPicker';
import { ModelPickerAgentOrder } from './ModelPickerAgentOrder';
import { ModelPickerManual } from './ModelPickerManual';
import { ModelPickerSummary } from './ModelPickerSummary';

export function ModelPickerForm({ data, store, onClose, container }: {
  data: ModelSettingsResponse; store: Store; onClose: () => void; container: HTMLDivElement | null;
}) {
  const t = useT(); const id = useId(); const inFlight = useRef(false);
  const [leadModel, setLeadModel] = useState(data.settings.leadModel);
  const [leadEffort, setLeadEffort] = useState(data.settings.leadEffort);
  const [agentModels, setAgentModels] = useState(data.settings.agentModels);
  const [manual, setManual] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false); const [understood, setUnderstood] = useState(false);
  const [problem, setProblem] = useState('');
  const { projectId, busy, error } = store.useStoreSelector(state => ({
    projectId: state.selectedProjectId ?? state.projects[0]?.id,
    busy: state.loading[modelSettingsPendingKey], error: state.errors[modelSettingsPendingKey],
  }));
  const models = useMemo(() => {
    const catalog = new Map((data.catalog ?? []).map(model => [model.id, model]));
    const ids = new Set([...(data.available ?? [...catalog.keys()]), data.settings.leadModel, ...data.settings.agentModels, leadModel, ...agentModels, ...manual]);
    return [...ids].map(model => ({ ...catalog.get(model), id: model, outside: !data.available?.includes(model) })) as PickerModel[];
  }, [data, leadModel, agentModels, manual]);
  const draft = { leadModel, leadEffort, agentModels, expectedRevision: data.settings.revision };
  const changed = leadModel !== data.settings.leadModel || leadEffort !== data.settings.leadEffort || JSON.stringify(agentModels) !== JSON.stringify(data.settings.agentModels);
  const revisionMissing = data.settings.revision === null && data.settings.source !== 'environment';
  const valid = modelSettingsSetSchema.safeParse(draft).success && data.efforts.includes(leadEffort);
  const canSave = Boolean(projectId) && changed && valid && !revisionMissing && !busy;
  function add(model: string, agent: boolean) {
    setManual(previous => [...new Set([...previous, model])]);
    if (agent) setAgentModels(previous => previous.includes(model) ? previous : [...previous, model].slice(0, 8));
    else setLeadModel(model);
  }
  async function save() {
    if (inFlight.current || !canSave || !projectId || !understood) return;
    setProblem(''); inFlight.current = true;
    try {
      const command = modelsSet({ projectId, ...draft });
      const result = await store.sendModelSettings(command);
      if (result || store.getState().errors[modelSettingsPendingKey]?.code === 'conflict') onClose();
    } catch { setProblem('modelsUi.invalid'); }
    finally { inFlight.current = false; }
  }
  return <form className="min-w-0 space-y-5" aria-busy={Boolean(busy)} onSubmit={event => {
    event.preventDefault();
    if (confirming) void save();
    else if (canSave) { setConfirming(true); setUnderstood(false); }
  }}>
    {!projectId && <p className="text-sm text-muted-foreground">{t('modelsUi.noProject')}</p>}
    {revisionMissing && <p className="text-sm text-muted-foreground">{t('modelsUi.revisionMissing')}</p>}
    <fieldset disabled={Boolean(busy) || !projectId || revisionMissing} className="min-w-0 space-y-5">
      {confirming ? <div className="space-y-5">
        <h3 className="font-display text-lg font-semibold">{t('modelsUi.confirmTitle')}</h3>
        <ModelPickerSummary settings={draft} />
        <Alert className="border-border bg-muted/40"><AlertDescription className="text-foreground">{t('modelsUi.warning')}</AlertDescription></Alert>
        <div className="flex items-center gap-2"><Checkbox id={`${id}-ack`} checked={understood} onCheckedChange={value => setUnderstood(value === true)} /><Label htmlFor={`${id}-ack`}>{t('modelsUi.understood')}</Label></div>
      </div> : <Tabs defaultValue="lead" className="min-w-0 gap-4">
        <TabsList aria-label={t('modelsUi.title')} className="w-full"><TabsTrigger value="lead">{t('modelsUi.lead')}</TabsTrigger><TabsTrigger value="agents">{t('modelsUi.agents')}</TabsTrigger></TabsList>
        <TabsContent value="lead" className="min-w-0 space-y-4">
          <div className="flex items-center gap-3"><Label htmlFor={`${id}-effort`}>{t('modelsUi.effort')}</Label>
            <Select value={leadEffort} onValueChange={value => { if (value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') setLeadEffort(value); }}>
              <SelectTrigger id={`${id}-effort`} className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent position="popper" sideOffset={6} collisionPadding={12} container={container}>{(['low', 'medium', 'high', 'xhigh'] as const).map(effort => <SelectItem key={effort} value={effort} disabled={!data.efforts.includes(effort)}>{t(`modelsUi.efforts.${effort}`)}</SelectItem>)}</SelectContent>
            </Select></div>
          <ModelPicker models={models} selected={[leadModel]} multi={false} onChange={next => { if (next[0]) setLeadModel(next[0]); }} />
          {data.available === null && <ModelPickerManual onAdd={model => add(model, false)} />}
        </TabsContent>
        <TabsContent value="agents" className="min-w-0 space-y-4">
          <ModelPicker models={models} selected={agentModels} multi onChange={setAgentModels} />
          {data.available === null && <ModelPickerManual onAdd={model => add(model, true)} disabled={agentModels.length >= 8} />}
          <ModelPickerAgentOrder models={agentModels} onChange={setAgentModels} />
        </TabsContent>
      </Tabs>}
    </fieldset>
    {problem && <p role="alert" className="text-sm text-muted-foreground">{t(problem)}</p>}{error && <ErrorNotice error={error} />}
    <DialogFooter className="border-t border-border pt-4">
      <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={onClose}>{t('modelsUi.cancel')}</Button>
      {confirming && <Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={() => { setConfirming(false); setUnderstood(false); }}>{t('modelsUi.back')}</Button>}
      <Button type="submit" disabled={!canSave || (confirming && !understood)}>{busy ? t('modelsUi.saving') : t(confirming ? 'modelsUi.confirm' : 'modelsUi.save')}</Button>
    </DialogFooter>
  </form>;
}
