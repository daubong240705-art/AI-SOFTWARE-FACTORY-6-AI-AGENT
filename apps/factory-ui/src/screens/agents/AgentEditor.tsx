import { Choice, ChoiceOption } from '@/components/ui/choice';
import { useCallback, useEffect, useState } from 'react';
import { agentAdapterSchema, agentConfigSchema, agentTagSchema, type AgentConfig, type AgentConfigInput, type AgentDetail, type Command } from '@factory/contracts';
import { ApiClientError, type ApiClient } from '@/api/client';
import type { AgentLibrary } from '@/api/agentModels';
import { agentsCreate, agentsRollback, agentsUpdate } from '@/api/commands';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { LibraryError, useLibraryLabels } from '../library/shared';
import { AgentHistory } from './AgentHistory';
import { AdminDialog, DialogButtons, ErrorText, Field, useAgentLabels, useRead, useWriteFeedback, type Submit } from './shared';
import { AgentCapabilities } from './AgentCapabilities';
import { AgentMascot } from '@/components/mascot/AgentMascot';
import { isMascotSpecies, isMascotTag, mascotTag, speciesFromTags } from '@/components/mascot/agentSpecies';
import { speciesList } from '@/components/mascot/species';

const blank: AgentConfig = { name: '', role: '', description: '', goals: [], instructions: '', workRules: [], tags: [], runtime: { adapter: 'codex', model: null, effort: null, permission: 'workspace-write', maxConcurrent: 1, timeoutMinutes: 60 }, skills: [], tools: null, delegation: { canAssign: 'none', canProposeAgents: false, maxDepth: 1, maxOpenSubtasks: 5 }, autonomy: null, budget: {} };
const basicPaths = new Set(['name', 'role', 'description', 'instructions', 'runtime.adapter', 'runtime.model']);

type TemplateMode = { title: string; description?: string; stale?: boolean; save: (config: AgentConfig, description: string) => Command };

