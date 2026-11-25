import { useCallback, useState } from 'react';
import { GROUP_MAX_DEPTH, taskStateSchema, type GroupDetail } from '@factory/contracts';
import { Archive, ChevronRight, Folder, FolderPlus, FolderSymlink, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Page } from '@/components/Page';
import { i18n, useT } from '@/i18n';
import type { Store } from '@/state/store';
import { useRead } from '../agents/shared';
import { ReadFeedback } from '../library/shared';
import { attentionHash } from '../Attention';
import { viewHash, type View } from '../shell/navigation';
import { GroupConfirmation, GroupEditor, MoveGroupDialog, MoveProjectDialog } from './GroupDialogs';
import { GroupLibrary } from './GroupLibrary';
import { GroupSettings } from './GroupSettings';
import { useGroupLabels, useGroups } from './GroupsContext';
import { subtreeIds } from './tree';

const tabs = ['overview', 'children', 'settings', 'library'] as const;
const section = 'min-w-0 rounded-xl border border-border bg-card/60 p-4';
type Dialog = 'edit' | 'move' | 'archive' | 'delete' | 'child' | { projectId: string; name: string } | { childId: string };

function Overview({ rollup, approvalId }: { rollup: GroupDetail['rollup']; approvalId?: string | undefined }) {
  const t = useGroupLabels();
  const global = useT();
  const format = new Intl.NumberFormat(i18n.locale);
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">{t('rollupHelp')}</p>
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {(['projects', 'pendingApprovals', 'activeFlowRuns', 'liveAttempts'] as const).map(key => <div key={key} className={section}>
        <dt className="text-sm text-muted-foreground">{t(key)}</dt><dd className="text-2xl font-semibold tabular-nums">{format.format(rollup[key])}
          {key === 'pendingApprovals' && <a className="block text-sm font-normal text-primary underline" href={attentionHash(approvalId ? `approval:${approvalId}` : undefined)}>{global('nav.attention')}</a>}</dd>
      </div>)}
      <div className={`${section} sm:col-span-2`}><dt className="text-sm text-muted-foreground">{t('tokens30d')}</dt>
        <dd className="break-words text-lg font-semibold tabular-nums">{rollup.tokens30d === null ? t('unknownTokens') : format.format(rollup.tokens30d)}</dd>
        <dd className="text-sm text-muted-foreground">{t('budgetTokens30d')}: {rollup.budgetTokens30d === null ? t('noBudget') : format.format(rollup.budgetTokens30d)}</dd>
      </div>
    </dl>
    <section className={section}><h2 className="mb-3 font-semibold">{t('tasksByState')}</h2>
      {Object.keys(rollup.tasksByState).length ? <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {Object.entries(rollup.tasksByState).map(([state, count]) => <div key={state} className="flex justify-between gap-3 border-b border-border py-1 text-sm">
          <dt>{taskStateSchema.safeParse(state).success ? global(`taskUi.lifecycle.${state}`) : t('otherState')}</dt><dd className="tabular-nums">{format.format(count)}</dd>
        </div>)}
      </dl> : <p className="text-sm text-muted-foreground">{t('noTasks')}</p>}
    </section>
  </div>;
}

