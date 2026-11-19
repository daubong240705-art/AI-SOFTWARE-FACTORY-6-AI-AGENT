import { useCallback, useId, useRef, useState } from 'react';
import { skillTrustSchema, skillsCreatePayloadSchema, skillsUpdatePayloadSchema, type SkillDetail, type SkillSummary, type SkillVersion } from '@factory/contracts';
import type { AgentLibrary } from '@/api/agentModels';
import { ApiClientError, type ApiClient } from '@/api/client';
import { skillsCreate, skillsDelete, skillsUpdate } from '@/api/commands';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AdminDialog, Choice, DialogButtons, Field, useAgentLabels, useRead, useWriteFeedback, type Submit } from '../agents/shared';
import { dateTime, DeleteDialog, LibraryError, LibraryRow, panelClass, PlainText, ReadFeedback, useLibraryLabels } from './shared';

type Draft = Pick<SkillSummary, 'name' | 'description' | 'trust'> & { content: string };
const blank: Draft = { name: '', description: '', trust: 'instructions', content: '' };
const contentLimit = 65_536;

function skillDraft(content: string): Draft {
  const draft = { ...blank, content };
  const frontmatter = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m.exec(content);
  if (frontmatter?.index === 0) for (const line of frontmatter[1]!.split(/\r?\n/)) {
    const field = /^(name|description):[ \t]*(.*)$/.exec(line);
    if (!field) continue;
    const value = field[2]!.trim();
    const unquoted = /^(['"])(.*)\1$/.exec(value)?.[2] ?? value;
    if (field[1] === 'name') draft.name = unquoted;
    else draft.description = unquoted;
  }
  return draft;
}

export function SkillsTab({ api, library, refreshKey, refresh, submit, blocked }: {
  api: ApiClient; library: AgentLibrary; refreshKey: number; refresh: () => void; submit: Submit; blocked: boolean;
}) {
  const t = useLibraryLabels();
  const [search, setSearch] = useState('');
  const [selected, select] = useState<string | null>(null);
  const [creation, setCreation] = useState<Draft | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const query = search.trim().toLocaleLowerCase();
  const skills = library.skills.filter(skill => `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(query));
  const summary = library.skills.find(skill => skill.id === selected);
  function importFile(file: File) {
    setImportError(false);
    if (!/\.md$/i.test(file.name)) { setImportError(true); return; }
    const reader = new FileReader();
    const fail = () => { setImportError(true); setImporting(false); };
    reader.addEventListener('error', fail);
    reader.addEventListener('abort', fail);
    reader.addEventListener('load', () => {
      if (typeof reader.result !== 'string') { fail(); return; }
      setImporting(false);
      setCreation(skillDraft(reader.result));
    });
    setImporting(true);
    reader.readAsText(file);
  }
  return <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
    <section className={panelClass}>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={blocked || importing} onClick={() => { setImportError(false); setCreation(blank); }}>{t('createSkill')}</Button>
        <Button type="button" variant="outline" disabled={blocked || importing} onClick={() => fileInput.current?.click()}>{t('importSkill')}</Button>
        <input ref={fileInput} type="file" accept=".md" hidden onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) importFile(file);
        }} />
      </div>
      <ReadFeedback error={undefined} loading={importing} retry={refresh} />
      {importError && <p role="alert" className="text-sm text-destructive">{t('importError')}</p>}
      <Field label={t('searchSkills')}>{props => <Input {...props} type="search" value={search} onChange={event => setSearch(event.target.value)} />}</Field>
      {!skills.length ? <p className="text-sm text-muted-foreground">{t(query ? 'emptySearch' : 'emptySkills')}</p> :
        <ul className="grid max-h-[min(52vh,32rem)] gap-2 overflow-y-auto p-1">{skills.map(skill => <LibraryRow key={skill.id} selected={selected === skill.id} onSelect={() => select(skill.id)}>
          <span className="block break-all font-semibold">{skill.name}</span>
          <span className="block break-words text-sm text-muted-foreground">{skill.description}</span>
          <SkillMetadata skill={skill} />
        </LibraryRow>)}</ul>}
    </section>
    {summary ? <SkillPanel key={summary.id} api={api} summary={summary} refreshKey={refreshKey} refresh={refresh} submit={submit} blocked={blocked} /> :
      <p className={`${panelClass} text-sm text-muted-foreground`}>{t(selected ? 'missing' : 'selectSkill')}</p>}
    {creation && <SkillEditor draft={creation} close={() => setCreation(null)} submit={submit} blocked={blocked} />}
  </div>;
}

function SkillMetadata({ skill }: { skill: SkillSummary }) {
  const t = useLibraryLabels();
  return <span className="flex flex-wrap items-center gap-x-2 gap-y-1 break-all text-xs text-muted-foreground">
    <Badge variant="secondary">{t(`trust.${skill.trust}`)}</Badge>
    <span>{skill.source ?? t('custom')}</span><span>{t('latestVersion', { version: skill.latestVersion })}</span><time dateTime={skill.updatedAt}>{dateTime(skill.updatedAt)}</time>
  </span>;
}

function SkillPanel({ api, summary, refreshKey, refresh, submit, blocked }: {
  api: ApiClient; summary: SkillSummary; refreshKey: number; refresh: () => void; submit: Submit; blocked: boolean;
}) {
  const t = useLibraryLabels();
  const agentLabel = useAgentLabels();
  const heading = useId();
  const [version, setVersion] = useState<number | null>(null);
  const [dialog, setDialog] = useState<{ kind: 'edit' | 'delete'; snapshot: SkillDetail } | null>(null);
  const read = useCallback((signal: AbortSignal) => api.getSkill(summary.id, signal), [api, summary.id]);
  const detail = useRead(read, refreshKey);
  const data = detail.data;
  const skill = data?.skill ?? summary;
  const current = version ?? skill.latestVersion;
  const readVersion = useCallback((signal: AbortSignal) => api.getSkillVersion(summary.id, current, signal), [api, summary.id, current]);
  const content = useRead(data ? readVersion : null, refreshKey);
  const waiting = blocked || detail.loading || !!detail.error;
  const stale = !!dialog && !!data && data.skill.revision !== dialog.snapshot.skill.revision;
  return <section className={panelClass} aria-labelledby={heading}>
    <header className="space-y-2">
      <h2 id={heading} className="break-all text-lg font-semibold">{skill.name}</h2>
      <p className="break-words text-sm">{skill.description}</p>
      <SkillMetadata skill={skill} />
    </header>
    <ReadFeedback error={detail.error} loading={detail.loading} retry={refresh} />
    {data && <>
      <p className="text-sm">{t('usedBy', data.usedBy)}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={waiting} onClick={() => setDialog({ kind: 'edit', snapshot: data })}>{agentLabel('edit')}</Button>
        <Button type="button" variant="destructive" disabled={waiting} onClick={() => setDialog({ kind: 'delete', snapshot: data })}>{agentLabel('delete')}</Button>
      </div>
      <Field label={t('versions')}>{props => <Choice {...props} value={current} onChange={event => setVersion(Number(event.target.value) === skill.latestVersion ? null : Number(event.target.value))}>
        {[...data.versions].sort((left, right) => right.version - left.version).map(item => <option key={item.version} value={item.version}>v{item.version} · {dateTime(item.createdAt)}</option>)}
      </Choice>}</Field>
      <ReadFeedback error={content.error} loading={content.loading} retry={refresh} />
      {content.data && <PlainText>{content.data.content}</PlainText>}
    </>}
    {dialog?.kind === 'edit' && <EditSkill api={api} snapshot={dialog.snapshot.skill} close={() => setDialog(null)} refreshKey={refreshKey} refresh={refresh} submit={submit} blocked={waiting} stale={stale} />}
    {dialog?.kind === 'delete' && <DeleteDialog name={dialog.snapshot.skill.name} close={() => setDialog(null)} submit={submit} blocked={waiting} stale={stale}
      build={() => skillsDelete({ skillId: skill.id, expectedRevision: dialog.snapshot.skill.revision })} />}
  </section>;
}

function EditSkill({ api, snapshot, close, refreshKey, refresh, submit, blocked, stale }: {
  api: ApiClient; snapshot: SkillDetail['skill']; close: () => void; refreshKey: number; refresh: () => void; submit: Submit; blocked: boolean; stale: boolean;
}) {
  const t = useLibraryLabels();
  const agentLabel = useAgentLabels();
  const read = useCallback((signal: AbortSignal) => api.getSkillVersion(snapshot.id, snapshot.latestVersion, signal), [api, snapshot.id, snapshot.latestVersion]);
  const version = useRead(read, refreshKey);
  if (!version.data) return <AdminDialog title={`${agentLabel('edit')}: ${snapshot.name}`} description={t('skillEditorHelp')} close={close}>
    <ReadFeedback error={version.error} loading={version.loading} retry={refresh} />
  </AdminDialog>;
  return <SkillEditor draft={{ name: snapshot.name, description: snapshot.description, trust: snapshot.trust, content: version.data.content }}
    edit={{ skill: snapshot, version: version.data }} close={close} submit={submit} blocked={blocked} stale={stale} />;
}

function SkillEditor({ draft, edit, close, submit, blocked, stale }: {
  draft: Draft; edit?: { skill: SkillDetail['skill']; version: SkillVersion }; close: () => void; submit: Submit; blocked: boolean; stale?: boolean;
}) {
  const t = useLibraryLabels();
  const agentLabel = useAgentLabels();
  const writer = useWriteFeedback(submit);
  const counter = useId();
  const [value, setValue] = useState(draft);
  const [attempted, setAttempted] = useState(false);
  const set = <Key extends keyof Draft>(key: Key, entry: Draft[Key]) => setValue(previous => ({ ...previous, [key]: entry }));
  const payload = edit ? {
    ...(value.name.trim() !== edit.skill.name ? { name: value.name.trim() } : {}),
    ...(value.description.trim() !== edit.skill.description ? { description: value.description.trim() } : {}),
    ...(value.content !== edit.version.content ? { content: value.content } : {}),
  } : { ...value, name: value.name.trim() };
  const fields = edit ? skillsUpdatePayloadSchema.pick({ name: true, description: true, content: true }) : skillsCreatePayloadSchema.omit({ skillId: true });
  const parsed = fields.safeParse(payload);
  const invalid = (key: keyof Draft) => (attempted || (key === 'content' && value.content.length > contentLimit)) && !parsed.success && parsed.error.issues.some(issue => issue.path[0] === key) ? t(key === 'name' ? 'skillNameHint' : 'invalidSkill') : undefined;
  const disabled = blocked || stale || (writer.error instanceof ApiClientError && writer.error.code === 'conflict') || (!!edit && !Object.keys(payload).length);
  function save() {
    if (disabled) return;
    setAttempted(true);
    if (!parsed.success) return;
    if (edit) void writer.run(() => skillsUpdate({ skillId: edit.skill.id, expectedRevision: edit.skill.revision, ...payload }), close);
    else void writer.run(() => skillsCreate({ ...value, name: value.name.trim(), description: value.description.trim() }), close);
  }
  return <AdminDialog wide title={edit ? `${agentLabel('edit')}: ${edit.skill.name}` : t('createSkill')} description={t('skillEditorHelp')} close={close} busy={writer.busy} onSubmit={save}
    footer={<DialogButtons close={close} label={agentLabel('save')} busy={writer.busy} disabled={!!disabled} />}>
    <LibraryError error={writer.error} stale={stale ?? false} />
    <fieldset disabled={writer.busy} className="grid gap-4">
      <Field label={agentLabel('fields.name')} invalid={invalid('name')} hint={t('skillNameHint')}>{props => <Input {...props} value={value.name} maxLength={64} onChange={event => set('name', event.target.value)} />}</Field>
      <Field label={agentLabel('fields.description')} invalid={invalid('description')}>{props => <Textarea {...props} value={value.description} maxLength={1024} onChange={event => set('description', event.target.value)} />}</Field>
      {!edit && <Field label={t('trustLabel')}>{props => <Choice {...props} value={value.trust} onChange={event => set('trust', skillTrustSchema.parse(event.target.value))}>
        {skillTrustSchema.options.map(trust => <option key={trust} value={trust}>{t(`trust.${trust}`)}</option>)}
      </Choice>}</Field>}
      <Field label={t('content')} invalid={invalid('content')}>{props => <Textarea {...props} className="min-h-48 font-mono text-xs" value={value.content} maxLength={contentLimit} aria-describedby={props['aria-describedby'] ? `${counter} ${props['aria-describedby']}` : counter} onChange={event => set('content', event.target.value)} />}</Field>
      <p id={counter} className="text-xs text-muted-foreground">{t('contentCount', { count: value.content.length.toLocaleString(), limit: contentLimit.toLocaleString() })}</p>
    </fieldset>
  </AdminDialog>;
}
