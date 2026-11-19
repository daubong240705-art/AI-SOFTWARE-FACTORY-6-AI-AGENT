import { useEffect, useState } from 'react';
import { agentAdapterSchema, agentConfigSchema, agentTagSchema, type AgentConfig, type AgentConfigInput, type AgentDetail } from '@factory/contracts';
import type { ApiClient } from '@/api/client';
import type { AgentLibrary } from '@/api/agentModels';
import { agentsCreate, agentsRollback, agentsUpdate } from '@/api/commands';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { AgentHistory } from './AgentHistory';
import { AdminDialog, Choice, DialogButtons, ErrorText, Field, useAgentLabels, useWriteFeedback, type Submit } from './shared';
import { AgentCapabilities } from './AgentCapabilities';

const blank: AgentConfig = { name: '', role: '', description: '', goals: [], instructions: '', workRules: [], tags: [], runtime: { adapter: 'fake', model: null, effort: null, permission: 'workspace-write', maxConcurrent: 1, timeoutMinutes: 60 }, skills: [], tools: null, delegation: { canAssign: 'none', canProposeAgents: false, maxDepth: 1, maxOpenSubtasks: 5 }, autonomy: null, budget: {} };
const tabs = ['profile', 'runtime', 'capabilities', 'collaboration', 'history'] as const;
type Tab = typeof tabs[number];
const tabFor = (path: string): Tab => path.startsWith('runtime') ? 'runtime' : /^(skills|tools)/.test(path) ? 'capabilities' : /^(delegation|budget|autonomy)/.test(path) ? 'collaboration' : 'profile';