export function AgentEditor({ api, projectId, detail, library, initial, template, templateMode, close, submit, refresh, loading, readError }: {
  api: ApiClient; detail?: AgentDetail; library?: AgentLibrary; initial?: AgentConfig;
  template?: { id: string; revision: number; link: boolean }; close: () => void; submit: Submit; refresh: () => void; loading?: boolean; readError?: Error | undefined;
} & ({ projectId: string; templateMode?: never } | { projectId?: never; templateMode: TemplateMode })) {
  const t = useAgentLabels();
  const libraryLabel = useLibraryLabels();
  const [draft, setDraft] = useState({ config: detail?.config ?? initial ?? blank, revision: detail?.revision });
  const { config } = draft;
  const [history, setHistory] = useState(false);
  const [briefField, setBriefField] = useState<'description' | 'instructions'>('description');
  const [advanced, setAdvanced] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState(template);
  const [templateChoice, setTemplateChoice] = useState(template?.id ?? '');
  const creating = !detail && !templateMode;
  const available = useRead(creating && !library ? api.getAgentLibrary : null);
  const loadTemplate = useCallback((signal: AbortSignal) => api.getAgentTemplate(templateChoice, signal), [api, templateChoice]);
  const chosen = useRead(creating && templateChoice && activeTemplate?.id !== templateChoice ? loadTemplate : null);
  const [note, setNote] = useState('');
  const [description, setDescription] = useState(templateMode?.description ?? '');
  const [errors, setErrors] = useState<string[]>([]);
  const [awaiting, setAwaiting] = useState<AgentDetail | null>(null);
  const writer = useWriteFeedback(submit);
  const stale = !!detail && detail.revision !== draft.revision;
  const templateStale = !!templateMode && (templateMode.stale || (writer.error instanceof ApiClientError && writer.error.code === 'conflict'));
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
    if (stale || templateStale || loading || awaiting || history || (templateChoice && activeTemplate?.id !== templateChoice)) return;
    const input: AgentConfigInput = { ...config, runtime: { ...config.runtime, model: config.runtime.model?.trim() || null } };
    const parsed = agentConfigSchema.safeParse(input);
    if (!parsed.success) {
      const paths = parsed.error.issues.map(issue => issue.path.join('.'));
      setErrors(paths);
      if (paths.includes('description') || paths.includes('instructions')) setBriefField(paths.includes('description') ? 'description' : 'instructions');
      if (paths.some(path => !basicPaths.has(path))) setAdvanced(true);
      return;
    }
    setErrors([]);
    if (templateMode) void writer.run(() => templateMode.save(parsed.data, description), close);
    else void writer.run(() => detail ? agentsUpdate({ projectId, agentId: detail.id, expectedRevision: draft.revision!, config: parsed.data, ...(note.trim() ? { note: note.trim() } : {}) }) : agentsCreate({ projectId, config: parsed.data, teamIds: [], isLead: false, ...(activeTemplate ? { template: activeTemplate } : {}) }), close);
  };
  const blocked = writer.busy || !!loading || stale || templateStale || !!awaiting;
  const rollback = (revision: number) => { if (detail && projectId && !blocked) void writer.run(() => agentsRollback({ projectId, agentId: detail.id, expectedRevision: draft.revision!, toRevision: revision }), afterWrite); };
  const set = <T extends keyof AgentConfig>(key: T, value: AgentConfig[T]) => setDraft(previous => ({ ...previous, config: { ...previous.config, [key]: value } }));
  const editorHelp = templateMode ? libraryLabel('templateEditorHelp') : t('editorHelp');
  const mascot = speciesFromTags(config.tags);
  const tags = config.tags.filter(tag => !isMascotTag(tag));
  const choices = (library ?? available.data)?.templates ?? [];
  const pendingTemplate = !!templateChoice && activeTemplate?.id !== templateChoice;
  const title = templateMode?.title ?? (detail ? `${t('edit')}: ${detail.name}` : t('create'));
  return <AdminDialog wide title={title} icon={<AgentMascot agent={{ role: config.role, isLead: detail?.isLead ?? false }} tags={config.tags} size={36} />} description={editorHelp} close={close} busy={writer.busy} onSubmit={save} footer={<DialogButtons close={close} label={t('save')} busy={writer.busy} disabled={blocked || history || pendingTemplate} />}>
    {templateMode ? <LibraryError error={writer.error} stale={templateStale} /> : <ErrorText error={writer.error} />}
    <ErrorText error={readError} />
    {(stale || awaiting || readError) && <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
      {stale && !awaiting && t('errors.conflict')}
      <Button type="button" variant="outline" size="sm" disabled={loading && !readError} onClick={stale && !readError ? reset : refresh}>{t('reload')}</Button>
    </div>}
    {!!errors.length && <p role="alert" className="text-sm text-destructive">{t('invalidForm')}</p>}
    <fieldset disabled={writer.busy || !!awaiting} className="space-y-4">
    {detail && !templateMode && <div className="flex justify-end"><Button data-testid="agent-tab-history" type="button" variant="ghost" aria-pressed={history} onClick={() => setHistory(value => !value)}>{t(history ? 'edit' : 'tabs.history')}</Button></div>}
    {history && detail ? <AgentHistory api={api} detail={detail} busy={blocked} rollback={rollback} /> : <>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t('fields.name')} invalid={invalid('name')}>{props => <Input data-testid="agent-name" {...props} value={config.name} onChange={event => set('name', event.target.value)} maxLength={80} />}</Field>
      <Field label={t('fields.role')} invalid={invalid('role')}>{props => <Input data-testid="agent-role" {...props} value={config.role} onChange={event => set('role', event.target.value)} maxLength={160} />}</Field>
      <Field label={t('mascot.label')} hint={!mascot && tags.length >= 16 ? t('mascot.full') : undefined}>{props => <Choice {...props} data-testid="agent-mascot" value={mascot ?? ''} onValueChange={value => set('tags', isMascotSpecies(value) ? [...tags, mascotTag(value)] : tags)}>
        <ChoiceOption value="">{t('mascot.auto')}</ChoiceOption>
        {speciesList.map(value => <ChoiceOption key={value} value={value} disabled={!mascot && tags.length >= 16}><span className="flex items-center gap-2"><AgentMascot agent={config} speciesOverride={value} skin="classic" size={24} />{t(`mascot.species.${value}`)}</span></ChoiceOption>)}
      </Choice>}</Field>
      {creating && <Field label={t('template')} hint={available.loading ? t('loading') : undefined}>{props => <Choice {...props} value={templateChoice} onValueChange={value => { setTemplateChoice(value); if (!value) setActiveTemplate(undefined); }}><ChoiceOption value="">{t('none')}</ChoiceOption>{choices.map(item => <ChoiceOption key={item.id} value={item.id}>{item.name}</ChoiceOption>)}</Choice>}</Field>}
      {pendingTemplate && <div className="sm:col-span-2"><ErrorText error={chosen.error} /><Button type="button" variant="outline" size="sm" disabled={!chosen.data || chosen.loading} onClick={() => {
        const data = chosen.data;
        if (!data) return;
        setDraft({ config: { ...data.config, name: config.name.trim() || data.config.name }, revision: undefined });
        setActiveTemplate({ id: data.template.id, revision: data.revision, link: false }); setErrors([]);
      }}>{chosen.loading ? t('loading') : t('applyTemplate')}</Button></div>}
      <Field label={t('fields.adapter')} invalid={invalid('runtime.adapter')} hint={t('adapterHint')}>{props => <Choice {...props} value={config.runtime.adapter} onValueChange={selectedValue => set('runtime', { ...config.runtime, adapter: agentAdapterSchema.parse(selectedValue) })}>{agentAdapterSchema.options.map(adapter => <ChoiceOption key={adapter} value={adapter}>{t(`adapters.${adapter}`)}</ChoiceOption>)}</Choice>}</Field>
      <Field label={t('fields.model')} invalid={invalid('runtime.model')} hint={t('default')}>{props => <Input {...props} value={config.runtime.model ?? ''} onChange={event => set('runtime', { ...config.runtime, model: event.target.value || null })} maxLength={256} />}</Field>
      <div className="space-y-2 sm:col-span-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label={t('advanced.summaryFields')}>
          {(['description', 'instructions'] as const).map(field => <Button key={field} type="button" size="sm" variant={briefField === field ? 'secondary' : 'ghost'} aria-pressed={briefField === field} onClick={() => setBriefField(field)}>{t(field === 'description' ? 'shortDescription' : 'mainInstructions')}</Button>)}
        </div>
        <Field label={t(briefField === 'description' ? 'shortDescription' : 'mainInstructions')} invalid={invalid(briefField)}>{props => <Textarea key={briefField} data-testid={briefField === 'description' ? 'agent-description' : 'agent-instructions'} {...props} rows={3} value={config[briefField]} onChange={event => set(briefField, event.target.value)} maxLength={briefField === 'description' ? 2000 : 65536} />}</Field>
      </div>
    </div>
    <details className="rounded-lg border border-border bg-muted/20" open={advanced} onToggle={event => setAdvanced(event.currentTarget.open)}>
    <summary data-testid="agent-advanced" className="cursor-pointer px-4 py-3 text-sm font-semibold">{t('advanced.title')}</summary>
    {advanced && <div className="space-y-5 px-4 pb-4">
    <EditorSection title={t('advanced.skills')} testId="agent-tab-capabilities"><div className="sm:col-span-2"><AgentCapabilities api={api} library={library ?? available.data} skills={config.skills} tools={config.tools} setSkills={value => set('skills', value)} setTools={value => set('tools', value)} invalid={invalid} /></div></EditorSection>
    <EditorSection title={t('advanced.permissions')} testId="agent-tab-collaboration">
      <Field label={t('fields.permission')} hint={config.runtime.permission === 'autonomous' ? t('autonomousWarning') : undefined}>{props => <Choice {...props} value={config.runtime.permission} onValueChange={selectedValue => set('runtime', { ...config.runtime, permission: selectedValue as AgentConfig['runtime']['permission'] })}><ChoiceOption value="workspace-write">{t('permission.workspace-write')}</ChoiceOption><ChoiceOption value="autonomous">{t('permission.autonomous')}</ChoiceOption></Choice>}</Field>
      <Field label={t('fields.canAssign')}>{props => <Choice {...props} value={config.delegation.canAssign} onValueChange={selectedValue => set('delegation', { ...config.delegation, canAssign: selectedValue as AgentConfig['delegation']['canAssign'] })}>{(['none', 'relations', 'team', 'project'] as const).map(value => <ChoiceOption key={value} value={value}>{t(`assignment.${value}`)}</ChoiceOption>)}</Choice>}</Field>
      <Field label={t('fields.autonomy')}>{props => <Choice {...props} value={config.autonomy ?? ''} onValueChange={selectedValue => set('autonomy', (selectedValue || null) as AgentConfig['autonomy'])}><ChoiceOption value="">{t('projectDefault')}</ChoiceOption>{['L0', 'L1', 'L2', 'L3', 'L4'].map(value => <ChoiceOption key={value} value={value}>{value}</ChoiceOption>)}</Choice>}</Field>
      <label className="flex items-center gap-3 sm:col-span-2"><Switch checked={config.delegation.canProposeAgents} onCheckedChange={value => set('delegation', { ...config.delegation, canProposeAgents: value })} /><span className="text-sm">{t('fields.canProposeAgents')}</span></label>
      {(['maxDepth', 'maxOpenSubtasks'] as const).map((key, index) => <NumberField key={key} field={key} value={config.delegation[key]} min={0} max={index ? 20 : 3} set={value => set('delegation', { ...config.delegation, [key]: value })} invalid={invalid(`delegation.${key}`)} />)}
    </EditorSection>
    <EditorSection title={t('advanced.limits')} testId="agent-tab-runtime">
      {(['maxConcurrent', 'timeoutMinutes'] as const).map((key, index) => <NumberField key={key} field={key} value={config.runtime[key]} min={1} max={index ? 720 : 8} set={value => set('runtime', { ...config.runtime, [key]: value })} invalid={invalid(`runtime.${key}`)} />)}
      {(['perTaskTokens', 'monthlyTokens'] as const).map(key => <NumberField key={key} field={key} value={config.budget[key]} min={1} set={value => set('budget', { ...config.budget, [key]: Number.isNaN(value) ? undefined : value })} invalid={invalid(`budget.${key}`)} />)}
    </EditorSection>
    <EditorSection title={t('advanced.other')} testId="agent-tab-profile">
      <Field label={t('fields.effort')}>{props => <Choice {...props} value={config.runtime.effort ?? ''} onValueChange={selectedValue => set('runtime', { ...config.runtime, effort: (selectedValue || null) as AgentConfig['runtime']['effort'] })}><ChoiceOption value="">{t('default')}</ChoiceOption>{(['low', 'medium', 'high', 'xhigh'] as const).map(value => <ChoiceOption key={value} value={value}>{t(`effort.${value}`)}</ChoiceOption>)}</Choice>}</Field>
      <StringList key={`goals:${draft.revision}`} field="goals" values={config.goals} limit={12} set={values => set('goals', values)} invalid={invalid('goals')} />
      <StringList key={`rules:${draft.revision}`} field="workRules" values={config.workRules} limit={20} set={values => set('workRules', values)} invalid={invalid('workRules')} />
      <StringList key={`tags:${draft.revision}`} field="tags" values={tags} limit={16 - config.tags.filter(isMascotTag).length} set={values => set('tags', [...values, ...config.tags.filter(isMascotTag)])} invalid={invalid('tags')} />
      {templateMode && <div className="sm:col-span-2"><Field label={libraryLabel('templateDescription')}>{props => <Textarea {...props} value={description} onChange={event => setDescription(event.target.value)} maxLength={2000} />}</Field></div>}
      {detail && <Field label={t('fields.note')}>{props => <Input {...props} value={note} onChange={event => setNote(event.target.value)} maxLength={500} />}</Field>}
    </EditorSection>
    </div>}
    </details></>}
    </fieldset>
  </AdminDialog>;
}

function EditorSection({ title, testId, children }: { title: string; testId: string; children: React.ReactNode }) {
  return <section data-testid={testId} className="space-y-3 border-t border-border pt-4"><h3 className="text-sm font-semibold">{title}</h3><div className="grid gap-4 sm:grid-cols-2">{children}</div></section>;
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
    if (values.length >= limit || (tags && (!agentTagSchema.safeParse(value).success || isMascotTag(value) || values.includes(value)))) { setFailed(true); return; }
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
