import { useCallback, useState } from 'react';
import { GROUP_MAX_DEPTH, groupSlugSchema, groupsCreatePayloadSchema, type GroupSummary } from '@factory/contracts';
import { groupsArchive, groupsCreate, groupsDelete, groupsMove, groupsUpdate, projectsSetGroup } from '@/api/commands';
import { AgentCommandError, ApiClientError } from '@/api/client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { Store } from '@/state/store';
import { AdminDialog, DialogButtons, ErrorText, Field, useRead, useWriteFeedback } from '../agents/shared';
import { ReadFeedback } from '../library/shared';
import { GroupPicker } from './GroupTree';
import { useGroups, useGroupLabels } from './GroupsContext';
import { pathDisplay, slugify, subtreeIds } from './tree';

export function WriteIssue({ error, stale, loading, onReload }: {
  error: unknown; stale: boolean; loading: boolean; onReload: () => void;
}) {
  const t = useGroupLabels();
  const conflict = error instanceof ApiClientError && error.code === 'conflict';
  const detail = error instanceof AgentCommandError ? error.inputMessage : undefined;
  const reason = detail === 'group is not empty' ? 'notEmpty'
    : detail === 'group path already exists' ? 'pathTaken'
    : detail === 'group is archived' ? 'invalidDestination'
    : detail?.includes('maximum depth') ? 'depthLimit' : null;
  return <>
    {reason ? <Alert variant="destructive"><AlertDescription>{t(reason, { max: GROUP_MAX_DEPTH })}</AlertDescription></Alert>
      : !conflict && !(error instanceof AgentCommandError) ? <ErrorText error={error} />
      : !conflict && error ? <Alert variant="destructive"><AlertDescription>{t('writeFailed')}</AlertDescription></Alert> : null}
    {(stale || conflict) && <Alert variant="destructive"><AlertDescription className="space-y-2">
      <p>{t('conflict')}</p><Button type="button" variant="outline" size="sm" disabled={loading} onClick={onReload}>{t('useLatest')}</Button>
    </AlertDescription></Alert>}
  </>;
}

export function useDraftRevision(revision: number) {
  const [expectedRevision, setRevision] = useState(revision);
  return { expectedRevision, stale: expectedRevision !== revision, rebase: () => setRevision(revision) };
}

type GroupDialogProps = { group?: GroupSummary; parentId?: string | null; close: () => void; onCreated?: (id: string) => void; blocked?: boolean; readError?: Error | undefined };
export function GroupEditor({ group, parentId, close, onCreated, blocked = false, readError }: GroupDialogProps) {
  const t = useGroupLabels();
  const { list, submit, refresh } = useGroups();
  const writer = useWriteFeedback(submit);
  const revision = useDraftRevision(group?.revision ?? 0);
  const [name, setName] = useState(group?.name ?? '');
  const [slug, setSlug] = useState(group?.slug ?? '');
  const [automatic, setAutomatic] = useState(!group);
  const [parent, setParent] = useState(group?.parentId ?? parentId ?? null);
  const [description, setDescription] = useState(group?.description ?? '');
  const [tried, setTried] = useState(false);
  const groups = list.data?.groups ?? [];
  const destination = group ? group.parentId : parent;
  const chosen = groups.find(item => item.id === destination);
  const path = [chosen?.path, slug].filter(Boolean).join('/');
  const values = { name: name.trim(), slug, description };
  const fields = groupsCreatePayloadSchema.pick({ name: true, description: true });
  const taken = groups.some(item => item.path === path && item.id !== group?.id);
  const invalidParent = !group && parent !== null && (!chosen || chosen.archived || chosen.depth >= GROUP_MAX_DEPTH);
  const invalidSlug = !groupSlugSchema.safeParse(slug).success;
  const invalid = invalidSlug || taken || invalidParent || !fields.safeParse({ name: values.name, description }).success;
  const disabled = blocked || list.loading || !!list.error || revision.stale || writer.error instanceof ApiClientError && writer.error.code === 'conflict';
  const title = t(group ? 'editGroup' : 'createGroup');
  function save() {
    setTried(true);
    if (disabled || invalid) return;
    if (group) void writer.run(() => groupsUpdate({ ...values, groupId: group.id, expectedRevision: revision.expectedRevision }), close);
    else {
      const command = groupsCreate({ ...values, parentId: parent });
      void writer.run(() => command, () => { close(); onCreated?.(command.payload.groupId); });
    }
  }
  return <AdminDialog title={title} description={t(group ? 'editHelp' : 'createHelp', { max: GROUP_MAX_DEPTH })} close={close} busy={writer.busy} onSubmit={save}
    footer={<DialogButtons close={close} label={group ? t('save') : title} busy={writer.busy} disabled={disabled} />}>
    <Field label={t('groupName')} hint={t('nameLimit')} invalid={tried && !fields.shape.name.safeParse(values.name).success ? t('nameLimit') : undefined}>
      {props => <Input data-testid="group-name" {...props} required autoFocus maxLength={80} disabled={writer.busy} value={name} onChange={event => { const next = event.target.value; setName(next); if (automatic) setSlug(slugify(next)); }} />}
    </Field>
    <Field label={t('slug')} hint={t('slugHelp')} invalid={taken ? t('pathTaken') : tried && invalidSlug ? t('slugHelp') : undefined}>
      {props => <Input data-testid="group-slug" {...props} required maxLength={50} disabled={writer.busy} value={slug} onChange={event => { setAutomatic(false); setSlug(event.target.value); }} />}
    </Field>
    <ReadFeedback error={readError ?? list.error} loading={list.loading && !list.data} retry={refresh} />
    <GroupPicker groups={groups} label={t('parent')} rootLabel={t('rootGroup')} value={destination} onChange={setParent}
      disabled={!!group || writer.busy || !list.data} unavailable={item => item.depth >= GROUP_MAX_DEPTH} />
    {invalidParent && list.data && <p className="text-sm text-destructive">{t('invalidDestination')}</p>}
    <p className="break-all text-sm text-muted-foreground">{t('path')}: <code>{path || '/'}</code></p>
    <Field label={t('description')} hint={t('descriptionLimit')} invalid={tried && !fields.shape.description.safeParse(description).success ? t('descriptionLimit') : undefined}>
      {props => <Textarea {...props} maxLength={2000} disabled={writer.busy} value={description} onChange={event => setDescription(event.target.value)} />}
    </Field>
    <WriteIssue error={writer.error} stale={revision.stale} loading={blocked || list.loading || !!list.error} onReload={() => { revision.rebase(); writer.setError(null); }} />
  </AdminDialog>;
}