export function AgentEditor({ api, projectId, detail, library, initial, template, close, submit, refresh, loading, readError }: {
  api: ApiClient; projectId: string; detail?: AgentDetail; library?: AgentLibrary; initial?: AgentConfig;
  template?: { id: string; revision: number; link: boolean }; close: () => void; submit: Submit; refresh: () => void; loading?: boolean; readError?: Error | undefined;
}) {
  const t = useAgentLabels();
  const [draft, setDraft] = useState({ config: detail?.config ?? initial ?? blank, revision: detail?.revision });
  const { config } = draft;
  const [tab, setTab] = useState<Tab>('profile');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [awaiting, setAwaiting] = useState<AgentDetail | null>(null);
  const writer = useWriteFeedback(submit);
  const stale = !!detail && detail.revision !== draft.revision;
  useEffect(() => {
    if (awaiting && detail && detail !== awaiting && !loading) {
      setDraft({ config: detail.config, revision: detail.revision });
      setNote(''); setErrors([]); setAwaiting(null);
    }
  }, [awaiting, detail, loading]);
  const reset = () => {
    if (!detail) return;
    setDraft({ config: detail.config, revision: detail.revision });
    setErrors([]); setNote(''); setAwaiting(null); writer.setError(null);
  };
  const invalid = (path: string) => errors.some(issue => issue === path || issue.startsWith(`${path}.`)) ? t('invalid') : undefined;
  const afterWrite = () => { if (detail) setAwaiting(detail); else close(); };
  const save = () => {
    if (stale || loading || awaiting || config.runtime.adapter === 'api-agent' || tab === 'history') return;
    const input: AgentConfigInput = { ...config, runtime: { ...config.runtime, model: config.runtime.model?.trim() || null } };
    const parsed = agentConfigSchema.safeParse(input);
    if (!parsed.success) {
      const paths = parsed.error.issues.map(issue => issue.path.join('.'));
      setErrors(paths); setTab(tabFor(paths[0] ?? '')); return;
    }
    setErrors([]);
    void writer.run(() => detail ? agentsUpdate({ projectId, agentId: detail.id, expectedRevision: draft.revision!, config: parsed.data, ...(note.trim() ? { note: note.trim() } : {}) }) : agentsCreate({ projectId, config: parsed.data, teamIds: [], isLead: false, ...(template ? { template } : {}) }), afterWrite);
  };
  const blocked = writer.busy || !!loading || stale || !!awaiting;
  const rollback = (revision: number) => { if (detail && !blocked) void writer.run(() => agentsRollback({ projectId, agentId: detail.id, expectedRevision: draft.revision!, toRevision: revision }), afterWrite); };
  const set = <T extends keyof AgentConfig>(key: T, value: AgentConfig[T]) => setDraft(previous => ({ ...previous, config: { ...previous.config, [key]: value } }));
  return <AdminDialog wide title={detail ? `${t('edit')}: ${detail.name}` : t('create')} description={t('editorHelp')} close={close} busy={writer.busy} onSubmit={save} footer={<DialogButtons close={close} label={t('save')} busy={writer.busy} disabled={blocked || config.runtime.adapter === 'api-agent' || tab === 'history'} />}>
    <ErrorText error={writer.error} />
    <ErrorText error={readError} />
    {(stale || awaiting || readError) && <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
      {stale && !awaiting && t('errors.conflict')}
      <Button type="button" variant="outline" size="sm" disabled={loading && !readError} onClick={stale && !readError ? reset : refresh}>{t('reload')}</Button>
    </div>}
    {!!errors.length && <p role="alert" className="text-sm text-destructive">{t('invalidForm')}</p>}
    <fieldset disabled={writer.busy || !!awaiting}>
    <Tabs value={tab} onValueChange={value => setTab(value as Tab)}>
    <TabsList aria-label={t('editorHelp')} className="grid h-auto w-full grid-cols-2 gap-1 bg-muted/50 p-1 sm:grid-cols-5">{tabs.filter(item => item !== 'history' || detail).map(item => <TabsTrigger key={item} value={item}>{t(`tabs.${item}`)}</TabsTrigger>)}</TabsList>
    <TabsContent value="profile" className="grid gap-4 sm:grid-cols-2">
      <Field label={t('fields.name')} invalid={invalid('name')}>{props => <Input {...props} value={config.name} onChange={event => set('name', event.target.value)} maxLength={80} />}</Field>
      <Field label={t('fields.role')} invalid={invalid('role')}>{props => <Input {...props} value={config.role} onChange={event => set('role', event.target.value)} maxLength={160} />}</Field>
      <div className="sm:col-span-2"><Field label={t('fields.description')} invalid={invalid('description')}>{props => <Textarea {...props} value={config.description} onChange={event => set('description', event.target.value)} maxLength={2000} />}</Field></div>
      <StringList key={`goals:${draft.revision}`} field="goals" values={config.goals} limit={12} set={values => set('goals', values)} invalid={invalid('goals')} />
      <div className="sm:col-span-2"><Field label={t('fields.instructions')} invalid={invalid('instructions')} hint={`${config.instructions.length.toLocaleString()} / 65,536`}>{props => <Textarea {...props} className="min-h-36 font-mono text-xs" value={config.instructions} onChange={event => set('instructions', event.target.value)} maxLength={65536} />}</Field></div>
      <StringList key={`rules:${draft.revision}`} field="workRules" values={config.workRules} limit={20} set={values => set('workRules', values)} invalid={invalid('workRules')} />
      <StringList key={`tags:${draft.revision}`} field="tags" values={config.tags} limit={16} set={values => set('tags', values)} invalid={invalid('tags')} />
    </TabsContent>
    <TabsContent value="runtime" className="grid gap-4 sm:grid-cols-2">
      <Field label={t('fields.adapter')} invalid={invalid('runtime.adapter')} hint={t('futureAdapter')}>{props => <Choice {...props} value={config.runtime.adapter} onChange={event => set('runtime', { ...config.runtime, adapter: agentAdapterSchema.parse(event.target.value) })}>{agentAdapterSchema.options.map(adapter => <option key={adapter} value={adapter} disabled={adapter === 'api-agent'}>{adapter === 'api-agent' ? t('futureAdapter') : adapter}</option>)}</Choice>}</Field>
      <Field label={t('fields.model')} invalid={invalid('runtime.model')} hint={t('default')}>{props => <Input {...props} value={config.runtime.model ?? ''} onChange={event => set('runtime', { ...config.runtime, model: event.target.value || null })} maxLength={256} />}</Field>
      <Field label={t('fields.effort')}>{props => <Choice {...props} value={config.runtime.effort ?? ''} onChange={event => set('runtime', { ...config.runtime, effort: (event.target.value || null) as AgentConfig['runtime']['effort'] })}><option value="">{t('default')}</option>{(['low', 'medium', 'high', 'xhigh'] as const).map(value => <option key={value} value={value}>{t(`effort.${value}`)}</option>)}</Choice>}</Field>
      <Field label={t('fields.permission')} hint={config.runtime.permission === 'autonomous' ? t('autonomousWarning') : undefined}>{props => <Choice {...props} value={config.runtime.permission} onChange={event => set('runtime', { ...config.runtime, permission: event.target.value as AgentConfig['runtime']['permission'] })}><option value="workspace-write">{t('permission.workspace-write')}</option><option value="autonomous">{t('permission.autonomous')}</option></Choice>}</Field>
      {(['maxConcurrent', 'timeoutMinutes'] as const).map((key, index) => <NumberField key={key} field={key} value={config.runtime[key]} min={1} max={index ? 720 : 8} set={value => set('runtime', { ...config.runtime, [key]: value })} invalid={invalid(`runtime.${key}`)} />)}
    </TabsContent>
    <TabsContent value="capabilities"><AgentCapabilities api={api} library={library} skills={config.skills} tools={config.tools} setSkills={value => set('skills', value)} setTools={value => set('tools', value)} invalid={invalid} /></TabsContent>
    <TabsContent value="collaboration" className="grid gap-4 sm:grid-cols-2">
      <Field label={t('fields.canAssign')}>{props => <Choice {...props} value={config.delegation.canAssign} onChange={event => set('delegation', { ...config.delegation, canAssign: event.target.value as AgentConfig['delegation']['canAssign'] })}>{(['none', 'relations', 'team', 'project'] as const).map(value => <option key={value} value={value}>{t(`assignment.${value}`)}</option>)}</Choice>}</Field>
      <Field label={t('fields.autonomy')}>{props => <Choice {...props} value={config.autonomy ?? ''} onChange={event => set('autonomy', (event.target.value || null) as AgentConfig['autonomy'])}><option value="">{t('projectDefault')}</option>{['L0', 'L1', 'L2', 'L3', 'L4'].map(value => <option key={value}>{value}</option>)}</Choice>}</Field>
      <label className="flex items-center gap-3 sm:col-span-2"><Switch checked={config.delegation.canProposeAgents} onCheckedChange={value => set('delegation', { ...config.delegation, canProposeAgents: value })} /><span className="text-sm">{t('fields.canProposeAgents')}</span></label>
      {(['maxDepth', 'maxOpenSubtasks'] as const).map((key, index) => <NumberField key={key} field={key} value={config.delegation[key]} min={0} max={index ? 20 : 3} set={value => set('delegation', { ...config.delegation, [key]: value })} invalid={invalid(`delegation.${key}`)} />)}
      {(['perTaskTokens', 'monthlyTokens'] as const).map(key => <NumberField key={key} field={key} value={config.budget[key]} min={1} set={value => set('budget', { ...config.budget, [key]: Number.isNaN(value) ? undefined : value })} invalid={invalid(`budget.${key}`)} />)}
    </TabsContent>
    {detail && <TabsContent value="history"><AgentHistory api={api} detail={detail} busy={blocked} rollback={rollback} /></TabsContent>}
    </Tabs>
    {detail && tab !== 'history' && <div className="mt-4"><Field label={t('fields.note')}>{props => <Input {...props} value={note} onChange={event => setNote(event.target.value)} maxLength={500} />}</Field></div>}
    </fieldset>
  </AdminDialog>;
}

