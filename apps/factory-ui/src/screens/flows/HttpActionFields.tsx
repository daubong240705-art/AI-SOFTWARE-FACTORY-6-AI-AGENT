import { Choice, ChoiceOption } from '@/components/ui/choice';
import { useContext, useEffect, useRef } from 'react';
import type { FlowNode } from '@factory/contracts';
import type { ApiClient } from '@/api/client';
import { Textarea } from '@/components/ui/textarea';
import { RetryRead, useIntegrationLabels, useProjectIntegrations } from '../integrations/shared';
import { Field, PendingJson, useFlowLabels } from './shared';

type Params = Extract<FlowNode, { type: 'action' }>['params'];

export function HttpActionFields({ api, projectId, params, paths, set }: { api: ApiClient; projectId: string; params: Params; paths: string[]; set: (params: Params) => void }) {
  const t = useIntegrationLabels();
  const flow = useFlowLabels();
  const input = useRef<HTMLTextAreaElement>(null);
  const setPending = useContext(PendingJson);
  const result = useProjectIntegrations(api, projectId);
  const options = result.data?.filter(item => item.kind === 'http-api') ?? [];
  const current = String(params.integration ?? '');
  const selected = options.find(item => item.name === current || item.id === current);
  const operation = String(params.operation ?? '');
  const selectedOperation = selected?.config.operations.find(item => item.name === operation);
  const args = String(params.args ?? '');
  let invalid = false;
  if (args && !/^\s*\{\{\s*[^{}\s]+\s*\}\}\s*$/.test(args)) {
    try { const parsed: unknown = JSON.parse(args); invalid = !parsed || typeof parsed !== 'object' || Array.isArray(parsed); } catch { invalid = true; }
  }
  useEffect(() => {
    if (!invalid || !setPending) return;
    setPending(count => count + 1);
    return () => setPending(count => Math.max(0, count - 1));
  }, [invalid, setPending]);
  return <div className="grid gap-3">
    <RetryRead error={result.error} loading={result.loading} retry={result.refresh} />
    {result.data && !options.length && <p className="text-sm text-muted-foreground">{t('noHttpConnections')}</p>}
    <Field label={t('connection')}>{props => <Choice {...props} value={selected?.name ?? current} onValueChange={selectedValue => set({ ...params, integration: selectedValue, operation: '' })}>
      <ChoiceOption value="">{t('selectConnection')}</ChoiceOption>
      {current && !selected && <ChoiceOption value={current}>{current} ({t('unavailable')})</ChoiceOption>}
      {options.map(item => <ChoiceOption key={item.id} value={item.name}>{item.name}</ChoiceOption>)}
    </Choice>}</Field>
    <Field label={t('operation')} hint={selectedOperation?.sideEffect === 'external' ? t('externalWarning') : undefined}>{props => <Choice {...props} disabled={!selected} value={operation} onValueChange={selectedValue => set({ ...params, operation: selectedValue })}>
      <ChoiceOption value="">{t('selectOperation')}</ChoiceOption>
      {operation && !selectedOperation && <ChoiceOption value={operation}>{operation} ({t('unavailable')})</ChoiceOption>}
      {selected?.config.operations.map(item => <ChoiceOption key={item.name} value={item.name}>{item.name} · {item.method} {item.path}</ChoiceOption>)}
    </Choice>}</Field>
    <Field label={t('httpArgs')} hint={t('httpArgsHelp')} invalid={invalid ? t('invalidArgs') : undefined}>{props => <Textarea {...props} ref={input} className="font-mono" rows={4} maxLength={20000} value={args} placeholder="{}" onChange={event => {
      const { args: _, ...rest } = params;
      set(event.target.value ? { ...rest, args: event.target.value } : rest);
    }} />}</Field>
    {paths.length > 0 && <Choice aria-label={flow('insertPath')} value="" onValueChange={selectedValue => {
      if (!selectedValue) return;
      const start = input.current?.selectionStart ?? args.length;
      const end = input.current?.selectionEnd ?? start;
      set({ ...params, args: `${args.slice(0, start)}{{ ${selectedValue} }}${args.slice(end)}` });
    }}>
      <ChoiceOption value="">{flow('insertPath')}</ChoiceOption>{paths.map(path => <ChoiceOption key={path} value={path}>{path}</ChoiceOption>)}
    </Choice>}
  </div>;
}
