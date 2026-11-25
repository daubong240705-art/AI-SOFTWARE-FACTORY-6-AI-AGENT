import { Choice, ChoiceOption } from '@/components/ui/choice';
import { useMemo } from 'react';
import { FLOW_NODE_PORTS, jsonSubsetSchema, type FlowDefinition, type FlowNode, type ProjectAgentsResponse } from '@factory/contracts';
import type { FlowIssue } from '@/api/flowModels';
import type { ApiClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { extra } from '@/i18n/extra.en';
import { AgentField, ConditionFields, EnumField, MappingField, NumField, SelectorList, StringsField, TextField, Toggle, defaultCondition, initialSelector, pathsFor } from './FlowFields';
import { Field, flowNodeTitle, JsonField, PortLabel, useFlowLabels } from './shared';
import type { Selection } from './FlowCanvas';
import { actionKinds, actionLabel, bundleDefaults, unsupported, unsupportedAction } from './nodeTypes';
import { HttpActionFields } from './HttpActionFields';
import { BundleActionFields } from './BundleActionFields';

function CommonFields({ node, set }: { node: FlowNode; set: (patch: Partial<FlowNode>) => void }) {
  const label = useFlowLabels();
  return <div className="grid gap-3">
    <TextField name="title" value={node.title} set={title => set({ title })} />
    <EnumField name="onError" value={node.onError} options={['fail', 'continue', 'port']} set={onError => set({ onError })} />
    <NumField name="timeoutMinutes" value={node.timeoutMinutes} optional set={timeoutMinutes => set({ timeoutMinutes })} />
    <fieldset className="grid gap-2 rounded-lg border p-2"><legend className="px-1 text-xs font-medium">{label('retry')}</legend>
      <NumField name="maxRetries" value={node.retry?.max} optional set={max => set({ retry: max === undefined ? undefined : { max, backoffSeconds: node.retry?.backoffSeconds ?? 1 } })} />
      <NumField name="backoffSeconds" value={node.retry?.backoffSeconds} optional set={backoffSeconds => set({ retry: backoffSeconds === undefined ? undefined : { max: node.retry?.max ?? 0, backoffSeconds } })} />
    </fieldset>
  </div>;
}

export function NodeInspector({ api, projectId, node, definition, roster, setNode }: { api: ApiClient; projectId: string; node: FlowNode; definition: FlowDefinition; roster?: ProjectAgentsResponse | undefined; setNode: (node: FlowNode) => void }) {
  const label = useFlowLabels();
  const paths = useMemo(() => pathsFor(definition), [definition]);
  const set = (patch: Partial<FlowNode>) => setNode({ ...node, ...patch } as FlowNode);
  return <div className="grid gap-4">
    <CommonFields node={node} set={set} />
    {unsupported(node) && <p className="rounded-md border border-destructive/40 p-2 text-xs text-destructive">{label('unsupportedNode')}</p>}
    {node.type === 'trigger' && <>
      <EnumField name="triggerKind" value={node.trigger.kind} options={['manual', 'chat', 'schedule', 'webhook', 'event', 'api']} set={kind => set({ trigger: kind === 'schedule' ? { kind, cron: '* * * * *' } : kind === 'event' ? { kind, event: 'task.created' } : { kind } })} />
      {node.trigger.kind === 'schedule' && <>
        <TextField name="cron" value={node.trigger.cron} set={cron => { if (node.trigger.kind === 'schedule') set({ trigger: { ...node.trigger, cron } }); }} />
        <TextField name="timezone" value={node.trigger.timezone ?? ''} set={timezone => { if (node.trigger.kind === 'schedule') set({ trigger: { ...node.trigger, timezone: timezone || undefined } }); }} />
      </>}
      {node.trigger.kind === 'event' && <EnumField name="event" value={node.trigger.event} options={['task.created', 'task.done', 'artifact.approved', 'run.completed']} set={event => set({ trigger: { kind: 'event', event } })} />}
    </>}
    {node.type === 'agent' && <><AgentField name="agent" selector={node.agent} roster={roster} set={agent => set({ agent })} />
      <TextField name="taskTitle" value={node.task.title} template suggestions={paths} set={title => set({ task: { ...node.task, title } })} />
      <TextField name="instructions" value={node.task.instructions} multi template suggestions={paths} set={instructions => set({ task: { ...node.task, instructions } })} />
      <StringsField name="acceptance" values={node.task.acceptance} set={acceptance => set({ task: { ...node.task, acceptance: acceptance.slice(0, 8) } })} />
      <StringsField name="inputs" values={node.task.inputs} suggestions={paths} set={inputs => set({ task: { ...node.task, inputs: inputs.slice(0, 8) } })} />
      <EnumField name="review" value={typeof node.review === 'string' ? node.review : 'agent'} options={['none', 'human', 'agent']} set={review => set({ review: review === 'agent' ? { agent: initialSelector('agent', roster) } : review })} />
      {typeof node.review !== 'string' && <AgentField name="review" selector={node.review.agent} roster={roster} set={agent => set({ review: { agent } })} />}
      <Toggle name={label('field.outputSchema')} checked={!!node.outputSchema} set={enabled => set({ outputSchema: enabled ? { type: 'object', properties: {} } : undefined })} />
      {node.outputSchema && <JsonField title={label('field.outputSchema')} value={node.outputSchema} parse={raw => jsonSubsetSchema.parse(raw)} onChange={outputSchema => set({ outputSchema })} />}
    </>}
    {node.type === 'action' && <><Field label={label('field.action')}>{props => <Choice {...props} value={node.action} onValueChange={selectedValue => {
      const action = selectedValue as typeof node.action;
      if (action === node.action) return;
      const params = action === 'bundle.publish' ? bundleDefaults : node.action === 'bundle.publish' ? {} :
        Object.fromEntries(Object.entries(node.params).filter(([key, value]) => typeof value !== 'object' &&
          (action !== 'http.request' || ['integration', 'operation', 'args'].includes(key))));
      set({ action, params });
    }}>
      {actionKinds.map(kind => <ChoiceOption key={kind} value={kind}>{actionLabel(kind)}{unsupportedAction(kind) ? ` (${label('unsupportedNode')})` : ''}</ChoiceOption>)}</Choice>}</Field>
      {node.action === 'http.request' ? <HttpActionFields api={api} projectId={projectId} params={node.params} paths={paths} set={params => set({ params })} />
        : node.action === 'bundle.publish' ? <BundleActionFields api={api} projectId={projectId} params={node.params} inputs={definition.inputs} set={params => set({ params })} />
          : <MappingField name="params" value={Object.fromEntries(Object.entries(node.params).filter((entry): entry is [string, string | number | boolean] => typeof entry[1] !== 'object'))} paths={paths} scalar set={params => set({ params })} />}</>}
    {node.type === 'condition' && <div className="grid gap-3">{node.rules.map((rule, index) => <fieldset key={index} className="grid gap-2 rounded-lg border p-2"><legend className="px-1 text-xs">{label('rule')} {index + 1}</legend>
      <ConditionFields value={rule.when} paths={paths} set={when => set({ rules: node.rules.map((item, at) => at === index ? { ...item, when } : item) })} />
      <TextField name="port" value={rule.port} set={port => set({ rules: node.rules.map((item, at) => at === index ? { ...item, port } : item) })} />
      {node.rules.length > 1 && <Button type="button" size="sm" variant="ghost" onClick={() => set({ rules: node.rules.filter((_, at) => at !== index) })}>{label('remove')}</Button>}
    </fieldset>)}<Button type="button" size="sm" variant="outline" disabled={node.rules.length >= 10} onClick={() => {
      let suffix = node.rules.length + 1;
      while (node.rules.some(rule => rule.port === `match-${suffix}`)) suffix++;
      set({ rules: [...node.rules, { when: defaultCondition, port: `match-${suffix}` }] });
    }}>{label('addRule')}</Button></div>}
    {node.type === 'parallel' && <><TextField name="forEach" value={node.forEach} suggestions={paths} set={forEach => set({ forEach })} /><NumField name="maxConcurrency" value={node.maxConcurrency} set={maxConcurrency => set({ maxConcurrency: maxConcurrency ?? 1 })} /></>}
    {node.type === 'join' && <><EnumField name="policy" value={typeof node.policy === 'string' ? node.policy : 'quorum'} options={['all', 'any', 'quorum']} set={policy => set({ policy: policy === 'quorum' ? { quorum: 1 } : policy })} />{typeof node.policy !== 'string' && <NumField name="quorum" value={node.policy.quorum} set={quorum => set({ policy: { quorum: quorum ?? 1 } })} />}<EnumField name="merge" value={node.merge} options={['list', 'object']} set={merge => set({ merge })} /></>}
    {node.type === 'approval' && <><EnumField name="approverType" value={typeof node.approver === 'string' ? node.approver : 'agent'} options={['operator', 'relation:approves', 'agent']} set={kind => set({ approver: kind === 'agent' ? { agent: initialSelector('agent', roster) } : kind })} />{typeof node.approver !== 'string' && <AgentField name="approver" selector={node.approver.agent} roster={roster} set={agent => set({ approver: { agent } })} />}<TextField name="prompt" value={node.prompt} multi template suggestions={paths} set={prompt => set({ prompt })} /></>}
    {node.type === 'loop' && <><NumField name="maxIterations" value={node.maxIterations} set={maxIterations => set({ maxIterations: maxIterations ?? 1 })} />{node.until && <ConditionFields value={node.until} paths={paths} set={until => set({ until })} />}<Button type="button" size="sm" variant="outline" onClick={() => set({ until: node.until ? undefined : { path: 'inputs', op: 'eq', value: '' } })}>{node.until ? label('removeCondition') : label('addCondition')}</Button></>}
    {node.type === 'wait' && <><EnumField name="waitType" value={'for' in node.wait ? 'for' : 'until' in node.wait ? 'until' : 'event'} options={['for', 'until', 'event']} set={kind => set({ wait: kind === 'for' ? { for: 1 } : kind === 'until' ? { until: new Date().toISOString() } : { event: 'task.done' } })} />{'for' in node.wait && <NumField name="minutes" value={node.wait.for} set={value => set({ wait: { for: value ?? 1 } })} />}{'until' in node.wait && <TextField name="until" value={node.wait.until} set={until => set({ wait: { until } })} />}{'event' in node.wait && <TextField name="event" value={node.wait.event} set={event => set({ wait: { event } })} />}</>}
    {node.type === 'subflow' && <><TextField name="workflow" value={node.workflow} set={workflow => set({ workflow })} />
      <EnumField name="version" value={node.version === 'published' ? 'published' : 'specific'} options={['published', 'specific']} set={mode => set({ version: mode === 'published' ? 'published' : 1 })} />
      {typeof node.version === 'number' && <NumField name="version" value={node.version} set={version => set({ version: version ?? 1 })} />}
      <MappingField name="inputs" value={node.inputs} paths={paths} set={inputs => set({ inputs: Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, String(value)])) })} /></>}
    {node.type === 'orchestrate' && <><AgentField name="lead" selector={node.lead} roster={roster} set={lead => set({ lead })} /><TextField name="goal" value={node.goal} multi template suggestions={paths} set={goal => set({ goal })} /><SelectorList selectors={node.allowed} roster={roster} set={allowed => set({ allowed })} /><NumField name="maxTasks" value={node.maxTasks} set={maxTasks => set({ maxTasks: maxTasks ?? 1 })} /><NumField name="maxDepth" value={node.maxDepth} set={maxDepth => set({ maxDepth: maxDepth ?? 1 })} /><NumField name="budgetTokens" value={node.budgetTokens} optional set={budgetTokens => set({ budgetTokens })} /></>}
    {node.type === 'output' && <><EnumField name="target" value={node.target} options={['artifact', 'knowledge', 'deliver']} set={target => set({ target })} /><StringsField name="from" values={node.from} suggestions={paths} set={from => set({ from })} /></>}
    <p className="flex flex-wrap gap-1 text-xs text-muted-foreground">{label('ports')}: {FLOW_NODE_PORTS(node).length ? FLOW_NODE_PORTS(node).map(port => <PortLabel key={port} port={port} />) : label('none')}</p>
  </div>;
}

