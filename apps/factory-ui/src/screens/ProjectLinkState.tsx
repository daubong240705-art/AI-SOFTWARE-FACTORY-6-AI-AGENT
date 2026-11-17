import { useEffect, useState } from 'react';
import { ApiClientError } from '@/api/client';
import { ErrorNotice } from '@/components/ErrorNotice';
import { LoadingState } from '@/components/LoadingState';
import { Page } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import type { Store, StoreError } from '@/state/store';

/** A project missing from the active list can still be a valid historical link. */
export function ProjectLinkState({ store, projectId, onOverview }: { store: Store; projectId: string; onOverview: () => void }) {
  const t = useT();
  const [archived, setArchived] = useState(false), [error, setError] = useState<StoreError | null>(null), [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true; setArchived(false); setError(null);
    void store.getProject(projectId).then(async response => {
      if (!current) return;
      if (response.project.disposition === 'archived') setArchived(true);
      else { await store.loadProjects(); if (current) await store.selectProject(projectId); }
    }).catch((caught: unknown) => {
      if (current) setError({ kind: caught instanceof ApiClientError ? caught.kind : 'unexpected',
        ...(caught instanceof ApiClientError && caught.code ? { code: caught.code } : {}), message: '' });
    });
    return () => { current = false; };
  }, [store, projectId, retry]);
  if (!archived && !error) return <LoadingState />;
  return <Page className="space-y-4 py-12">
    {archived ? <><h1 className="font-display text-xl">{t('projectArchive.archived')}</h1><p className="text-muted-foreground">{t('projectArchive.archivedDescription')}</p></> : error && <ErrorNotice error={error} />}
    <div className="flex gap-2"><Button onClick={onOverview}>{t('nav.overview')}</Button>{error && <Button variant="outline" onClick={() => setRetry(value => value + 1)}>{t('errors.retry')}</Button>}</div>
  </Page>;
}
