import { useEffect, useId, useRef, useState } from 'react';
import { requestsTriage, requestsMessage } from '../api/commands';
import { requestStates } from '../api/m3Models';
import type { Store } from '../state/store';
import { Section, StatusDot } from '@/components/app';
import { toneOf } from '@/lib/status';
import { Button } from '@/components/ui/button';
import { Dialog } from '../components/Dialog';
import { useT } from '../i18n';
import { AttentionPane } from './attention/AttentionPane';
import { AreaState, Select, useM3Command } from './M3Shared';

export function Requests({ store, hideEmpty = false }: { store: Store; hideEmpty?: boolean }) {
  const t = useT(); const state = store.useStoreSelector(s => s); const [filter, setFilter] = useState(''); const [team, setTeam] = useState(''); const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => store.watchM3('requests', () => store.loadRequests({ ...(filter ? { state: filter } : {}), ...(team ? { team } : {}) })), [store, filter, team]);
  useEffect(() => { void store.loadTeams(); }, [store]);
  if (hideEmpty && !state.m3.requests.length && !filter && !team) return null;
  return <Section title={t('m3.requests')}><div className="task-actions"><Select label={t('m3.state')} value={filter} onChange={setFilter} options={[['', t('m3.all')], ...requestStates.map(v => [v, t(`m3.values.${v}`)] as [string,string])]} /><Select label={t('m3.team')} value={team} onChange={setTeam} options={[['', t('m3.all')], ...state.m3.teams.map(v => [v.id, v.name] as [string,string])]} /></div>
    <AreaState store={store} area="requests" empty={!state.m3.requests.length} /><ul className="task-list space-y-6">{[...state.m3.requests].sort((a,b) => Date.parse(b.createdAt)-Date.parse(a.createdAt)).map(item => <li key={item.taskId}><div className="space-y-2 border-b border-border py-3 text-sm"><Button type="button" variant="outline" onClick={() => setSelected(item.taskId)}>{item.code} {item.subject}</Button><p>{item.kind} | <StatusDot tone={toneOf('task', item.taskState)} label={t(`m3.values.${item.taskState}`)} /> | <StatusDot tone={['submitted', 'need-info'].includes(item.triageState) ? 'need' : toneOf('task', item.triageState)} label={t(`m3.values.${item.triageState}`)} /> | {item.targetTeamName}</p><p>{t('m3.hop')}: {item.hop} | {t('m3.rounds')}: {item.rounds} | {t('m3.waiting')}: {item.waiting}</p><time dateTime={item.createdAt}>{item.createdAt}</time></div></li>)}</ul>{selected && <RequestPanel key={selected} store={store} taskId={selected} onClose={() => setSelected(null)} />}</Section>;
}
export function RequestPanel({ store, taskId, onClose, inline = false, onSuccess }: { store: Store; taskId: string; onClose: () => void; inline?: boolean; onSuccess?: () => void }) {
  const t = useT(); const id = useId(); const state = store.useStoreSelector(s => s); const item = state.m3.requestDetails[taskId];
  const reasonInput = useRef<HTMLTextAreaElement>(null);
  const [decision, setDecision] = useState('accept'); const [reason, setReason] = useState(''); const [target, setTarget] = useState(''); const [owner, setOwner] = useState(''); const [note, setNote] = useState('');
  useEffect(() => store.watchM3(`request:${taskId}`, () => store.loadRequest(taskId)), [store, taskId]);
  useEffect(() => { void store.loadTeams(); }, [store]);
  useEffect(() => store.watchM3('request-targets', store.loadRequestTargets), [store]);
  const refresh = async () => { await Promise.all([store.refreshM3('requests'), store.loadRequest(taskId), store.loadRequestTargets(), store.loadInbox(), store.loadGlobalInbox()]); };
  const command = useM3Command(store, refresh, created => { if (created.type === 'requests.triage') { store.announceDecision(); onSuccess?.(); } }); const projectId = state.selectedProjectId;
  const valid = reason.trim().length > 0 && reason.length <= 1000 && (!['redirect','merge'].includes(decision) || !!target);
  const row = state.m3.requestTargets.find(r => r.taskId === taskId); const targetTeam = state.m3.teams.find(team => team.name === row?.targetTeamName);
  const triageActions = <>
    <Button type="submit" form={inline ? `${id}-triage` : undefined} data-attention-primary={inline ? '' : undefined} disabled={!valid || command.busy}>{t(inline ? `m3.values.${decision}` : 'm3.submit')}</Button>
    {inline && <Button type="button" variant="outline" data-attention-changes disabled={command.busy} onClick={() => { setDecision('need-info'); reasonInput.current?.focus(); }}>{t('m3.values.need-info')}</Button>}
  </>;
  const body = <><AreaState store={store} area={`request:${taskId}`} />{item && <><p>{t('m3.state')}: {t(`m3.values.${item.state}`)} | {t(`m3.values.${item.triageState}`)}</p><p>{t('m3.followers')}: {item.followers} | {t('m3.waiting')}: {item.waiting}</p><Section title={t('m3.thread')}><ol className="list-decimal space-y-3 pl-5">{item.thread.map(message => <li key={message.seq}><strong>{message.author}</strong> <time>{message.at}</time><p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{message.text}</p></li>)}</ol></Section><Section title={t('m3.deliverables')}><ul className="list-disc space-y-1 pl-5">{item.deliverables.map(d => <li key={`${d.artifactId}:${d.version}`}>{d.title} | {d.version} | {d.status}</li>)}</ul></Section>
    {['submitted','need-info'].includes(item.triageState) && item.state === 'proposed' && <form className="space-y-6" id={`${id}-triage`} onSubmit={e => { e.preventDefault(); if (!valid || !projectId || command.busy) return; void command.run(requestsTriage({ projectId, requestTaskId: taskId, decision: decision as 'accept'|'need-info'|'decline'|'redirect'|'merge', reason, ...(decision === 'accept' && owner ? { ownerSeatId: owner } : {}), ...(decision === 'redirect' ? { redirectTeamId: target } : {}), ...(decision === 'merge' ? { mergeIntoTaskId: target } : {}) })); }}><h3>{t('m3.triage')}</h3><fieldset className="space-y-3" disabled={command.busy}><Select label={t('m3.decision')} value={decision} onChange={v => { setDecision(v); setTarget(''); }} options={['accept','need-info','decline','redirect','merge'].map(v => [v,t(`m3.values.${v}`)])} /><label className="field">{t('m3.reason')}<textarea className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:ring-2 focus-visible:ring-ring" ref={reasonInput} required minLength={1} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
    {decision === 'accept' && <Select label={t('m3.owner')} value={owner} onChange={setOwner} options={[['',t('m3.automatic')], ...(targetTeam?.seats ?? []).map(s => [s.id,s.name] as [string,string])]} />}
    {decision === 'redirect' && <Select required label={t('m3.redirectTeam')} value={target} onChange={setTarget} options={[['',t('m3.choose')], ...state.m3.teams.filter(v => v.lifecycle === 'active' && v.id !== targetTeam?.id).map(v => [v.id,v.name] as [string,string])]} />}
    {decision === 'merge' && <Select required label={t('m3.mergeTarget')} value={target} onChange={setTarget} options={[['',t('m3.choose')], ...state.m3.requestTargets.filter(v => !['declined','redirected','merged'].includes(v.triageState) && v.taskId !== taskId && !['done','cancelled','declined','superseded','failed'].includes(v.taskState)).map(v => [v.taskId,`${v.code} ${v.subject}`] as [string,string])]} />}
    {!inline && triageActions}</fieldset></form>}
    <form className="space-y-6" onSubmit={e => { e.preventDefault(); if (projectId && note.trim() && note.length <= 2000 && !command.busy) void command.run(requestsMessage({ projectId, requestTaskId: taskId, text: note })); }}><label className="field">{t('m3.note')}<textarea className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:ring-2 focus-visible:ring-ring" maxLength={2000} required value={note} disabled={command.busy} onChange={e => setNote(e.target.value)} /></label><Button type="submit" disabled={command.busy || !note.trim() || note.length > 2000}>{t('m3.sendNote')}</Button></form></>}{!inline && command.notice}</>;
  const actions = <><div className="contents [&>div]:basis-full">{command.notice}</div>{item && ['submitted','need-info'].includes(item.triageState) && item.state === 'proposed' && triageActions}</>;
  const content = <div className="space-y-6"><Button type="button" variant="outline" onClick={onClose}>{t('m3.close')}</Button><h2 id={id}>{item ? `${item.code} ${item.subject}` : t('m3.requests')}</h2>{body}</div>;
  const inboxItem = state.globalInbox.requests?.find(request => request.taskId === taskId && request.projectId === projectId);
  return inline ? <AttentionPane kind={t('attention.kinds.request')} projectId={projectId ?? ''} projectName={inboxItem?.projectName ?? state.projects.find(project => project.id === projectId)?.name ?? t('overview.project')} code={item?.code ?? inboxItem?.code} since={inboxItem?.createdAt} title={item?.subject ?? inboxItem?.subject ?? t('m3.requests')} titleId={id} actions={actions}>{body}</AttentionPane> : <Dialog labelledBy={id} onClose={onClose}>{content}</Dialog>;
}
