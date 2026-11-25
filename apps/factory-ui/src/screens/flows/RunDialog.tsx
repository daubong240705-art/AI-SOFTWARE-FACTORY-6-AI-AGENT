import { Choice, ChoiceOption } from '@/components/ui/choice';
import { useState } from 'react';
import { flowRunsStartPayloadSchema, idSchema, type FlowDefinition } from '@factory/contracts';
import type { ApiClient } from '@/api/client';
import { flowCommand } from '@/api/commands';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { openFlowRoute } from '../shell/navigation';
import { Toggle } from './FlowFields';
import { Field, FlowDialog, FlowError, flowNodeTitle, useFlowLabels, useFlowWrite } from './shared';

export type RunVersion = 'draft' | number;
const ignore = () => {};
type InputValue = string | boolean | number;

function valueFor(input: FlowDefinition['inputs'][number], raw: string): InputValue | undefined {
  if (raw === '') return undefined;
  if (input.type === 'bool') return raw === 'true' ? true : raw === 'false' ? false : undefined;
  if (input.type === 'number') return Number(raw);
  return raw;
}

function objectJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return null; }
}

export function RunDialog({ api, projectId, flowId, version, definition, close, loadingDefinition = false }: {
  api: ApiClient; projectId: string; flowId: string; version: RunVersion; definition?: FlowDefinition | undefined; close: () => void; loadingDefinition?: boolean;
}) {
  const label = useFlowLabels();
  const test = version === 'draft';
  const write = useFlowWrite(api, ignore);
  const [values, setValues] = useState<Record<string, string>>({});
  const [rawInputs, setRawInputs] = useState('{}');
  const [pins, setPins] = useState<Record<string, string>>({});
  const [mockAgents, setMockAgents] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const inputValues = definition ? Object.fromEntries(definition.inputs.flatMap(input => {
    const raw = Object.hasOwn(values, input.name) ? values[input.name]! : input.default === undefined ? '' : String(input.default);
    const value = valueFor(input, raw) ?? (!Object.hasOwn(values, input.name) && input.type === 'string' && input.default === '' ? '' : undefined);
    return value === undefined ? [] : [[input.name, value] as const];
  })) : objectJson(rawInputs);
  const invalidInputs = new Set(definition?.inputs.filter(input => {
    const value: unknown = (inputValues as Record<string, InputValue>)[input.name];
    return value === undefined ? input.required : input.type === 'artifact' ? !idSchema.safeParse(value).success
      : input.type === 'enum' ? !input.values?.includes(String(value)) : input.type === 'number' ? !Number.isFinite(value) : false;
  }).map(input => input.name));
  const pinEntries = Object.entries(pins).filter(([, raw]) => raw.trim());
  const invalidPins = new Set(pinEntries.filter(([, raw]) => {
    try { return !flowRunsStartPayloadSchema.shape.pinned.safeParse({ sample: JSON.parse(raw) }).success; } catch { return true; }
  }).map(([id]) => id));
  function start() {
    setSubmitted(true);
    if (loadingDefinition || invalidInputs.size || invalidPins.size) return;
    const runId = crypto.randomUUID();
    const payload = flowRunsStartPayloadSchema.safeParse({ runId, flowId, version, inputs: inputValues,
      pinned: Object.fromEntries(pinEntries.map(([id, raw]) => [id, JSON.parse(raw)])), mockAgents });
    if (!payload.success) { write.setError(new Error()); return; }
    void write.run(() => flowCommand('flow-runs.start', projectId, payload.data), () => openFlowRoute(projectId, { kind: 'runs', id: runId }));
  }
  return <FlowDialog title={label(test ? 'testRun' : 'run')} description={label(test ? 'testHelp' : 'runHelp')} close={close} busy={write.busy} disabled={loadingDefinition} submit={label('start')} onSubmit={start} wide>
    {loadingDefinition ? <p role="status">{label('loading')}</p> : definition ? definition.inputs.map((input, index) => {
      const raw = Object.hasOwn(values, input.name) ? values[input.name]! : input.default === undefined ? '' : String(input.default);
      const set = (value: string) => setValues(current => ({ ...current, [input.name]: value }));
      return <Field key={index} label={`${input.name}${input.required ? ' *' : ''}`} invalid={submitted && invalidInputs.has(input.name) ? label('invalidInput') : undefined}>{props =>
        input.type === 'bool' || input.type === 'enum' ? <Choice {...props} value={raw} onValueChange={selectedValue => set(selectedValue)}><ChoiceOption value="">{label('none')}</ChoiceOption>
          {(input.type === 'bool' ? ['true', 'false'] : input.values ?? []).map(option => <ChoiceOption key={option} value={option}>{input.type === 'bool' ? label(`option.${option}`) : option}</ChoiceOption>)}</Choice>
          : <Input {...props} value={raw} type={input.type === 'number' ? 'number' : 'text'} onChange={event => set(event.target.value)} />}</Field>;
    }) : <><p className="text-sm text-muted-foreground">{label('publishedInputsUnavailable')}</p><Field label={label('inputsJson')}>{props => <Textarea {...props} value={rawInputs} onChange={event => setRawInputs(event.target.value)} spellCheck={false} className="font-mono" />}</Field></>}
    {test && <><Toggle name={label('mockAgents')} checked={mockAgents} set={setMockAgents} /><details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{label('pinned')}</summary><div className="mt-3 grid gap-3">
      {definition?.nodes.map(node => <Field key={node.id} label={flowNodeTitle(node, label)} invalid={invalidPins.has(node.id) ? label('invalidJson') : undefined}>{props => <Textarea {...props} rows={2} value={pins[node.id] ?? ''} placeholder={label('noPin')} onChange={event => setPins(current => ({ ...current, [node.id]: event.target.value }))} className="font-mono text-xs" spellCheck={false} />}</Field>)}
    </div></details>{invalidPins.size > 0 && <p role="alert" className="text-sm text-destructive">{label('invalidJson')}</p>}</>}
    <FlowError error={write.error} />
  </FlowDialog>;
}
