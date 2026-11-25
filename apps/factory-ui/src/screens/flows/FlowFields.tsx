import { useId } from 'react';
import { flowConditionSchema, type AgentSelector, type FlowCondition, type FlowDefinition, type ProjectAgentsResponse } from '@factory/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Choice, Field, JsonField, useFlowLabels } from './shared';

export function TextField({ name, value, set, suggestions, template, multi = false, type = 'text' }: {
  name: string; value: string; set: (value: string) => void; suggestions?: string[] | undefined; template?: boolean; multi?: boolean; type?: string;
}) {
  const id = useId();
  const label = useFlowLabels();
  return <Field label={label(`field.${name}`)}>{props => <>
    {multi ? <Textarea data-testid={`flow-field-${name}`} {...props} rows={3} value={value} onChange={event => set(event.target.value)} />
      : <Input {...props} type={type} value={value} list={suggestions && !template ? id : undefined} onChange={event => set(event.target.value)} />}
    {suggestions && !template && <datalist id={id}>{suggestions.map(path => <option key={path} value={path} />)}</datalist>}
    {suggestions && template && <Choice aria-label={`${label('insertPath')}: ${label(`field.${name}`)}`} value="" onChange={event => { if (event.target.value) set(`${value}{{ ${event.target.value} }}`); }}>
      <option value="">{label('insertPath')}</option>{suggestions.map(path => <option key={path} value={path}>{path}</option>)}
    </Choice>}
  </>}</Field>;
}

export function NumField({ name, value, set, optional = false }: { name: string; value?: number | undefined; set: (value: number | undefined) => void; optional?: boolean }) {
  const label = useFlowLabels();
  return <Field label={label(`field.${name}`)}>{props => <Input {...props} type="number" value={value ?? ''} onChange={event => set(event.target.value === '' ? (optional ? undefined : 0) : Number(event.target.value))} />}</Field>;
}

export function EnumField<Value extends string>({ name, value, options, set }: { name: string; value: Value; options: readonly Value[]; set: (value: Value) => void }) {
  const label = useFlowLabels();
  return <Field label={label(`field.${name}`)}>{props => <Choice {...props} value={value} onChange={event => set(event.target.value as Value)}>
    {options.map(option => <option key={option} value={option}>{label(`option.${option}`)}</option>)}
  </Choice>}</Field>;
}

export function Toggle({ name, checked, set }: { name: string; checked: boolean; set: (checked: boolean) => void }) {
  return <label className="flex items-center gap-2 text-sm"><input data-testid="flow-toggle" type="checkbox" className="size-4 accent-primary" checked={checked} onChange={event => set(event.target.checked)} />{name}</label>;
}

export function pathsFor(definition: FlowDefinition) {
  return [...new Set(['trigger.input', 'inputs', 'item', 'loop.iteration', 'run.id',
    ...definition.inputs.flatMap(input => [`inputs.${input.name}`, `trigger.input.${input.name}`]),
    ...definition.nodes.flatMap(node => [`nodes.${node.id}.output`, ...(node.type === 'agent' && node.outputSchema?.type === 'object'
      ? Object.keys(node.outputSchema.properties).map(key => `nodes.${node.id}.output.${key}`) : [])])])];
}

export function StringsField({ name, values, set, suggestions }: { name: string; values: string[]; set: (values: string[]) => void; suggestions?: string[] | undefined }) {
  const label = useFlowLabels();
  if (!suggestions) return <TextField name={name} multi value={values.join('\n')} set={value => set(value ? value.split('\n') : [])} />;
  return <div className="grid gap-2">
    {values.map((entry, index) => <div key={index} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-1">
      <TextField name={name} value={entry} suggestions={suggestions} set={value => set(values.map((item, at) => at === index ? value : item))} />
      <Button type="button" size="sm" variant="ghost" onClick={() => set(values.filter((_, at) => at !== index))}>{label('remove')}</Button>
    </div>)}
    <Button type="button" size="sm" variant="outline" onClick={() => set([...values, suggestions[0] ?? 'inputs'])}>{label('addPath')}</Button>
  </div>;
}

export const defaultCondition: FlowCondition = { path: 'inputs', op: 'eq', value: '' };
export type SelectorMode = 'agent' | 'role' | 'tags' | 'team';
const emptyId = '00000000-0000-4000-8000-000000000000';
export function initialSelector(mode: SelectorMode, roster?: ProjectAgentsResponse): AgentSelector {
  const first = roster?.agents.find(agent => agent.status === 'active');
  switch (mode) {
    case 'agent': return { agent: first?.id ?? emptyId };
    case 'role': return { role: first?.role ?? 'worker' };
    case 'tags': return { tags: ['worker'] };
    case 'team': return { team: roster?.teams[0]?.id ?? emptyId, pick: 'least-busy' };
  }
}