export function FlowSettings({ definition, setDefinition }: { definition: FlowDefinition; setDefinition: (definition: FlowDefinition) => void }) {
  const label = useFlowLabels();
  return <div className="grid gap-3">
    <TextField name="title" value={definition.title} set={title => setDefinition({ ...definition, title })} />
    <TextField name="description" value={definition.description} multi set={description => setDefinition({ ...definition, description })} />
    <TextField name="key" value={definition.key} set={key => setDefinition({ ...definition, key })} />
    <NumField name="maxDurationMinutes" value={definition.settings.maxDurationMinutes} optional set={value => setDefinition({ ...definition, settings: { ...definition.settings, maxDurationMinutes: value } })} />
    <NumField name="stallAfterMinutes" value={definition.settings.stallAfterMinutes} optional set={value => setDefinition({ ...definition, settings: { ...definition.settings, stallAfterMinutes: value } })} />
    <NumField name="budgetTokens" value={definition.settings.budgetTokens} optional set={value => setDefinition({ ...definition, settings: { ...definition.settings, budgetTokens: value } })} />
    <EnumField name="concurrency" value={definition.settings.concurrency} options={['allow', 'queue', 'skip']} set={concurrency => setDefinition({ ...definition, settings: { ...definition.settings, concurrency } })} />
    <TextField name="errorWorkflow" value={definition.settings.errorWorkflow ?? ''} set={errorWorkflow => setDefinition({ ...definition, settings: { ...definition.settings, ...(errorWorkflow ? { errorWorkflow } : { errorWorkflow: undefined }) } })} />
    <fieldset className="grid gap-2 rounded-lg border p-2"><legend className="px-1 text-xs font-medium">{label('inputs')}</legend>{definition.inputs.map((input, index) => {
      const patch = (next: Partial<typeof input>) => setDefinition({ ...definition, inputs: definition.inputs.map((item, at) => at === index ? { ...item, ...next } : item) });
      return <div key={index} className="grid gap-2 rounded-md bg-muted/50 p-2">
        <TextField name="inputName" value={input.name} set={name => patch({ name })} />
        <EnumField name="inputType" value={input.type} options={['string', 'number', 'bool', 'enum', 'artifact']} set={type => patch({ type, default: undefined, values: type === 'enum' ? ['option'] : undefined })} />
        <Toggle name={label('required')} checked={input.required} set={required => patch({ required })} />
        {input.type === 'enum' && <StringsField name="values" values={input.values ?? []} set={values => patch({ values })} />}
        <Toggle name={label('useDefault')} checked={input.default !== undefined} set={enabled => patch({ default: enabled ? (input.type === 'bool' ? false : input.type === 'number' ? 0 : input.type === 'enum' ? input.values?.[0] ?? '' : '') : undefined })} />
        {input.default !== undefined && (input.type === 'bool' ? <Toggle name={label('field.default')} checked={input.default === true} set={value => patch({ default: value })} />
          : input.type === 'number' ? <NumField name="default" value={Number(input.default)} set={value => patch({ default: value ?? 0 })} />
            : <TextField name="default" value={String(input.default)} suggestions={input.values} set={value => patch({ default: value })} />)}
        <Button type="button" size="sm" variant="ghost" onClick={() => setDefinition({ ...definition, inputs: definition.inputs.filter((_, at) => at !== index) })}>{label('remove')}</Button>
      </div>;
    })}<Button type="button" size="sm" variant="outline" disabled={definition.inputs.length >= 20} onClick={() => {
      let suffix = definition.inputs.length + 1;
      while (definition.inputs.some(input => input.name === `input${suffix}`)) suffix++;
      setDefinition({ ...definition, inputs: [...definition.inputs, { name: `input${suffix}`, type: 'string', required: false }] });
    }}>{label('addInput')}</Button></fieldset>
  </div>;
}

