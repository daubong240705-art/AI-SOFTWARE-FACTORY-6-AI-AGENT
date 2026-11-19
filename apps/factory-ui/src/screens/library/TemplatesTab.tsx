import { useCallback, useId, useState } from 'react';
import type { AgentTemplateDetail, AgentTemplateSummary } from '@factory/contracts';
import type { AgentLibrary } from '@/api/agentModels';
import type { ApiClient } from '@/api/client';
import { templatesCreate, templatesDelete, templatesUpdate } from '@/api/commands';
import { Button } from '@/components/ui/button';
import { AgentEditor } from '../agents/AgentEditor';
import { Choice, Field, useAgentLabels, useRead, type Submit } from '../agents/shared';
import { DeleteDialog, LibraryRow, panelClass, PlainText, ReadFeedback, useLibraryLabels } from './shared';

const pageSize = 25;

export function TemplatesTab({ api, library, refreshKey, refresh, submit, blocked, libraryError }: {
  api: ApiClient; library: AgentLibrary; refreshKey: number; refresh: () => void; submit: Submit; blocked: boolean; libraryError: Error | undefined;
}) {
  const t = useLibraryLabels();
  const [selected, select] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const summary = library.templates.find(template => template.id === selected);
  return <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
    <section className={panelClass}>
      <Button type="button" disabled={blocked} onClick={() => setCreating(true)}>{t('createTemplate')}</Button>
      {!library.templates.length ? <p className="text-sm text-muted-foreground">{t('emptyTemplates')}</p> :
        <ul className="grid max-h-[min(52vh,32rem)] gap-2 overflow-y-auto p-1">{library.templates.map(template => <LibraryRow key={template.id} selected={selected === template.id} onSelect={() => select(template.id)}>
          <span className="block break-words font-semibold">{template.name}</span>
          <span className="block break-words text-sm">{template.role}</span>
          <TemplateMetadata template={template} />
        </LibraryRow>)}</ul>}
    </section>
    {summary ? <TemplatePanel key={summary.id} api={api} library={library} summary={summary} refreshKey={refreshKey} refresh={refresh} submit={submit} blocked={blocked} libraryError={libraryError} /> :
      <p className={`${panelClass} text-sm text-muted-foreground`}>{t(selected ? 'missing' : 'selectTemplate')}</p>}
    {creating && <AgentEditor api={api} library={library} close={() => setCreating(false)} submit={submit} refresh={refresh} loading={blocked} readError={libraryError}
      templateMode={{ title: t('createTemplate'), save: (config, description) => templatesCreate({ config, description }) }} />}
  </div>;
}

function TemplateMetadata({ template }: { template: AgentTemplateSummary }) {
  const t = useLibraryLabels();
  return <span className="flex flex-wrap gap-x-2 gap-y-1 break-all text-xs text-muted-foreground">
    <span>{template.source ? `pack:${template.source.packKey}` : t('custom')}</span><span>{t('latestRevision', { revision: template.latestRevision })}</span>
  </span>;
}

function TemplatePanel({ api, library, summary, refreshKey, refresh, submit, blocked, libraryError }: {
  api: ApiClient; library: AgentLibrary; summary: AgentTemplateSummary; refreshKey: number; refresh: () => void; submit: Submit; blocked: boolean; libraryError: Error | undefined;
}) {
  const t = useLibraryLabels();
  const agentLabel = useAgentLabels();
  const heading = useId();
  const [picked, setPicked] = useState<number | null>(null);
  const [dialog, setDialog] = useState<{ kind: 'edit' | 'delete'; snapshot: AgentTemplateDetail } | null>(null);
  const readLatest = useCallback((signal: AbortSignal) => api.getAgentTemplate(summary.id, signal), [api, summary.id]);
  const latest = useRead(readLatest, refreshKey);
  const readRevision = useCallback((signal: AbortSignal) => api.getAgentTemplateRevision(summary.id, picked!, signal), [api, summary.id, picked]);
  const revision = useRead(picked === null ? null : readRevision, refreshKey);
  const detail = latest.data;
  const template = detail?.template ?? summary;
  const displayed = picked === null ? detail : revision.data;
  const waiting = blocked || latest.loading || !!latest.error;
  const stale = !!dialog && (summary.latestRevision > dialog.snapshot.revision || (!!detail && detail.revision !== dialog.snapshot.revision));
  return <section className={panelClass} aria-labelledby={heading}>
    <header className="space-y-2">
      <h2 id={heading} className="break-words text-lg font-semibold">{template.name}</h2>
      <p className="break-words text-sm">{template.role}{template.description && ` · ${template.description}`}</p>
      <TemplateMetadata template={template} />
    </header>
    <ReadFeedback error={latest.error} loading={latest.loading} retry={refresh} />
    {detail && <>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={waiting} onClick={() => setDialog({ kind: 'edit', snapshot: detail })}>{agentLabel('edit')}</Button>
        <Button type="button" variant="destructive" disabled={waiting} onClick={() => setDialog({ kind: 'delete', snapshot: detail })}>{agentLabel('delete')}</Button>
      </div>
      <RevisionPicker latest={detail.revision} value={picked} onPick={setPicked} />
      {picked !== null && <ReadFeedback error={revision.error} loading={revision.loading} retry={refresh} />}
      {displayed && <>
        <h3 className="text-sm font-medium">{t('configuration', { revision: displayed.revision })}</h3>
        <PlainText>{JSON.stringify(displayed.config, null, 2)}</PlainText>
      </>}
    </>}
    {dialog?.kind === 'edit' && <AgentEditor api={api} library={library} initial={dialog.snapshot.config} close={() => setDialog(null)} submit={submit} refresh={refresh} loading={waiting} readError={latest.error ?? libraryError}
      templateMode={{ title: `${t('editTemplate')}: ${dialog.snapshot.template.name}`, description: dialog.snapshot.template.description, stale,
        save: (config, description) => templatesUpdate({ templateId: template.id, expectedRevision: dialog.snapshot.revision, config, description }) }} />}
    {dialog?.kind === 'delete' && <DeleteDialog name={dialog.snapshot.template.name} close={() => setDialog(null)} submit={submit} blocked={waiting} stale={stale}
      build={() => templatesDelete({ templateId: template.id, expectedRevision: dialog.snapshot.revision })} />}
  </section>;
}

function RevisionPicker({ latest, value, onPick }: { latest: number; value: number | null; onPick: (revision: number | null) => void }) {
  const t = useLibraryLabels();
  const [page, setPage] = useState(0);
  const end = Math.max(1, latest - page * pageSize);
  const start = Math.max(1, end - pageSize + 1);
  const entries = Array.from({ length: end - start + 1 }, (_, index) => end - index);
  const selected = value ?? latest;
  return <div className="space-y-2">
    <Field label={t('revisions')}>{props => <Choice {...props} value={selected} onChange={event => onPick(Number(event.target.value) === latest ? null : Number(event.target.value))}>
      {!entries.includes(selected) && <option value={selected}>r{selected}</option>}
      {entries.map(item => <option key={item} value={item}>r{item}</option>)}
    </Choice>}</Field>
    {latest > pageSize && <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(previous => previous - 1)}>{t('newerRevisions')}</Button>
      <Button type="button" size="sm" variant="outline" disabled={start === 1} onClick={() => setPage(previous => previous + 1)}>{t('olderRevisions')}</Button>
    </div>}
  </div>;
}
