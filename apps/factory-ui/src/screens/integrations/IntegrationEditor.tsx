import { Choice, ChoiceOption } from '@/components/ui/choice';
import { useState, type ComponentProps } from 'react';
import { httpOperationSchema, integrationSpecSchema, jsonSubsetSchema, sensitiveIntegrationName, type Credential, type GroupSummary, type Integration, type IntegrationSpec, type JsonSubset } from '@factory/contracts';
import { integrationsCreate, integrationsUpdate } from '@/api/commands';
import type { ApiClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AdminDialog, DialogButtons, Field } from '../agents/shared';
import { CredentialChoice, IntegrationError, RetryRead, ScopeChoice, useIntegrationLabels, useIntegrationWrite, visibleCredentials } from './shared';

type Value = { value: string } | { credential: string };
type ValueRow = { id: string; name: string; entry: Value };
type Operation = ReturnType<typeof httpOperationSchema.parse>;
type DraftOperation = Omit<Operation, 'inputSchema'> & { id: string; schema: SchemaDraft };
type SchemaField = { id: string; name: string; required: boolean; type: 'string' | 'number' | 'integer' | 'boolean' };
type SchemaDraft = { fields: SchemaField[] } | { json: string };
type Issue = { path: readonly PropertyKey[] };
type Invalid = (path: string) => string | undefined;
type PickerData = { credentials: readonly Credential[]; groups: readonly GroupSummary[] };
const kinds = ['mcp-stdio', 'mcp-http', 'http-api'] as const;
const scalarTypes = ['string', 'number', 'integer', 'boolean'] as const;
const rowId = () => crypto.randomUUID();
const initialOperation = (): DraftOperation => ({ id: rowId(), name: '', method: 'GET', path: '/', sideEffect: 'none', schema: { fields: [] } });
const valueRows = (entries: Record<string, Value> = {}): ValueRow[] => Object.entries(entries).map(([name, entry]) => ({ id: rowId(), name, entry }));

function schemaDraft(schema: JsonSubset): SchemaDraft {
  if (schema.type === 'object' && Object.entries(schema.properties).every(([, field]) => scalarTypes.some(type => type === field.type) && Object.keys(field).length === 1)
    && schema.required?.every(name => Object.hasOwn(schema.properties, name)) !== false) {
    return { fields: Object.entries(schema.properties).map(([name, field]) => ({ id: rowId(), name, required: schema.required?.includes(name) ?? false, type: field.type as SchemaField['type'] })) };
  }
  return { json: JSON.stringify(schema, null, 2) };
}

function inputSchema(draft: SchemaDraft): unknown {
  if ('json' in draft) { try { return JSON.parse(draft.json); } catch { return undefined; } }
  return { type: 'object', properties: Object.fromEntries(draft.fields.map(({ name, type }) => [name, { type }])), required: draft.fields.filter(field => field.required).map(field => field.name) };
}

function TextInput({ label, value, set, invalid, hint, ...input }: { label: string; value: string; set: (value: string) => void; invalid?: string | undefined; hint?: string | undefined } & Pick<ComponentProps<typeof Input>, 'maxLength' | 'required' | 'placeholder'>) {
  return <Field label={label} invalid={invalid} hint={hint}>{props => <Input {...props} {...input} value={value} onChange={event => set(event.target.value)} />}</Field>;
}