export function IssueList({ definition, issues, onSelect }: { definition: FlowDefinition; issues: FlowIssue[]; onSelect: (selection: Selection) => void }) {
  const label = useFlowLabels();
  return <div className="grid gap-1">{issues.length === 0 ? <p className="text-sm text-emerald-600">{label('noIssues')}</p> : issues.map((issue, index) => {
    const edge = definition.edges.find(item => item.id === issue.edge);
    const node = definition.nodes.find(item => item.id === issue.node) ?? definition.nodes.find(item => item.id === edge?.from.node) ?? definition.nodes.find(item => item.id === edge?.to.node);
    const selection: Selection = issue.edge ? { kind: 'edge', id: issue.edge } : node ? { kind: 'node', id: node.id } : null;
    const code = Object.hasOwn(extra.flowsUi.validation, issue.code) ? issue.code : 'invalid';
    const key = `${issue.code}-${index}`;
    const text = <>{node && <span className="block font-semibold">{flowNodeTitle(node, label)}</span>}{label(`validation.${code}`)}</>;
    const style = 'rounded-md border border-destructive/40 p-2 text-left text-xs';
    return selection ? <button key={key} type="button" title={issue.message} className={`${style} hover:bg-destructive/10`} onClick={() => onSelect(selection)}>{text}</button>
      : <p key={key} title={issue.message} className={style}>{text}</p>;
  })}</div>;
}

export function EdgeInspector({ selection, definition, setDefinition }: { selection: string; definition: FlowDefinition; setDefinition: (definition: FlowDefinition) => void }) {
  const label = useFlowLabels();
  const edge = definition.edges.find(item => item.id === selection);
  if (!edge) return null;
  const from = definition.nodes.find(node => node.id === edge.from.node);
  const to = definition.nodes.find(node => node.id === edge.to.node);
  return <div className="grid gap-3"><p className="text-sm font-semibold">{label('edge')}</p><p className="break-words text-xs text-muted-foreground">{from ? flowNodeTitle(from, label) : label('missingNode')} · <PortLabel port={edge.from.port} /> → {to ? flowNodeTitle(to, label) : label('missingNode')}</p><label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={edge.loopBack} onChange={event => setDefinition({ ...definition, edges: definition.edges.map(item => item.id === edge.id ? { ...item, loopBack: event.target.checked } : item) })} />{label('loopBack')}</label></div>;
}
