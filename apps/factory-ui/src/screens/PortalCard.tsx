import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ProjectTile } from './shell/ProjectTile';
import { useT } from '../i18n';
import type { Store } from '../state/store';

export function PortalCard({ store, projectId, onChat, onGames }: { store: Store; projectId?: string; onChat: (id: string) => void; onGames: () => void }) {
  const t = useT();
  const [portal, setPortal] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void store.getPortal().then(p => { if (active) setPortal(p.configured ? p.projectId : null); }).catch(() => undefined);
    return () => { active = false; };
  }, [store]);
  if (!portal || (projectId && projectId !== portal)) return null;
  if (projectId) return <Button variant="outline" onClick={onGames}>{t('portalUi.games')}</Button>;
  return <div className="relative min-w-0 rounded-xl border border-border bg-card p-4 hover:bg-secondary/50">
    <button type="button" aria-label={t('portalUi.title')} className="absolute inset-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onChat(portal)} />
    <div className="pointer-events-none flex items-start gap-3"><ProjectTile id={portal} name={t('portalUi.title')} className="size-10 rounded-lg" /><div className="min-w-0 space-y-2"><h3 className="text-base font-medium">{t('portalUi.title')}</h3><Button variant="outline" size="sm" className="pointer-events-auto relative" onClick={onGames}>{t('portalUi.games')}</Button></div></div>
  </div>;
}
