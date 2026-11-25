import { useContext, useEffect } from 'react';
import { bundleDirSchema, bundleQuerySchema, bundleScriptsSchema, isBundleOperation, validateBundleParams, type FlowDefinition } from '@factory/contracts';
import type { ApiClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Choice, ChoiceOption } from '@/components/ui/choice';
import { Input } from '@/components/ui/input';
import { useT } from '@/i18n';
import { RetryRead, useProjectIntegrations } from '../integrations/shared';
import { Field, PendingJson } from './shared';
import { bundleDefaults, type ActionNode } from './nodeTypes';

const reserved = new Set(['integrationId', 'operation', 'dir', 'ref', 'scripts', 'query']);
const fromInput = 'from-input';

export function BundleActionFields({ api, projectId, params, inputs, set }: {
  api: ApiClient; projectId: string; params: ActionNode['params']; inputs: FlowDefinition['inputs']; set: (next: ActionNode['params']) => void;
}) {
  const t = useT();
  const result = useProjectIntegrations(api, projectId);
  const integrations = result.data?.filter(item => item.kind === 'http-api') ?? [];
  const current = typeof params.integrationId === 'string' ? params.integrationId : '';
  const dynamic = current.trim().startsWith('{{');
  const selected = integrations.find(item => item.id === current);
  const operations = (selected?.config.operations ?? []).filter(isBundleOperation);
  const operation = typeof params.operation === 'string' ? params.operation : '';
  const selectedOperation = operations.find(item => item.name === operation);
  const dir = typeof params.dir === 'string' ? params.dir : bundleDefaults.dir;
  const ref = String(params.ref ?? bundleDefaults.ref);
  const scripts = bundleScriptsSchema.safeParse(params.scripts ?? bundleDefaults.scripts);
  const query = typeof params.query === 'object' && !Array.isArray(params.query) ? params.query : {};
  const pathEntries = Object.entries(params).filter(([key]) => !reserved.has(key));
  const placeholders = [...new Set(Array.from(selectedOperation?.path.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g) ?? [], match => match[1]!))];
  const issues = validateBundleParams(params, result.data ? { bundleOperations: id => integrations.find(item => item.id === id)?.config.operations } : undefined);
  const invalid = (code: (typeof issues)[number]['code']) => issues.some(issue => issue.code === code) ? t(`flowsUi.validation.${code}`) : undefined;
  const malformed = !bundleQuerySchema.safeParse(query).success || pathEntries.some(([key]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key));
  const pending = useContext(PendingJson);
  useEffect(() => {
    if (!malformed || !pending) return;
    pending(count => count + 1);
    return () => pending(count => Math.max(0, count - 1));
  }, [malformed, pending]);
  function pickOperation(next: string, path?: string) {
    const kept = Object.fromEntries(Object.entries(params).filter(([key]) => reserved.has(key) || path?.includes(`{${key}}`)));
    set({ ...kept, operation: next });
  }
  function nextKey(record: object, prefix: string) {
    let index = 1;
    while (Object.hasOwn(record, `${prefix}${index}`)) index++;
    return `${prefix}${index}`;
  }
  const inputOptions = inputs.filter(input => input.type === 'string' || input.type === 'enum').map(input => `{{inputs.${input.name}}}`);
  const inputValue = current.replace(/^\s*\{\{\s*(.*?)\s*\}\}\s*$/, '{{$1}}');
  const queryEntries = Object.entries(query);
  return <div data-testid="flow-bundle-editor" className="grid min-w-0 gap-3">
    <RetryRead error={result.error} loading={result.loading} retry={result.refresh} />
    {result.data && !integrations.length && <p className="text-xs text-muted-foreground">{t('integrationsUi.noHttpConnections')}</p>}
    <Field label={t('flowBundleUi.integration')} invalid={invalid('bundle-integration')}>{props => <Choice {...props} data-testid="flow-bundle-integration" value={dynamic ? fromInput : current}
      onValueChange={value => { if (value === fromInput) set({ ...params, integrationId: inputOptions[0] ?? '{{inputs.}}' });
        else if (value !== current) {
          const compatible = integrations.find(item => item.id === value)?.config.operations.find(item => item.name === operation);
          const path = isBundleOperation(compatible) ? compatible.path : undefined;
          const kept = Object.fromEntries(Object.entries(params).filter(([key]) => reserved.has(key) || path?.includes(`{${key}}`)));
          set({ ...kept, integrationId: value, operation: path ? operation : '' });
        } }}>
      <ChoiceOption value="">{t('integrationsUi.selectConnection')}</ChoiceOption>
      {current && !dynamic && !selected && <ChoiceOption value={current}>{current} ({t('integrationsUi.unavailable')})</ChoiceOption>}
      {integrations.map(item => <ChoiceOption key={item.id} value={item.id}>{item.name}</ChoiceOption>)}
      <ChoiceOption value={fromInput}>{t('flowBundleUi.fromInput')}</ChoiceOption>
    </Choice>}</Field>
    {dynamic && <Field label={t('flowBundleUi.input')} hint={!inputOptions.length ? t('flowBundleUi.noInputs') : undefined}>{props => <Choice {...props} data-testid="flow-bundle-input" value={inputValue} onValueChange={value => set({ ...params, integrationId: value || '{{inputs.}}' })}>
      {(!inputOptions.includes(inputValue)) && <ChoiceOption value={inputValue}>{inputValue === '{{inputs.}}' ? t('flowBundleUi.chooseInput') : inputValue}</ChoiceOption>}
      {inputOptions.map(item => <ChoiceOption key={item} value={item}>{item}</ChoiceOption>)}
    </Choice>}</Field>}
    <Field label={t('flowBundleUi.operation')} hint={t('flowBundleUi.operationHelp')} invalid={invalid('bundle-operation') ?? (selected && operation && !selectedOperation ? t('flowsUi.validation.bundle-operation') : undefined)}>{props => dynamic
      ? <Input {...props} data-testid="flow-bundle-operation" maxLength={64} value={operation} onChange={event => set({ ...params, operation: event.target.value })} />
      : <Choice {...props} data-testid="flow-bundle-operation" disabled={!selected} value={operation} onValueChange={value => pickOperation(value, operations.find(item => item.name === value)?.path)}>
        <ChoiceOption value="">{t('integrationsUi.selectOperation')}</ChoiceOption>
        {operation && !selectedOperation && <ChoiceOption value={operation}>{operation} ({t('integrationsUi.unavailable')})</ChoiceOption>}
        {operations.map(item => <ChoiceOption key={item.name} value={item.name}>{item.name} · {item.method} {item.path}</ChoiceOption>)}
      </Choice>}</Field>
    <Field label={t('flowBundleUi.dir')} hint={t('flowBundleUi.dirHelp')} invalid={!bundleDirSchema.safeParse(dir).success ? t('flowsUi.validation.bundle-dir') : undefined}>{props => <Input {...props} data-testid="flow-bundle-dir" maxLength={1024} value={dir} onChange={event => set({ ...params, dir: event.target.value })} />}</Field>
    <Field label={t('flowBundleUi.ref')} invalid={invalid('bundle-ref')}>{props => <Choice {...props} data-testid="flow-bundle-ref" value={ref} onValueChange={value => set({ ...params, ref: value })}>
      <ChoiceOption value="integration">integration</ChoiceOption><ChoiceOption value="main">main</ChoiceOption>
    </Choice>}</Field>
    <fieldset className="flex flex-wrap gap-3 rounded-lg border p-2"><legend className="px-1 text-xs font-medium">{t('flowBundleUi.scripts')}</legend>
      {bundleScriptsSchema.element.options.map(script => <label key={script} className="flex items-center gap-1 text-sm"><input type="checkbox" data-testid={`flow-bundle-script-${script}`} className="accent-primary" checked={scripts.data?.includes(script) ?? false}
        onChange={event => set({ ...params, scripts: bundleScriptsSchema.element.options.filter(item => item === script ? event.target.checked : scripts.data?.includes(item)) })} />{script}</label>)}
      {!scripts.success && <p role="alert" className="text-xs text-destructive">{t('flowsUi.validation.bundle-scripts')}</p>}
    </fieldset>
    {(placeholders.length > 0 || dynamic || pathEntries.length > 0) && <fieldset className="grid min-w-0 gap-2 rounded-lg border p-2"><legend className="px-1 text-xs font-medium">{t('flowBundleUi.path')}</legend>
      {[...new Set([...placeholders, ...pathEntries.map(([key]) => key)])].map((key, index) => {
        const fixed = placeholders.includes(key);
        const value = Object.hasOwn(params, key) ? params[key] : undefined;
        const suffix = `flow-bundle-path-${index}`;
        if (reserved.has(key)) return <p key={key} role="alert" className="text-xs text-destructive">{`{${key}}: ${t('flowBundleUi.pathReserved')}`}</p>;
        const schema = selectedOperation?.inputSchema;
        const property = schema?.type === 'object' && Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined;
        const valueType = property?.type === 'integer' ? 'number' : property?.type ?? (typeof value === 'number' || typeof value === 'boolean' ? typeof value : 'string');
        function change(next: string | number | boolean | undefined) {
          if (next !== undefined) set({ ...params, [key]: next });
          else set(Object.fromEntries(Object.entries(params).filter(entry => entry[0] !== key)));
        }
        return <div key={index} className="grid gap-1">
          {!fixed && <Field label={t('flowBundleUi.key')} invalid={!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? t('flowsUi.validation.bundle-path-param') : undefined}>{props => <Input {...props} data-testid={`${suffix}-key`} value={key} onChange={event => {
            const name = event.target.value;
            if (reserved.has(name) || Object.hasOwn(params, name)) return;
            set(Object.fromEntries(Object.entries(params).map(entry => entry[0] === key ? [name, value ?? ''] : entry)));
          }} />}</Field>}
          {!property && <Field label={t('flowsUi.field.valueType')}>{props => <Choice {...props} data-testid={`${suffix}-type`} value={valueType} onValueChange={type => change(type === 'boolean' ? false : type === 'number' ? 0 : typeof value === 'object' ? '' : String(value ?? ''))}>
            {(['string', 'number', 'boolean'] as const).map(type => <ChoiceOption key={type} value={type}>{t(`flowsUi.option.${type}`)}</ChoiceOption>)}
          </Choice>}</Field>}
          <Field label={fixed ? `{${key}}` : t('flowBundleUi.value')} invalid={fixed && (value === undefined || value === '' || value === '.' || value === '..') ? t('flowBundleUi.pathRequired') : invalid('bundle-path-param')}>{props => valueType === 'boolean'
            ? <Choice {...props} data-testid={suffix} value={value === true ? 'true' : value === false ? 'false' : ''} onValueChange={next => change(next ? next === 'true' : undefined)}>
              <ChoiceOption value="">{t('flowsUi.none')}</ChoiceOption><ChoiceOption value="true">{t('flowsUi.option.true')}</ChoiceOption><ChoiceOption value="false">{t('flowsUi.option.false')}</ChoiceOption>
            </Choice> : <Input {...props} data-testid={suffix} type={valueType === 'number' ? 'number' : 'text'} step={property?.type === 'integer' ? 1 : 'any'} maxLength={20000}
              value={typeof value === 'object' ? '' : String(value ?? '')} placeholder={valueType === 'string' ? '{{inputs.name}}' : undefined} onChange={event => {
                if (valueType !== 'number') change(event.target.value);
                else if (Number.isFinite(event.target.valueAsNumber)) change(event.target.valueAsNumber);
                else change(fixed ? undefined : 0);
              }} />}</Field>
          {!fixed && <Button type="button" size="sm" variant="ghost" data-testid={`${suffix}-remove`} onClick={() => set(Object.fromEntries(Object.entries(params).filter(entry => entry[0] !== key)))}>{t('flowsUi.remove')}</Button>}
        </div>;
      })}
      {dynamic && <Button type="button" size="sm" variant="outline" data-testid="flow-bundle-path-add" disabled={pathEntries.length >= 14} onClick={() => set({ ...params, [nextKey(params, 'param')]: '' })}>{t('flowBundleUi.pathAdd')}</Button>}
    </fieldset>}
    <fieldset className="grid min-w-0 gap-2 rounded-lg border p-2"><legend className="px-1 text-xs font-medium">{t('flowBundleUi.query')}</legend>
      <p className="text-xs text-muted-foreground">{t('flowBundleUi.queryHelp')}</p>
      {queryEntries.map(([key, value], index) => <div className="grid gap-1 border-b pb-2" key={index}>
        <Field label={t('flowBundleUi.key')} invalid={!key ? t('flowsUi.validation.bundle-query') : undefined}>{props => <Input {...props} data-testid={`flow-bundle-query-key-${index}`} maxLength={200} value={key} onChange={event => {
          const name = event.target.value;
          if (Object.hasOwn(query, name)) return;
          set({ ...params, query: Object.fromEntries(queryEntries.map(entry => entry[0] === key ? [name, value] : entry)) });
        }} />}</Field>
        <Field label={t('flowBundleUi.value')} invalid={invalid('bundle-query')}>{props => <Input {...props} data-testid={`flow-bundle-query-value-${index}`} maxLength={20000} value={value} onChange={event => set({ ...params, query: { ...query, [key]: event.target.value } })} />}</Field>
        <Button type="button" size="sm" variant="ghost" data-testid={`flow-bundle-query-remove-${index}`} onClick={() => set({ ...params, query: Object.fromEntries(queryEntries.filter(entry => entry[0] !== key)) })}>{t('flowsUi.remove')}</Button>
      </div>)}
      <Button type="button" size="sm" variant="outline" data-testid="flow-bundle-query-add" disabled={queryEntries.length >= 10} onClick={() => set({ ...params, query: { ...query, [nextKey(query, 'key')]: '' } })}>{t('flowBundleUi.queryAdd')}</Button>
    </fieldset>
  </div>;
}
