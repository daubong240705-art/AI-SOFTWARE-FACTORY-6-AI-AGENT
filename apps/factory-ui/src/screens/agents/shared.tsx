import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Command } from '@factory/contracts';
import { AgentCommandError, ApiClientError, type ApiClient } from '@/api/client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useT } from '@/i18n';
import { toast } from 'sonner';

export function useAgentLabels() {
  const t = useT();
  return (key: string, values: Record<string, string | number> = {}) =>
    t(`agentsAdmin.${key}`).replace(/\{(\w+)\}/g, (token, name: string) => String(values[name] ?? token));
}

export type Submit = (command: () => Command) => Promise<void>;

export function useRead<Data>(read: ((signal: AbortSignal) => Promise<Data>) | null, refresh = 0) {
  const [state, setState] = useState<{ source: typeof read; refresh: number; data?: Data | undefined; error?: Error }>();
  useEffect(() => {
    if (!read) return;
    const controller = new AbortController();
    void read(controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ source: read, refresh, data });
    }, (error: Error) => {
      if (!controller.signal.aborted) setState(previous => ({ source: read, refresh, error, data: previous?.source === read ? previous.data : undefined }));
    });
    return () => controller.abort();
  }, [read, refresh]);
  const current = state?.source === read ? state : undefined;
  return { data: current?.data, error: current?.refresh === refresh ? current?.error : undefined, loading: Boolean(read && current?.refresh !== refresh) };
}

export function useAgentWrite(api: ApiClient, refresh: () => void): Submit {
  return async build => {
    const command = build();
    try {
      await api.sendAgentCommand(command);
    } catch (error) {
      if (error instanceof ApiClientError && (error.code === 'conflict' || error.code === 'not-found')) refresh();
      throw error;
    }
    refresh();
  };
}

export function useWriteFeedback(submit: Submit) {
  const t = useAgentLabels();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function run(build: () => Command, onSuccess?: () => void) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await submit(build);
      toast.success(t('saved'));
      onSuccess?.();
    } catch (failure) { setError(failure); }
    finally { pending.current = false; setBusy(false); }
  }
  return { busy, error, setError, run };
}

export function ErrorText({ error, missingRoute = false }: { error: unknown; missingRoute?: boolean }) {
  const t = useAgentLabels();
  const global = useT();
  if (!error) return null;
  let message = t('errors.unknown');
  const inputMessage = error instanceof AgentCommandError ? error.inputMessage : undefined;
  if (error instanceof ApiClientError) {
    if (missingRoute && error.status === 404) message = t('errors.olderHost');
    else if (error.code === 'conflict') message = t('errors.conflict');
    else if (error.code === 'not-found') message = t('errors.missing');
    else if (error.code === 'unsupported') message = t('errors.unsupported');
    else if (inputMessage) message = inputMessage;
    else message = global(`safeErrors.${error.code ?? error.kind}`);
  }
  return <Alert variant="destructive" className="break-words"><AlertDescription>{message}{inputMessage && inputMessage !== message && <span className="block">{inputMessage}</span>}</AlertDescription></Alert>;
}

export function ReadStatus({ error, loading, missingRoute = false }: { error?: Error | undefined; loading: boolean; missingRoute?: boolean }) {
  const t = useAgentLabels();
  return error ? <ErrorText error={error} missingRoute={missingRoute} /> : loading ? <p role="status" className="text-sm text-muted-foreground">{t('loading')}</p> : null;
}

export function Field({ label, invalid, hint, children }: { label: string; invalid?: string | undefined; hint?: string | undefined; children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode }) {
  const id = useId();
  return <div className="grid min-w-0 gap-2">
    <Label htmlFor={id}>{label}</Label>
    {children({ id, 'aria-invalid': !!invalid, ...(invalid || hint ? { 'aria-describedby': `${id}-help` } : {}) })}
    {(invalid || hint) && <p id={`${id}-help`} className={`text-xs ${invalid ? 'text-destructive' : 'text-muted-foreground'}`}>{invalid ?? hint}</p>}
  </div>;
}

export function AdminDialog({ title, icon, description, close, busy, wide, children, footer, onSubmit }: {
  title: string; icon?: ReactNode; description: string; close: () => void; busy?: boolean; wide?: boolean; children: ReactNode; footer?: ReactNode; onSubmit?: () => void;
}) {
  function submit(event: FormEvent) { event.preventDefault(); if (!busy) onSubmit?.(); }
  return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}>
    <DialogContent showCloseButton={!busy} className={`max-h-[90dvh] gap-0 overflow-hidden p-0 ${wide ? 'sm:max-w-3xl' : ''}`}>
      <form noValidate onSubmit={submit} className="flex max-h-[90dvh] min-w-0 flex-col">
        <DialogHeader className="shrink-0 p-5 pr-12"><DialogTitle className="flex items-center gap-2 break-words">{icon}<span className="min-w-0">{title}</span></DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <div className="min-h-0 space-y-4 overflow-auto px-5 pb-5">{children}</div>
        {footer && <DialogFooter className="shrink-0 border-t border-border p-4">{footer}</DialogFooter>}
      </form>
    </DialogContent>
  </Dialog>;
}

export function DialogButtons({ close, label, busy, disabled, destructive }: { close: () => void; label: string; busy?: boolean; disabled?: boolean; destructive?: boolean }) {
  const t = useAgentLabels();
  return <>
    <Button data-testid="dialog-cancel" type="button" variant="outline" disabled={busy} onClick={close}>{t('cancel')}</Button>
    <Button data-testid={destructive ? 'dialog-confirm' : 'dialog-save'} type="submit" variant={destructive ? 'destructive' : 'default'} disabled={busy || disabled}>{busy ? t('loading') : label}</Button>
  </>;
}