export function MoveGroupDialog({ group, close, blocked, readError }: { group: GroupSummary; close: () => void; blocked: boolean; readError?: Error | undefined }) {
  const t = useGroupLabels();
  const { list, submit, refresh } = useGroups();
  const writer = useWriteFeedback(submit);
  const revision = useDraftRevision(group.revision);
  const [parent, setParent] = useState(group.parentId);
  const groups = list.data?.groups ?? [];
  const subtree = subtreeIds(groups, group.id);
  const height = Math.max(1, ...groups.filter(item => subtree.has(item.id)).map(item => item.depth - group.depth + 1));
  const unavailable = (candidate: GroupSummary) => subtree.has(candidate.id) || candidate.depth + height > GROUP_MAX_DEPTH;
  const chosen = groups.find(item => item.id === parent);
  const path = [chosen?.path, group.slug].filter(Boolean).join('/');
  const taken = groups.some(item => item.path === path && item.id !== group.id);
  const loading = blocked || list.loading || !!list.error;
  const disabled = loading || revision.stale || writer.error instanceof ApiClientError && writer.error.code === 'conflict' ||
    parent === group.parentId || (parent !== null && (!chosen || chosen.archived || unavailable(chosen))) || taken;
  return <AdminDialog title={t('moveGroup')} description={t('moveHelp', { name: group.name, max: GROUP_MAX_DEPTH })} close={close} busy={writer.busy}
    onSubmit={() => { if (!disabled) void writer.run(() => groupsMove({ groupId: group.id, parentId: parent, expectedRevision: revision.expectedRevision }), close); }}
    footer={<DialogButtons close={close} label={t('move')} busy={writer.busy} disabled={disabled} />}>
    <ReadFeedback error={readError ?? list.error} loading={list.loading && !list.data} retry={refresh} />
    <GroupPicker groups={groups} label={t('parent')} rootLabel={t('rootGroup')} value={parent} onChange={setParent} disabled={writer.busy || !list.data} unavailable={unavailable} />
    <p className="break-all text-sm text-muted-foreground">{t('path')}: <code>{path}</code></p>
    {taken && <p className="text-sm text-destructive">{t('pathTaken')}</p>}
    {parent !== null && (!chosen || chosen.archived || unavailable(chosen)) && list.data && <p className="text-sm text-destructive">{t('invalidDestination')}</p>}
    <WriteIssue error={writer.error} stale={revision.stale} loading={loading} onReload={() => { revision.rebase(); writer.setError(null); }} />
  </AdminDialog>;
}

