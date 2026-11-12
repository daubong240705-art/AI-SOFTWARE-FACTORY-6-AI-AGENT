import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Folder } from 'lucide-react';
import { ApiClientError } from '@/api/client';
import type { FolderListing } from '@/api/folderModels';
import { ErrorNotice } from '@/components/ErrorNotice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import type { StoreError } from '@/state/store';
import { FolderBreadcrumb } from './FolderBreadcrumb';
import { MascotEmpty } from '@/components/mascot';

type Props = {
  initialPath: string;
  browseFolders: (path?: string, signal?: AbortSignal) => Promise<FolderListing>;
  onChoose: (path: string, isGit: boolean) => void;
  onClose: () => void;
  onReturnFocus: (chosen: boolean) => void;
};
const childPath = (path: string, name: string) => `${path.replace(/\/$/, '')}/${name}`;
function errorDetails(error: unknown): StoreError {
  return error instanceof ApiClientError ? {
    kind: error.kind, message: error.message,
    ...(error.code ? { code: error.code } : {}),
    ...(error.correlationId ? { correlationId: error.correlationId } : {}),
    ...(error.detailKey ? { detailKey: error.detailKey } : {}),
  } : { kind: 'unexpected', message: '' };
}

export function FolderPicker({ initialPath, browseFolders, onChoose, onClose, onReturnFocus }: Props) {
  const t = useT();
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<StoreError | null>(null);
  const [active, setActive] = useState(-1);
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const target = useRef<string | undefined>(undefined);
  const knownGit = useRef(new Map<string, boolean>());
  const list = useRef<HTMLDivElement>(null);
  const chosen = useRef(false);

  const load = useCallback(async (path?: string, fallback = false) => {
    const id = ++request.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    target.current = path;
    list.current?.focus();
    setLoading(true); setError(null); setActive(-1);
    try {
      let result: FolderListing;
      try { result = await browseFolders(path, abort.signal); }
      catch (failure) {
        if (!fallback || !(failure instanceof ApiClientError) || ![403, 404].includes(failure.status ?? 0) || id !== request.current) throw failure;
        target.current = undefined;
        result = await browseFolders(undefined, abort.signal);
      }
      if (id !== request.current || abort.signal.aborted) return;
      for (const entry of result.entries) knownGit.current.set(childPath(result.path, entry.name), entry.isGit);
      setListing(result);
    } catch (failure) {
      if (id === request.current && !abort.signal.aborted) setError(errorDetails(failure));
    } finally {
      if (id === request.current && !abort.signal.aborted) setLoading(false);
    }
  }, [browseFolders]);

  useEffect(() => {
    const path = initialPath.trim();
    void load(path.startsWith('/') ? path : undefined, true);
    return () => { request.current++; controller.current?.abort(); };
  }, [initialPath, load]);

  const entries = loading || error ? [] : listing?.entries ?? [];
  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (!loading && listing?.parent) void load(listing.parent);
    } else if (['ArrowDown', 'ArrowUp'].includes(event.key) && entries.length) {
      event.preventDefault();
      const index = active < 0 ? (event.key === 'ArrowDown' ? 0 : entries.length - 1) :
        (active + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length;
      setActive(index);
      const row = list.current?.querySelectorAll<HTMLButtonElement>('[data-folder]')[index];
      row?.focus(); row?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter' && listing && entries.length) {
      event.preventDefault();
      const entry = entries[Math.max(active, 0)];
      if (entry) void load(childPath(listing.path, entry.name));
    }
  }

  const selectable = listing && !loading && !error && !/^\/mnt(?:\/|$)/i.test(listing.path);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border-border bg-card sm:max-w-xl"
      onOpenAutoFocus={event => { event.preventDefault(); list.current?.focus(); }}
      onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus(chosen.current); }}
      onEscapeKeyDown={event => event.stopPropagation()}>
      <DialogHeader className="text-left">
        <DialogTitle className="font-display text-2xl">{t('folderPicker.title')}</DialogTitle>
        <DialogDescription>{t('folderPicker.description')}</DialogDescription>
      </DialogHeader>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">{listing ? <FolderBreadcrumb listing={listing} onNavigate={path => { void load(path); }} /> : <Skeleton className="h-7 w-48" />}</div>
        <Button type="button" variant="ghost" size="sm" disabled={!listing?.parent || loading} onClick={() => { if (listing?.parent) void load(listing.parent); }}>
          <ArrowUp aria-hidden="true" />{t('folderPicker.up')}
        </Button>
      </div>
      <ScrollArea className="h-64 rounded-lg border border-border bg-background">
        <div ref={list} role="list" tabIndex={0} aria-label={t('folderPicker.folders')} aria-busy={loading}
          onKeyDown={handleKey} className="min-h-62 p-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          {loading ? <div role="status" className="space-y-2 p-2"><span className="sr-only">{t('folderPicker.loading')}</span>{[0, 1, 2, 3, 4].map(row => <Skeleton key={row} className="h-9 w-full" />)}</div> :
            error ? <div className="space-y-3 p-4"><ErrorNotice error={error} /><Button type="button" variant="outline" onClick={() => { void load(target.current); }}>{t('errors.retry')}</Button></div> :
              entries.length === 0 ? <Empty className="min-h-58 p-5"><MascotEmpty seat="FE" compact fallback={<EmptyHeader><EmptyMedia variant="icon"><Folder aria-hidden="true" /></EmptyMedia><EmptyDescription>{t('folderPicker.empty')}</EmptyDescription></EmptyHeader>}><EmptyDescription>{t('folderPicker.empty')}</EmptyDescription></MascotEmpty></Empty> :
                entries.map((entry, index) => <div key={entry.name} role="listitem">
                  <Button type="button" variant="ghost" data-folder tabIndex={-1} onFocus={() => setActive(index)}
                    className={cn('h-auto min-h-10 w-full justify-start gap-3 px-3 py-2 text-left font-normal', active === index && 'bg-secondary')}
                    onClick={() => { if (listing) void load(childPath(listing.path, entry.name)); }}>
                    <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 flex-1 break-all whitespace-normal">{entry.name}</span>
                    {entry.isGit && <Badge variant="outline" className="shrink-0 text-xs">{t('folderPicker.git')}</Badge>}
                  </Button>
                </div>)}
        </div>
      </ScrollArea>
      <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
        <p>{t('folderPicker.scope')}</p>
        {listing?.truncated && !loading && !error && <p role="status">{t('folderPicker.truncated')}</p>}
      </div>
      <div className="-mx-6 space-y-4 border-t border-border px-6 pt-4">
        <p aria-label={t('folderPicker.currentPath')} aria-live="polite" className="break-all font-mono text-xs text-muted-foreground">{listing?.path ?? t('folderPicker.loading')}</p>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>{t('actions.cancel')}</Button>
          <Button type="button" disabled={!selectable} onClick={() => {
            if (!selectable) return;
            chosen.current = true;
            onChoose(listing.path, knownGit.current.get(listing.path) === true);
          }}>{t('folderPicker.choose')}</Button>
        </DialogFooter>
      </div>
    </DialogContent>
  </Dialog>;
}
