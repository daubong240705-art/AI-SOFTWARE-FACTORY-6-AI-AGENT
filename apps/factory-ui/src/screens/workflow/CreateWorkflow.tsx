import { useEffect, useId, useState, type FormEvent } from 'react';
import { MascotEmpty } from '@/components/mascot';
import { workflowsCreate } from '@/api/commands';
import type { WorkflowDefinition } from '@/api/m5Models';
import { Dialog } from '@/components/Dialog';
import { Select } from '@/components/Select';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { useM3Command } from '../M3Shared';
import { M5ReadState } from '../M5Shared';
import { LazyWorkflowGraph } from './LazyWorkflowGraph';

type Parameter = WorkflowDefinition['parameters'][number];
type Values = Record<string, string | number | boolean>;
const definitionId = (definition: WorkflowDefinition) => JSON.stringify([definition.packKey, definition.packVersion, definition.key, definition.revision]);

function ParameterField({ parameter, value, id, disabled, onChange }: {
  parameter: Parameter; value: string | number | boolean; id: string; disabled: boolean;
  onChange: (value: string | boolean) => void;
}) {
  const label = parameter.name;
  if (parameter.type === 'bool' || parameter.type === 'boolean') {
    return <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
      <Label htmlFor={id} className="break-all">{label}</Label>
      <Switch id={id} checked={value === true} disabled={disabled} onCheckedChange={onChange} />
    </div>;
  }
  return <div className="grid min-w-0 gap-2">
    <Label htmlFor={id} className="break-all">{label}</Label>
    {parameter.options?.length ? <Select id={id} value={String(value)} disabled={disabled} required
      onValueChange={onChange} options={parameter.options.map(option => ({ value: option, label: option }))} />
      : parameter.type === 'number' ? <Input id={id} type="number" step="any" required value={String(value)} disabled={disabled}
        onChange={event => onChange(event.target.value)} />
        : <Input id={id} value={String(value)} maxLength={500} disabled={disabled} onChange={event => onChange(event.target.value)} />}
  </div>;
}

export function CreateWorkflow({ store, projectId, onClose, onCreated }: {
  store: Store; projectId: string; onClose: () => void; onCreated: (instanceId: string) => void;
}) {
  const t = useT();
  const id = useId();
  const state = store.useStoreSelector(value => value);
  const [selection, setSelection] = useState('');
  const [title, setTitle] = useState('');
  const [edited, setEdited] = useState<{ definition: string; values: Values }>({ definition: '', values: {} });
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { void store.loadWorkflowDefinitions(); }, [store, projectId]);
  const definitions = state.m5.workflowDefinitions;
  const definition = definitions.find(item => definitionId(item) === selection) ?? definitions[0];
  const selectedId = definition ? definitionId(definition) : '';
  const values: Values = edited.definition === selectedId ? edited.values : Object.fromEntries(
    (definition?.parameters ?? []).map(parameter => [parameter.name, parameter.default ?? (['bool', 'boolean'].includes(parameter.type) ? false : '')]),
  );
  const command = useM3Command(store, store.loadWorkflows, created => {
    if (created.type === 'workflows.create') onCreated(created.payload.instanceId);
  });
  const loading = !!state.loading['workflow-definitions'];
  const disabled = command.busy || state.session !== 'authenticated';
  const unavailable = loading || !!state.errors['workflow-definitions'] || !definition;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || unavailable || !definition) return;
    const params: Values = Object.fromEntries(definition.parameters.map(parameter => {
      const value = values[parameter.name] ?? '';
      return [parameter.name, parameter.type === 'number' ? (String(value).trim() ? Number(value) : NaN) : value];
    }));
    if (definition.parameters.some(parameter => {
      const value = params[parameter.name];
      return (parameter.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)))
        || (!!parameter.options?.length && !parameter.options.includes(String(value)));
    })) { setInvalid(true); return; }
    setInvalid(false);
    void command.run(workflowsCreate({ projectId, instanceId: crypto.randomUUID(), definitionKey: definition.key,
      ...(definition.packKey ? { packKey: definition.packKey } : {}), params,
      ...(title.trim() ? { title: title.trim() } : {}),
    }));
  }

  return <Dialog labelledBy={`${id}-heading`} onClose={onClose}>
    <header className="space-y-2">
      <h2 id={`${id}-heading`} className="font-display text-2xl font-semibold">{t('workflowGraph.create')}</h2>
      <p className="text-sm text-muted-foreground">{t('workflowGraph.createDescription')}</p>
    </header>
    <M5ReadState store={store} area="workflow-definitions" retry={store.loadWorkflowDefinitions} />
    <form onSubmit={submit} className="space-y-5" aria-busy={command.busy}>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-definition`}>{t('workflowGraph.definition')}</Label>
        <Select id={`${id}-definition`} value={selectedId} disabled={disabled || unavailable} required
          placeholder={t('workflowGraph.chooseDefinition')} onValueChange={value => { setSelection(value); setInvalid(false); }}
          options={definitions.map(item => ({ value: definitionId(item), label: `${item.title} · ${item.packKey}${item.packVersion ? ` ${item.packVersion}` : ''}` }))} />
      </div>
      {!definitions.length && !loading && !state.errors['workflow-definitions'] && <Empty className="rounded-xl border border-border p-5">
        <MascotEmpty seat="BA" state="offline" compact><EmptyDescription>{t('workflowGraph.noDefinitions')}</EmptyDescription></MascotEmpty>
      </Empty>}
      {definition && <>
        <div className="space-y-2">
          <p id={`${id}-preview`} className="text-sm font-medium">{t('workflowGraph.preview')}</p>
          <div role="region" aria-labelledby={`${id}-preview`} className="h-[220px] overflow-hidden rounded-xl border border-border bg-background">
            {definition.graph.stages.length ? <LazyWorkflowGraph key={selectedId} graph={definition.graph} phases={definition.phases} preview />
              : <Empty className="h-full p-5"><MascotEmpty seat="BA" state="offline" compact><EmptyDescription>{t('workflowGraph.previewUnavailable')}</EmptyDescription></MascotEmpty></Empty>}
          </div>
        </div>
        {!!definition.parameters.length && <fieldset disabled={disabled || unavailable} className="grid min-w-0 gap-4">
          <legend className="mb-3 text-sm font-medium">{t('workflowGraph.parameters')}</legend>
          {definition.parameters.map((parameter, index) => <ParameterField key={`${selectedId}:${parameter.name}`} parameter={parameter}
            value={values[parameter.name] ?? ''} id={`${id}-parameter-${index}`} disabled={disabled || unavailable}
            onChange={value => { setEdited({ definition: selectedId, values: { ...values, [parameter.name]: value } }); setInvalid(false); }} />)}
        </fieldset>}
        <div className="grid gap-2">
          <Label htmlFor={`${id}-title`}>{t('workflowGraph.title')}</Label>
          <Input id={`${id}-title`} value={title} maxLength={160} disabled={disabled || unavailable} onChange={event => setTitle(event.target.value)} />
        </div>
      </>}
      {invalid && <p role="alert" className="text-sm text-info">{t('workflowGraph.invalidParameters')}</p>}
      {command.notice}
      <footer className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" onClick={onClose}>{t('workflowGraph.dismiss')}</Button>
        <Button type="submit" disabled={disabled || unavailable}>{t('workflowGraph.createSubmit')}</Button>
      </footer>
    </form>
  </Dialog>;
}