function Rows({ kind, rows, set, invalid, ...pickers }: PickerData & { kind: 'env' | 'headers'; rows: ValueRow[]; set: (rows: ValueRow[]) => void; invalid: Invalid }) {
  const t = useIntegrationLabels();
  return <fieldset className="grid gap-2"><legend className="mb-2 font-medium">{t(kind)}</legend>
    {rows.map((row, index) => {
      const change = (patch: Partial<ValueRow>) => set(rows.map(item => item.id === row.id ? { ...item, ...patch } : item));
      const isCredential = 'credential' in row.entry;
      return <div key={row.id} className="grid items-start gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto]">
        <TextInput label={`${t('key')} ${index + 1}`} value={row.name} maxLength={128} invalid={invalid(`config.${kind}.${row.name}`)} set={name => change({ name, ...(sensitiveIntegrationName(name) && !isCredential ? { entry: { credential: '' } } : {}) })} />
        <Field label={t('valueType')}>{props => <Choice {...props} value={isCredential ? 'credential' : 'plain'} onValueChange={selectedValue => change({ entry: selectedValue === 'credential' ? { credential: '' } : { value: '' } })}>
          <ChoiceOption value="plain" disabled={sensitiveIntegrationName(row.name)}>{t('plain')}</ChoiceOption><ChoiceOption value="credential">{t('credential')}</ChoiceOption>
        </Choice>}</Field>
        {isCredential ? <Field label={t('credential')}>{props => <CredentialChoice {...props} {...pickers} value={'credential' in row.entry ? row.entry.credential : ''} onChange={credential => change({ entry: { credential } })} />}</Field>
          : <TextInput label={t('plain')} value={'value' in row.entry ? row.entry.value : ''} maxLength={8192} hint={t('plainHelp')} set={value => change({ entry: { value } })} />}
        <Button type="button" variant="ghost" className="self-start sm:mt-5" aria-label={`${t('remove')} ${index + 1}`} onClick={() => set(rows.filter(item => item.id !== row.id))}>{t('remove')}</Button>
      </div>;
    })}
    {invalid(`config.${kind}`) && <p className="text-sm text-destructive">{invalid(`config.${kind}`)}</p>}
    <Button type="button" variant="outline" className="justify-self-start" disabled={rows.length >= 32} onClick={() => set([...rows, { id: rowId(), name: '', entry: { credential: '' } }])}>{t(kind === 'env' ? 'addEnv' : 'addHeader')}</Button>
  </fieldset>;
}

function OperationSchema({ schema, set, invalid }: { schema: SchemaDraft; set: (schema: SchemaDraft) => void; invalid?: string | undefined }) {
  const t = useIntegrationLabels();
  if ('json' in schema) return <Field label={t('schemaJson')} invalid={invalid} hint={t('schemaJsonHelp')}>{props => <Textarea {...props} className="font-mono" rows={5} value={schema.json} onChange={event => set({ json: event.target.value })} />}</Field>;
  return <fieldset className="grid gap-2"><legend className="mb-1 text-sm font-medium">{t('schema')}</legend>
    {schema.fields.map((field, index) => {
      const change = (patch: Partial<SchemaField>) => set({ fields: schema.fields.map(item => item.id === field.id ? { ...item, ...patch } : item) });
      return <div key={field.id} className="flex flex-wrap items-center gap-2">
        <Input className="min-w-28 flex-1" aria-label={`${t('fieldName')} ${index + 1}`} placeholder={t('fieldName')} value={field.name} onChange={event => change({ name: event.target.value })} />
        <Choice className="w-auto" aria-label={`${t('fieldType')} ${index + 1}`} value={field.type} onValueChange={selectedValue => change({ type: selectedValue as SchemaField['type'] })}>
          {scalarTypes.map(type => <ChoiceOption key={type} value={type}>{t(type)}</ChoiceOption>)}
        </Choice>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={field.required} onChange={event => change({ required: event.target.checked })} />{t('required')}</label>
        <Button type="button" variant="ghost" size="sm" aria-label={`${t('remove')} ${t('fieldName')} ${index + 1}`} onClick={() => set({ fields: schema.fields.filter(item => item.id !== field.id) })}>{t('remove')}</Button>
      </div>;
    })}
    {invalid && <p className="text-sm text-destructive">{invalid}</p>}
    <Button type="button" size="sm" variant="outline" className="justify-self-start" onClick={() => set({ fields: [...schema.fields, { id: rowId(), name: '', type: 'string', required: false }] })}>{t('addField')}</Button>
  </fieldset>;
}

