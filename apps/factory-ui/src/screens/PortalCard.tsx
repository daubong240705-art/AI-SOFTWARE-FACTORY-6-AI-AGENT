import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/app';
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
  return <Panel className="space-y-3"><h2 className="text-lg font-medium"><Button variant="link" className="h-auto p-0 text-lg" onClick={() => onChat(portal)}>{t('portalUi.title')}</Button></h2><p className="text-sm text-muted-foreground">{t('portalUi.description')}</p><div className="flex flex-wrap gap-2"><Button onClick={() => onChat(portal)}>{t('portalUi.chat')}</Button><Button variant="outline" onClick={onGames}>{t('portalUi.games')}</Button></div></Panel>;
}