function NumberField({ field, min, max, value, set, invalid }: { field: string; min: number; max?: number; value: number | undefined; set: (value: number) => void; invalid: string | undefined }) {
  const t = useAgentLabels();
  return <Field label={t(`fields.${field}`)} invalid={invalid}>{props => <Input {...props} type="number" min={min} max={max} value={value === undefined || Number.isNaN(value) ? '' : value} onChange={event => set(event.target.valueAsNumber)} />}</Field>;
}

function StringList({ field, values, limit, set, invalid }: { field: 'goals' | 'workRules' | 'tags'; values: string[]; limit: number; set: (values: string[]) => void; invalid: string | undefined }) {
  const t = useAgentLabels();
  const [text, setText] = useState('');
  const [failed, setFailed] = useState(false);
  const tags = field === 'tags';
  function add() {
    const value = text.trim();
    if (!value) return;
    if (values.length >= limit || (tags && (!agentTagSchema.safeParse(value).success || values.includes(value)))) { setFailed(true); return; }
    set([...values, value]); setText(''); setFailed(false);
  }
  return <div className="space-y-2 sm:col-span-2">
    <Field label={t(`fields.${field}`)} invalid={failed ? t(tags ? 'tagHelp' : 'invalid') : invalid} hint={tags ? t('tagHelp') : undefined}>{props => <div className="flex gap-2">
      <Input {...props} value={text} maxLength={tags ? 40 : 500} onChange={event => { setText(event.target.value); setFailed(false); }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); add(); } }} />
      <Button type="button" variant="outline" onClick={add} disabled={values.length >= limit}>{t('add')}</Button>
    </div>}</Field>
    <ul className={tags ? 'flex flex-wrap gap-2' : 'space-y-1'}>{values.map((value, index) => <li key={`${value}-${index}`} className="flex min-w-0 items-center gap-2">
      {tags ? <Badge variant="secondary">{value}</Badge> : <span className="min-w-0 flex-1 break-words text-sm">{value}</span>}
      <Button type="button" size="sm" variant="ghost" aria-label={`${t('remove')}: ${value}`} onClick={() => set(values.filter((_, position) => position !== index))}>{t('remove')}</Button>
    </li>)}</ul>
  </div>;
}
