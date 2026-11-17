import { useEffect, useRef, useState } from 'react';
import type { PortalAction, PortalActionRequest, PortalStats } from '@factory/contracts';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Panel, PageHeader } from '@/components/app';
import { Select } from '../components/Select';
import { Page } from '../components/Page';
import { useT } from '../i18n';
import type { Store } from '../state/store';

type Games = Awaited<ReturnType<Store['portalGames']>>['games'];
type Audit = Awaited<ReturnType<Store['portalAudit']>>['entries'];
export function PortalGames({ store }: { store: Store }) {
  const t = useT(), [games, setGames] = useState<Games>([]), [stats, setStats] = useState<PortalStats | null>(null);
  const [audit, setAudit] = useState<Audit>([]), [actions, setActions] = useState<PortalAction[]>([]);
  const [game, setGame] = useState(''), [days, setDays] = useState('7'), [version, setVersion] = useState('');
  const [reason, setReason] = useState(''), [refresh, setRefresh] = useState(0), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(false), [proposed, setProposed] = useState(false), locked = useRef(false);
  const selected = games.find(g => g.id === game);
  useEffect(() => {
    let active = true; setLoading(true); setError(false); setStats(null);
    void (async () => {
      const [listed, history, changes, current] = await Promise.all([store.portalGames(), store.portalAudit(game || undefined), store.portalActions(), store.portalStats(game ? { game } : {})]);
      const from = new Date(Date.parse(`${current.to}T00:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10);
      const data = days === '30' ? await store.portalStats({ ...(game ? { game } : {}), from, to: current.to }) : current;
      if (active) { setGames(listed.games); setAudit(history.entries); setActions(changes.actions); setStats(data); }
    })().catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [store, game, days, refresh]);
  const propose = async (body: PortalActionRequest) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(false); setProposed(false);
    try { await store.proposePortalAction(body); setProposed(true); setRefresh(v => v + 1); await store.loadGlobalInbox(); }
    catch { setError(true); }
    finally { locked.current = false; setBusy(false); }
  };
  const reconcile = async (id: string) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(false);
    try { await store.reconcilePortalAction(id); setRefresh(v => v + 1); }
    catch { setError(true); }
    finally { locked.current = false; setBusy(false); }
  };
  return <Page className="min-w-0"><div className="mx-auto max-w-6xl space-y-5">
    <PageHeader title={t('portalUi.games')} />
    <div className="flex flex-wrap items-end gap-3">
      <label className="w-60 max-w-full space-y-1"><span>{t('portalUi.game')}</span><Select value={game} onValueChange={value => { setGame(value); setVersion(''); }} options={[{ value: '', label: t('portalUi.all') }, ...games.map(g => ({ value: g.id, label: `${g.name} (${g.id})` }))]} /></label>
      <label className="w-40 space-y-1"><span>{t('portalUi.period')}</span><Select value={days} onValueChange={setDays} options={[{ value: '7', label: t('portalUi.days7') }, { value: '30', label: t('portalUi.days30') }]} /></label>
      <Button variant="outline" disabled={busy || loading} onClick={() => setRefresh(v => v + 1)}>{t('portalUi.refresh')}</Button>
    </div>
    {loading && <p role="status">{t('viewStates.loading')}</p>}
    {error && <p role="alert" className="text-destructive">{t('portalUi.error')}</p>}
    {proposed && <Panel role="status"><p>{t('portalUi.proposed')}</p><a className="underline" href="#/attention">{t('portalUi.attention')}</a></Panel>}
    <Panel className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">{t('portalUi.games')}</caption><thead><tr>{['game', 'id', 'enabled', 'version', 'last7', 'rooms'].map(key => <th className="p-2" key={key} scope="col">{t(`portalUi.${key}`)}</th>)}</tr></thead><tbody>
      {games.map(g => <tr key={g.id} className="border-t border-border"><td className="p-2"><Button variant="link" className="h-auto p-0" onClick={() => { setGame(g.id); setVersion(''); }}>{g.name}</Button></td><td className="p-2">{g.id}</td><td className="p-2"><Badge variant={g.enabled ? 'secondary' : 'outline'}>{t(g.enabled ? 'portalUi.enabled' : 'portalUi.disabled')}</Badge></td><td className="p-2">{g.currentVersion ?? '—'}</td><td className="p-2">{g.last7Days}</td><td className="p-2">{stats?.live.byGame[g.id]?.rooms ?? '—'}</td></tr>)}
    </tbody></table>{!games.length && !loading && <p>{t('portalUi.empty')}</p>}</Panel>
    {selected && <Panel className="space-y-3"><h2 className="font-medium">{selected.name}</h2><label className="block max-w-lg space-y-1"><span>{t('portalUi.reason')}</span><Input value={reason} maxLength={1000} disabled={busy} onChange={e => setReason(e.target.value)} /></label>
      <div className="flex flex-wrap items-end gap-3"><Button disabled={busy} onClick={() => { void propose({ action: selected.enabled ? 'disable' : 'enable', game: selected.id, reason }); }}>{t(selected.enabled ? 'portalUi.disable' : 'portalUi.enable')}</Button>
        <label className="w-44 space-y-1"><span>{t('portalUi.version')}</span><Select value={version} onValueChange={setVersion} disabled={busy} placeholder={t('portalUi.version')} options={selected.versions.map(v => ({ value: String(v.version), label: `v${v.version}` }))} /></label>
        <Button variant="outline" disabled={busy || !selected.versions.some(v => String(v.version) === version)} onClick={() => { void propose({ action: 'set-version', game: selected.id, version: Number(version), reason }); }}>{t('portalUi.setVersion')}</Button>
        {selected.projectId && <Button variant="outline" disabled={busy} onClick={() => { void propose({ action: 'publish', game: selected.id, reason }); }}>{t('portalUi.publish')}</Button>}
      </div></Panel>}
    {stats && <Panel className="space-y-4"><p>{stats.from} → {stats.to} · {t('portalUi.rooms')}: {stats.live.rooms} · {t('portalUi.online')}: {stats.live.onlineUsers}</p>
      <p>{t('portalUi.matches')}: {stats.totals.matches} · {t('portalUi.players')}: {stats.totals.players} · {t('portalUi.newUsers')}: {stats.totals.newUsers}</p>
      {stats.games.map(g => <section key={g.id} className="space-y-2 border-t border-border pt-3"><h2 className="font-medium">{g.name}</h2><p className="text-sm">{t('portalUi.players')}: {g.players.registered + g.players.guests} ({t('portalUi.registered')}: {g.players.registered}, {t('portalUi.guests')}: {g.players.guests}) · {t('portalUi.botWins')}: {g.botWins} · {t('portalUi.draws')}: {g.draws} · {t('portalUi.duration')}: {g.avgDurationSec ?? '—'}</p>
        <div aria-label={`${g.name}: ${t('portalUi.daily')}`} className="space-y-1">{g.perDay.map(day => <div key={day.date} className="flex items-center gap-2 text-xs"><span className="w-20 shrink-0">{day.date}</span><div className="h-3 min-w-0 flex-1 rounded bg-secondary"><div className="h-full rounded bg-primary" style={{ width: `${day.matches / Math.max(1, ...g.perDay.map(d => d.matches)) * 100}%` }} /></div><span className="w-10 text-right">{day.matches}</span></div>)}</div>
      </section>)}
    </Panel>}
    <Panel className="space-y-3"><h2 className="text-lg font-medium">{t('portalUi.actions')}</h2>{!actions.length && <p>{t('portalUi.empty')}</p>}{actions.map(a => <div key={a.id} className="flex flex-wrap items-center gap-3 border-t border-border py-3"><div className="min-w-0 flex-1"><p className="break-words">{a.gameId} · {t(`portalUi.${a.action === 'set-version' ? 'setVersion' : a.action}`)} {a.version ? `v${a.version}` : ''}</p><p className="break-words text-sm text-muted-foreground">{a.reason}</p><time className="text-xs" dateTime={a.createdAt}>{a.createdAt}</time>{a.error && <p className="text-sm">{a.error}</p>}</div><Badge variant="outline">{t(`portalUi.states.${a.state}`)}</Badge>{a.state === 'unknown' && <Button variant="outline" disabled={busy} onClick={() => { void reconcile(a.id); }}>{t('portalUi.reconcile')}</Button>}{a.state === 'proposed' && <a className="text-sm underline" href="#/attention">{t('portalUi.attention')}</a>}</div>)}</Panel>
    <Panel className="space-y-3 overflow-x-auto"><h2 className="text-lg font-medium">{t('portalUi.audit')}</h2><table className="w-full text-left text-sm"><thead><tr>{['at', 'actor', 'action', 'game'].map(key => <th className="p-2" key={key}>{t(`portalUi.${key}`)}</th>)}</tr></thead><tbody>{audit.map((e, index) => <tr key={`${e.at}-${index}`} className="border-t border-border"><td className="p-2">{e.at}</td><td className="p-2">{e.actor}</td><td className="p-2">{e.action}: {JSON.stringify(e.from)} → {JSON.stringify(e.to)}</td><td className="p-2">{e.gameId}</td></tr>)}</tbody></table>{!audit.length && <p>{t('portalUi.empty')}</p>}</Panel>
  </div></Page>;
}