export function AgentField({ name, selector, set, roster }: { name: string; selector: AgentSelector; set: (selector: AgentSelector) => void; roster?: ProjectAgentsResponse | undefined }) {
  const label = useFlowLabels();
  const mode = 'agent' in selector ? 'agent' : 'team' in selector ? 'team' : 'role' in selector ? 'role' : 'tags';
  function picker(key: string, current: string, items: { id: string; name: string }[], change: (value: string) => void) {
    return <Field label={label(`field.${key}`)}>{props => <Choice {...props} value={current} onChange={event => change(event.target.value)}>
      {!items.some(item => item.id === current) && <option value={current}>{current === emptyId ? label('none') : current}</option>}
      {items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </Choice>}</Field>;
  }
  return <fieldset className="grid gap-2 rounded-lg border p-2"><legend className="px-1 text-xs font-medium">{label(`field.${name}`)}</legend>
    <EnumField name="selectorMode" value={mode} options={['agent', 'role', 'tags', 'team']} set={value => set(initialSelector(value, roster))} />
    {'agent' in selector && picker('agent', selector.agent, roster?.agents ?? [], value => set({ agent: value }))}
    {'team' in selector && <>{picker('team', selector.team, roster?.teams ?? [], value => set({ ...selector, team: value }))}
      <EnumField name="pick" value={selector.pick} options={['least-busy', 'round-robin']} set={value => set({ ...selector, pick: value })} /></>}
    {'role' in selector && <TextField name="role" value={selector.role} set={value => set({ role: value })} suggestions={[...new Set(roster?.agents.map(agent => agent.role))]} />}
    {'tags' in selector && <StringsField name="tags" values={selector.tags} set={values => set({ tags: values })} />}
  </fieldset>;
}

export function ConditionFields({ value, set, paths }: { value: FlowCondition; set: (value: FlowCondition) => void; paths: string[] }) {
  const label = useFlowLabels();
  if (!('path' in value || 'param' in value)) return <div className="space-y-2">
    <p className="text-xs text-muted-foreground">{label('readOnlyCondition')}</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-xs">{JSON.stringify(value, null, 2)}</pre>
    <Button type="button" size="sm" variant="outline" onClick={() => set(defaultCondition)}>{label('replaceCondition')}</Button>
  </div>;
  const path = 'path' in value ? value.path : `inputs.${value.param}`;
  return <div className="grid gap-2">
    <TextField name="path" value={path} set={next => set({ path: next, op: value.op, value: value.value })} suggestions={paths} />
    <EnumField name="operator" value={value.op} options={['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in']} set={op => set({ ...value, op,
      value: op === 'in' ? (Array.isArray(value.value) ? value.value : [value.value]) : op === 'eq' || op === 'ne' ? (Array.isArray(value.value) ? value.value[0] ?? '' : value.value) : (typeof value.value === 'number' ? value.value : 0) })} />
    <JsonField title={label('field.value')} value={value.value} parse={raw => {
      const parsed = flowConditionSchema.parse({ ...value, value: raw });
      if (!('value' in parsed)) throw new Error();
      return parsed.value;
    }} onChange={next => set({ ...value, value: next })} />
  </div>;
}

export function SelectorList({ selectors, set, roster }: { selectors: AgentSelector[]; set: (values: AgentSelector[]) => void; roster?: ProjectAgentsResponse | undefined }) {
  const label = useFlowLabels();
  return <div className="grid gap-2">{selectors.map((selector, index) => <div key={index} className="grid gap-1">
    <AgentField name="allowed" selector={selector} roster={roster} set={value => set(selectors.map((item, at) => at === index ? value : item))} />
    <Button type="button" variant="ghost" size="sm" disabled={selectors.length === 1} onClick={() => set(selectors.filter((_, at) => at !== index))}>{label('remove')}</Button>
  </div>)}<Button type="button" variant="outline" size="sm" disabled={selectors.length === 20} onClick={() => set([...selectors, initialSelector('agent', roster)])}>{label('addSelector')}</Button></div>;
}

export function MappingField({ name, value, set, paths, scalar = false }: {
  name: string; value: Record<string, string | number | boolean>; set: (value: Record<string, string | number | boolean>) => void; paths: string[]; scalar?: boolean;
}) {
  const label = useFlowLabels();
  const entries = Object.entries(value);
  function edit(index: number, key: string, next: string | number | boolean) {
    if (entries.some(([name], at) => name === key && at !== index)) return;
    set(Object.fromEntries(entries.map((entry, at) => at === index ? [key, next] : entry)));
  }
  return <fieldset className="grid gap-2 rounded-lg border p-2"><legend className="px-1 text-xs font-medium">{label(`field.${name}`)}</legend>
    {entries.map(([key, entry], index) => <div key={index} className="grid gap-2 border-b pb-2">
      <TextField name="key" value={key} set={next => edit(index, next, entry)} />
      {scalar && <EnumField name="valueType" value={typeof entry as 'string' | 'number' | 'boolean'} options={['string', 'number', 'boolean']} set={type => edit(index, key, type === 'boolean' ? false : type === 'number' ? 0 : String(entry))} />}
      {typeof entry === 'boolean' ? <Toggle name={label('field.value')} checked={entry} set={next => edit(index, key, next)} />
        : typeof entry === 'number' ? <NumField name="value" value={entry} set={next => edit(index, key, next ?? 0)} />
          : <TextField name="value" value={entry} template suggestions={paths} set={next => edit(index, key, next)} />}
      <Button type="button" size="sm" variant="ghost" onClick={() => set(Object.fromEntries(entries.filter((_, at) => at !== index)))}>{label('remove')}</Button>
    </div>)}
    <Button type="button" size="sm" variant="outline" disabled={scalar && entries.length >= 20} onClick={() => {
      let suffix = entries.length + 1;
      while (Object.hasOwn(value, `key${suffix}`)) suffix++;
      set({ ...value, [`key${suffix}`]: '' });
    }}>{label('addMapping')}</Button>
  </fieldset>;
}