export default function GroupPage({ id, store, onNavigate, onNewProject }: { id: string; store: Store; onNavigate: (view: View) => void; onNewProject: (groupId: string) => void }) {
  const t = useGroupLabels();
  const { api, list, refreshKey, refresh } = useGroups();
  const read = useCallback((signal: AbortSignal) => api.getGroup(id, signal), [api, id]);
  const readLibrary = useCallback((signal: AbortSignal) => api.getScopedLibrary({ groupId: id }, signal), [api, id]);
  const detail = useRead(read, refreshKey);
  const library = useRead(detail.data ? readLibrary : null, refreshKey);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [tab, setTab] = useState('overview');
  const approvals = store.useStoreSelector(state => state.globalInbox.approvals);
  const close = () => setDialog(null);
  if (!detail.data) return <Page><ReadFeedback error={detail.error} loading={detail.loading} retry={refresh} /></Page>;
  const { group, ancestors, projects, children, rollup } = detail.data;
  const subtree = subtreeIds(list.data?.groups ?? [], id);
  const projectIds = new Set(projects.map(project => project.id));
  const approval = approvals.find(item => projectIds.has(item.projectId) || subtree.has(list.data?.membership[item.projectId] ?? ''));
  const childToMove = dialog && typeof dialog === 'object' && 'childId' in dialog ? children.find(child => child.id === dialog.childId) : undefined;
  const blocked = detail.loading || !!detail.error;
  const libraryBlocked = library.loading || !!library.error || !library.data;
  const blockers = [
    children.length ? t('blockingChildren', { count: children.length }) : '',
    projects.length ? t('blockingProjects', { count: projects.length }) : '',
    library.data?.skills.some(item => item.groupId === id) ? t('blockingSkills') : '',
    library.data?.templates.some(item => item.groupId === id) ? t('blockingTemplates') : '',
    libraryBlocked ? t('blockingUnknown') : '',
  ].filter(Boolean);
  return <Page className="min-w-0 space-y-5 px-4 sm:px-8">
    <nav aria-label={t('breadcrumb')}><ol className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      {ancestors.map(item => <li key={item.id} className="flex min-w-0 items-center gap-2"><a className="break-all underline-offset-4 hover:underline" href={viewHash(`group:${item.id}`)}>{item.name}</a><ChevronRight className="size-3 shrink-0" aria-hidden="true" /></li>)}
      <li className="min-w-0 break-all text-foreground" aria-current="page">{group.name}</li>
    </ol></nav>
    <header className="space-y-3 border-b border-border pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1"><h1 className="flex items-start gap-2 break-all font-display text-2xl font-semibold"><Folder className="mt-1 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />{group.name}</h1>
          <p className="break-all text-sm text-muted-foreground">{group.path}{group.archived ? ` · ${t('archived')}` : ''}</p></div>
        <Button type="button" variant="outline" size="sm" disabled={detail.loading} onClick={refresh}><RefreshCw aria-hidden="true" />{t('refresh')}</Button>
      </div>
      {group.description && <p className="whitespace-pre-wrap break-words text-sm">{group.description}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={blocked} onClick={() => setDialog('edit')}><Pencil aria-hidden="true" />{t('editGroup')}</Button>
        <Button type="button" variant="outline" size="sm" disabled={blocked} onClick={() => setDialog('move')}><FolderSymlink aria-hidden="true" />{t('moveGroup')}</Button>
        <Button type="button" variant="outline" size="sm" disabled={blocked} onClick={() => setDialog('archive')}><Archive aria-hidden="true" />{t(group.archived ? 'restore' : 'archive')}</Button>
        <Button type="button" variant={blockers.length ? 'outline' : 'destructive'} size="sm" disabled={blocked} onClick={() => setDialog('delete')}><Trash2 aria-hidden="true" />{t(blockers.length ? 'deleteStatus' : 'delete')}</Button>
      </div>
    </header>
    <ReadFeedback error={detail.error} loading={detail.loading} retry={refresh} />
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList aria-label={group.name} className="h-auto flex-wrap justify-start">{tabs.map(value => <TabsTrigger key={value} value={value}>{t(value)}</TabsTrigger>)}</TabsList>
      <TabsContent value="overview"><Overview rollup={rollup} approvalId={approval?.id} /></TabsContent>
      <TabsContent value="children" className="space-y-4">
        <section className={section}><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{t('projects')}</h2>
          {!group.archived && <Button type="button" size="sm" disabled={blocked} onClick={() => onNewProject(id)}><Plus aria-hidden="true" />{t('newProject')}</Button>}</div>
          {projects.length ? <ul className="divide-y divide-border">{projects.map(project => <li key={project.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <a className="break-all underline" href={viewHash(`project:${project.id}`)}>{project.disposition === 'archived' ? t('archivedName', { name: project.name }) : project.name}</a>
            <Button type="button" size="sm" variant="outline" disabled={blocked} onClick={() => setDialog({ projectId: project.id, name: project.name })} aria-label={`${t('move')}: ${project.name}`}>{t('move')}</Button>
          </li>)}</ul> : <p className="text-sm text-muted-foreground">{t('noProjects')}</p>}
        </section>
        <section className={section}><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{t('subgroups')}</h2>
          {!group.archived && group.depth < GROUP_MAX_DEPTH && <Button type="button" size="sm" disabled={blocked} onClick={() => setDialog('child')}><FolderPlus aria-hidden="true" />{t('newGroup')}</Button>}</div>
          {!group.archived && group.depth >= GROUP_MAX_DEPTH && <p className="text-sm text-muted-foreground">{t('depthLimit', { max: GROUP_MAX_DEPTH })}</p>}
          {children.length ? <ul className="divide-y divide-border">{children.map(child => <li key={child.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <a className="break-all underline" href={viewHash(`group:${child.id}`)}>{child.archived ? t('archivedName', { name: child.name }) : child.name}</a>
            <Button type="button" size="sm" variant="outline" disabled={blocked} onClick={() => setDialog({ childId: child.id })} aria-label={`${t('move')}: ${child.name}`}>{t('move')}</Button>
          </li>)}</ul>
            : <p className="text-sm text-muted-foreground">{t('noChildren')}</p>}
        </section>
      </TabsContent>
      <TabsContent value="settings" forceMount hidden={tab !== 'settings'}><GroupSettings detail={detail.data} blocked={blocked} /></TabsContent>
      <TabsContent value="library"><GroupLibrary groupId={id} library={library.data} loading={library.loading} error={library.error} /></TabsContent>
    </Tabs>
    {dialog === 'edit' && <GroupEditor group={group} close={close} blocked={blocked} readError={detail.error} />}
    {dialog === 'child' && <GroupEditor parentId={group.id} close={close} onCreated={childId => onNavigate(`group:${childId}`)} />}
    {dialog === 'move' && <MoveGroupDialog group={group} close={close} blocked={blocked} readError={detail.error} />}
    {childToMove && <MoveGroupDialog group={childToMove} close={close} blocked={blocked} readError={detail.error} />}
    {(dialog === 'archive' || dialog === 'delete') && <GroupConfirmation group={group} deleting={dialog === 'delete'} blockers={blockers}
      blocked={blocked || dialog === 'delete' && libraryBlocked} readError={detail.error ?? (dialog === 'delete' ? library.error : undefined)}
      close={close} onDeleted={() => onNavigate(group.parentId ? `group:${group.parentId}` : 'overview')} />}
    {dialog && typeof dialog === 'object' && 'projectId' in dialog && <MoveProjectDialog {...dialog} currentGroup={id} store={store} close={close} />}
    {list.error && <ReadFeedback error={list.error} loading={list.loading} retry={refresh} />}
  </Page>;
}