function Operations({ operations, set, invalid }: { operations: DraftOperation[]; set: (operations: DraftOperation[]) => void; invalid: Invalid }) {
  const t = useIntegrationLabels();
  return <fieldset className="grid gap-3"><legend className="mb-2 font-medium">{t('operations')}</legend>
    {operations.map((operation, index) => {
      const prefix = `config.operations.${index}`;
      const change = (patch: Partial<DraftOperation>) => set(operations.map(item => item.id === operation.id ? { ...item, ...patch } : item));
      return <fieldset key={operation.id} className="grid gap-3 rounded-lg border p-3"><legend className="px-1 text-sm font-medium">{t('operation')} {index + 1}</legend>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1.3fr)]">
          <TextInput data-testid="connection-operation-name" label={t('name')} required value={operation.name} maxLength={64} hint={t('operationNameHelp')} invalid={invalid(`${prefix}.name`)} set={name => change({ name })} />
          <Field label={t('method')}>{props => <Choice {...props} value={operation.method} onValueChange={selectedValue => change({ method: selectedValue as Operation['method'] })}>{httpOperationSchema.shape.method.options.map(method => <ChoiceOption key={method} value={method}>{method}</ChoiceOption>)}</Choice>}</Field>
          <TextInput label={t('path')} required value={operation.path} maxLength={8192} hint={t('pathHelp')} invalid={invalid(`${prefix}.path`)} set={path => change({ path })} />
        </div>
        <OperationSchema schema={operation.schema} invalid={invalid(`${prefix}.inputSchema`)} set={schema => change({ schema })} />
        <Field label={t('sideEffect')} hint={operation.sideEffect === 'external' ? t('externalWarning') : undefined}>{props => <Choice {...props} value={operation.sideEffect} onValueChange={selectedValue => change({ sideEffect: selectedValue === 'external' ? 'external' : 'none' })}>
          <ChoiceOption value="none">{t('none')}</ChoiceOption><ChoiceOption value="external">{t('external')}</ChoiceOption>
        </Choice>}</Field>
        <Button type="button" variant="ghost" className="justify-self-start" disabled={operations.length === 1} onClick={() => set(operations.filter(item => item.id !== operation.id))}>{t('removeOperation')}</Button>
      </fieldset>;
    })}
    {invalid('config.operations') && <p className="text-sm text-destructive">{t('operationsInvalid')}</p>}
    <Button type="button" variant="outline" className="justify-self-start" disabled={operations.length >= 64} onClick={() => set([...operations, initialOperation()])}>{t('addOperation')}</Button>
  </fieldset>;
}