export function GroupConfirmation({ group, deleting, blockers, blocked, readError, close, onDeleted }: {
  group: GroupSummary; deleting: boolean; blockers: string[]; blocked: boolean; readError?: Error | undefined; close: () => void; onDeleted: () => void;
}) {
  const t = useGroupLabels();
  const { submit, refresh } = useGroups();
  const writer = useWriteFeedback(submit);
  const revision = useDraftRevision(group.revision);
  const [confirm, setConfirm] = useState('');
  const [targetArchived] = useState(!group.archived);
  const alreadySet = !deleting && group.archived === targetArchived;
  const title = t(deleting ? 'delete' : targetArchived ? 'archive' : 'restore');
  const disabled = blocked || revision.stale || writer.error instanceof ApiClientError && writer.error.code === 'conflict' ||
    alreadySet || (deleting && (blockers.length > 0 || confirm !== group.name));
  return <AdminDialog title={title} description={t(deleting ? 'deleteHelp' : targetArchived ? 'archiveHelp' : 'restoreHelp', { name: group.name })}
    close={close} busy={writer.busy} onSubmit={() => {
      if (disabled) return;
      const payload = { groupId: group.id, expectedRevision: revision.expectedRevision };
      if (deleting) void writer.run(() => groupsDelete(payload), onDeleted);
      else void writer.run(() => groupsArchive({ ...payload, archived: targetArchived }), close);
    }} footer={<DialogButtons close={close} label={title} busy={writer.busy} disabled={disabled} destructive={deleting} />}>
    <ReadFeedback error={readError} loading={false} retry={refresh} />
    {alreadySet && <p role="status" className="text-sm text-muted-foreground">{t('alreadySet')}</p>}
    {deleting && (blockers.length ? <div data-testid="group-delete-blockers" className="space-y-2 text-sm"><p>{t('notEmpty')}</p><ul className="list-disc space-y-1 ps-5">{blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul></div>
      : <Field label={t('typeName', { name: group.name })}>{props => <Input {...props} autoComplete="off" autoFocus value={confirm} disabled={writer.busy} onChange={event => setConfirm(event.target.value)} />}</Field>)}
    <WriteIssue error={writer.error} stale={revision.stale} loading={blocked} onReload={() => { revision.rebase(); writer.setError(null); }} />
  </AdminDialog>;
}

export function MoveProjectDialog({ projectId, name, currentGroup, store, close }: {
  projectId: string; name: string; currentGroup: string | null; store: Store; close: () => void;
}) {
  const t = useGroupLabels();
  const { api, list, submit, refresh, refreshKey } = useGroups();
  const read = useCallback((signal: AbortSignal) => api.getProject(projectId, signal), [api, projectId]);
  const project = useRead(read, refreshKey);
  const writer = useWriteFeedback(async build => { await submit(build); await store.loadProjects(); });
  const [destination, setDestination] = useState(currentGroup);
  const [revision, setRevision] = useState<number>();
  const current = project.data?.project;
  const stale = !!current && revision !== undefined && current.revision !== revision;
  const groups = list.data?.groups ?? [];
  const loading = project.loading || list.loading || !!project.error || !!list.error;
  const invalid = destination !== null && !groups.some(group => group.id === destination && !group.archived);
  const disabled = loading || stale || writer.error instanceof ApiClientError && writer.error.code === 'conflict' || !current || invalid || destination === current.groupId;
  return <AdminDialog title={t('moveProject')} description={t('projectMoveHelp', { name })} close={close} busy={writer.busy}
    onSubmit={() => {
      if (disabled || !current) return;
      setRevision(current.revision);
      void writer.run(() => projectsSetGroup(projectId, { groupId: destination, expectedRevision: current.revision }), close);
    }} footer={<DialogButtons close={close} label={t('move')} busy={writer.busy} disabled={disabled} />}>
    <ReadFeedback error={project.error ?? list.error} loading={project.loading || list.loading} retry={refresh} />
    <GroupPicker groups={groups} label={t('projectGroup')} rootLabel={t('noGroup')} value={destination} disabled={writer.busy || !current || !list.data}
      onChange={value => { setDestination(value); setRevision(previous => previous ?? current?.revision); }} />
    <p className="break-all text-sm text-muted-foreground">{t('path')}: <code>{pathDisplay(groups, destination, t('noGroup'))}</code></p>
    {invalid && list.data && <p className="text-sm text-destructive">{t('invalidDestination')}</p>}
    <WriteIssue error={writer.error} stale={stale} loading={loading} onReload={() => { setRevision(current?.revision); writer.setError(null); }} />
  </AdminDialog>;
}