export function IntegrationEditor({ api, item, groupId, groups, credentials, credentialError, loadingCredentials, close, refresh }: PickerData & {
  api: ApiClient; item?: Integration | undefined; groupId?: string | undefined; credentialError?: Error | undefined; loadingCredentials: boolean; close: () => void; refresh: () => void;
}) {
  const t = useIntegrationLabels();
  const write = useIntegrationWrite();
  const [name, setName] = useState(item?.name ?? '');
  const [scope, setScope] = useState(groupId ?? item?.scopeGroupId ?? null);
  const [kind, setKind] = useState<IntegrationSpec['kind']>(item?.kind ?? 'mcp-stdio');
  const stdio = item?.kind === 'mcp-stdio' ? item.config : undefined;
  const mcp = item?.kind === 'mcp-http' ? item.config : undefined;
  const http = item?.kind === 'http-api' ? item.config : undefined;
  const [command, setCommand] = useState(stdio?.command ?? '');
  const [args, setArgs] = useState(() => (stdio?.args ?? []).map(value => ({ id: rowId(), value })));
  const [env, setEnv] = useState(() => valueRows(stdio?.env));
  const [url, setUrl] = useState(mcp?.url ?? '');
  const [headers, setHeaders] = useState(() => valueRows(mcp?.headers));
  const [baseUrl, setBaseUrl] = useState(http?.baseUrl ?? '');
  const originalAuth = http?.auth ?? 'none';
  const [auth, setAuth] = useState(originalAuth === 'none' ? 'none' : 'bearer' in originalAuth ? 'bearer' : 'header');
  const [credential, setCredential] = useState(originalAuth === 'none' ? '' : 'bearer' in originalAuth ? originalAuth.bearer : originalAuth.credential);
  const [header, setHeader] = useState(originalAuth !== 'none' && 'header' in originalAuth ? originalAuth.header : '');
  const [operations, setOperations] = useState(() => http?.operations.map(({ inputSchema: schema, ...op }) => ({ ...op, id: rowId(), schema: schemaDraft(schema) })) ?? [initialOperation()]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [revision, setRevision] = useState(item?.revision);
  const [reloaded, setReloaded] = useState(false);
  const pickers = { groups, credentials: visibleCredentials(credentials, groups, scope) };
  const invalid: Invalid = path => issues.some(issue => { const key = issue.path.join('.'); return key === path || key.startsWith(`${path}.`); }) ? t(`invalid.${path === 'name' ? 'name' : path.endsWith('.path') ? 'path' : path === 'config.url' || path === 'config.baseUrl' ? 'url' : 'field'}`) : undefined;
  function submit() {
    const failures: Issue[] = [];
    const common = { name: name.trim(), scopeGroupId: scope };
    function entries(rows: ValueRow[], field: 'env' | 'headers') {
      const names = rows.map(row => field === 'headers' ? row.name.toLowerCase() : row.name);
      if (names.includes('') || new Set(names).size !== names.length) failures.push({ path: ['config', field] });
      return Object.fromEntries(rows.map(({ name: key, entry }) => [key, entry]));
    }
    const config = kind === 'mcp-stdio' ? { command, args: args.map(arg => arg.value), env: entries(env, 'env') }
      : kind === 'mcp-http' ? { url: url.trim(), headers: entries(headers, 'headers') }
      : { baseUrl: baseUrl.trim(), auth: auth === 'none' ? 'none' : auth === 'bearer' ? { bearer: credential } : { header, credential },
        operations: operations.map(({ id: _, schema, ...operation }, index) => {
          const parsed = inputSchema(schema);
          if ('fields' in schema) {
            const names = schema.fields.map(field => field.name);
            if (names.some(key => !key.trim()) || new Set(names).size !== names.length) failures.push({ path: ['config', 'operations', index, 'inputSchema'] });
          }
          if (!jsonSubsetSchema.safeParse(parsed).success) failures.push({ path: ['config', 'operations', index, 'inputSchema'] });
          return { ...operation, inputSchema: parsed };
        }) };
    const parsed = integrationSpecSchema.safeParse({ ...common, kind, config });
    if (!parsed.success || failures.length) { setIssues([...failures, ...(parsed.success ? [] : parsed.error.issues)]); return; }
    setIssues([]);
    const spec = parsed.data;
    setReloaded(false);
    void write.run(() => api.sendIntegrationCommand(item && revision !== undefined ? integrationsUpdate({ ...spec, id: item.id, expectedRevision: revision }) : integrationsCreate(spec)), () => { refresh(); close(); });
  }
  return <AdminDialog wide title={t(item ? 'editIntegration' : 'createIntegration')} description={t('integrationFormHelp')} close={close} busy={write.busy} onSubmit={submit}
    footer={<DialogButtons close={close} label={t('save')} busy={write.busy} disabled={write.conflict} /> }>
    <div className="grid gap-3 sm:grid-cols-2">
      <TextInput data-testid="connection-name" label={t('name')} value={name} maxLength={30} required set={setName} hint={t('nameHelp')} invalid={invalid('name')} />
      <ScopeChoice groups={groups} value={scope} set={setScope} fixed={!!groupId} />
    </div>
    <Field label={t('kind')}>{props => <Choice data-testid="connection-kind" {...props} value={kind} onValueChange={selectedValue => setKind(selectedValue as IntegrationSpec['kind'])}>{kinds.map(value => <ChoiceOption key={value} value={value}>{t(value)}</ChoiceOption>)}</Choice>}</Field>
    <RetryRead error={credentialError} loading={loadingCredentials} retry={refresh} />
    {kind === 'mcp-stdio' && <>
      <TextInput label={t('command')} value={command} set={setCommand} required maxLength={8192} invalid={invalid('config.command')} />
      <fieldset className="grid gap-2"><legend className="mb-1 font-medium">{t('argsList')}</legend>
        <p className="text-xs text-muted-foreground">{t('argsListHelp')}</p>
        {args.map((arg, index) => <div key={arg.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
          <TextInput label={`${t('argument')} ${index + 1}`} value={arg.value} maxLength={8192} invalid={invalid(`config.args.${index}`)} set={value => setArgs(args.map(entry => entry.id === arg.id ? { ...entry, value } : entry))} />
          <Button type="button" variant="ghost" className="mt-5" aria-label={`${t('remove')} ${t('argument')} ${index + 1}`} onClick={() => setArgs(args.filter(entry => entry.id !== arg.id))}>{t('remove')}</Button>
        </div>)}
        <Button type="button" variant="outline" className="justify-self-start" disabled={args.length >= 64} onClick={() => setArgs([...args, { id: rowId(), value: '' }])}>{t('addArgument')}</Button>
      </fieldset>
      <Rows kind="env" rows={env} set={setEnv} invalid={invalid} {...pickers} />
    </>}
    {kind === 'mcp-http' && <>
      <TextInput label={t('url')} value={url} set={setUrl} required maxLength={8192} hint={t('urlHelp')} invalid={invalid('config.url')} />
      <Rows kind="headers" rows={headers} set={setHeaders} invalid={invalid} {...pickers} />
    </>}
    {kind === 'http-api' && <>
      <TextInput data-testid="connection-base-url" label={t('baseUrl')} value={baseUrl} set={setBaseUrl} required maxLength={8192} hint={t('urlHelp')} invalid={invalid('config.baseUrl')} />
      <Field label={t('auth')} invalid={invalid('config.auth')}>{props => <Choice {...props} value={auth} onValueChange={selectedValue => setAuth(selectedValue === 'bearer' ? 'bearer' : selectedValue === 'header' ? 'header' : 'none')}>
        <ChoiceOption value="none">{t('none')}</ChoiceOption><ChoiceOption value="bearer">{t('bearer')}</ChoiceOption><ChoiceOption value="header">{t('authHeader')}</ChoiceOption>
      </Choice>}</Field>
      {auth === 'header' && <TextInput label={t('headerName')} value={header} set={setHeader} required maxLength={128} />}
      {auth !== 'none' && <Field label={t('credential')}>{props => <CredentialChoice {...props} {...pickers} value={credential} onChange={setCredential} />}</Field>}
      <Operations operations={operations} set={setOperations} invalid={invalid} />
    </>}
    {issues.length > 0 && <p role="alert" className="text-sm text-destructive">{t('invalidForm')}</p>}
    <IntegrationError error={write.error} />
    {item && write.conflict && <Button type="button" variant="outline" disabled={write.busy} onClick={() => void write.run(() => api.getIntegration(item.id).then(({ integration }) => setRevision(integration.revision)), () => { setReloaded(true); refresh(); }, 'reloaded')}>{t('reloadRevision')}</Button>}
    {reloaded && <p role="status" className="text-sm text-muted-foreground">{t('reviewDraft')}</p>}
  </AdminDialog>;
}
