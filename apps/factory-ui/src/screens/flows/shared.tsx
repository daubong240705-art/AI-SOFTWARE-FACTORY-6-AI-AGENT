import { createContext, useContext, useEffect, useId, useReducer, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { Command, FlowDefinition, FlowRunSummary } from '@factory/contracts';
import { ApiClientError, type ApiClient } from '@/api/client';
import { openProjectEvents } from '@/api/events';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { i18n, useT } from '@/i18n';
import { AdminDialog, Choice, Field, useRead } from '../agents/shared';

export { Choice, Field, useRead };
export const baseUrl = import.meta.env.DEV ? '/api' : '';

export function useFlowLabels() {
  const translate = useT();
  return (key: string, values: Record<string, string | number> = {}) =>
    translate(`flowsUi.${key}`).replace(/\{(\w+)\}/g, (token, name: string) => String(values[name] ?? token));
}

export function useFlowEvents(projectId: string, refresh: () => void, routeId?: string) {
  const [epoch, reconnect] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    const stream = openProjectEvents({ projectId, baseUrl, onSnapshotRequired: () => { refresh(); reconnect(); },
      onEvent: ({ payload }) => {
        if (payload.type === 'entity.changed' && (payload.entity.kind === 'flow' || payload.entity.kind === 'flow-run') &&
          (!routeId || payload.entity.id === routeId)) refresh();
      } });
    return stream.close;
  }, [projectId, refresh, routeId, epoch]);
}

export function useFlowWrite(api: ApiClient, refresh: () => void) {
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function run(build: () => Command, success?: () => void) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      const { receipt } = await api.sendFlowCommand(build());
      if (alive.current) {
        if (receipt.state === 'completed') success?.();
        else setError('accepted');
        refresh();
      }
    } catch (failure) {
      if (alive.current) {
        setError(failure);
        if (failure instanceof ApiClientError && failure.code === 'conflict') refresh();
      }
    } finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  return { busy, error, setError, run };
}

export function FlowError({ error, missingRoute = false }: { error: unknown; missingRoute?: boolean }) {
  const label = useFlowLabels();
  const t = useT();
  if (!error) return null;
  if (missingRoute && error instanceof ApiClientError && error.status === 404)
    return <p role="status" className="rounded-xl border p-6 text-muted-foreground">{label('olderHost')}</p>;
  const key = error instanceof ApiClientError ? error.code ?? error.kind : undefined;
  return <p role={error === 'accepted' ? 'status' : 'alert'} className="break-words text-sm text-destructive">{error === 'accepted' ? label('accepted')
    : key ? t(`safeErrors.${key}`) : label('invalid')}</p>;
}

export function FlowDialog({ title, description, close, busy, disabled, onSubmit, submit, children, wide = false }: {
  title: string; description: string; close: () => void; busy: boolean; disabled?: boolean; onSubmit: () => void;
  submit: string; children: ReactNode; wide?: boolean;
}) {
  const label = useFlowLabels();
  return <AdminDialog title={title} description={description} close={close} busy={busy} wide={wide} onSubmit={onSubmit} footer={<>
    <Button data-testid="flow-cancel" type="button" variant="outline" disabled={busy} onClick={close}>{label('close')}</Button>
    <Button data-testid={wide ? 'flow-start-run' : 'flow-submit'} type="submit" disabled={busy || disabled}>{busy ? label('loading') : submit}</Button>
  </>}>{children}</AdminDialog>;
}

export function RunState({ run }: { run: FlowRunSummary }) {
  const label = useFlowLabels();
  return <span className="inline-flex flex-wrap gap-1">
    <Badge variant={run.state === 'failed' ? 'destructive' : 'outline'} className={run.state === 'succeeded' ? 'border-emerald-500/50' : ''}>{label(`state.${run.state}`)}</Badge>
    {run.test && <Badge variant="secondary">{label('test')}</Badge>}
  </span>;
}

export function timestamp(value: string | null) {
  return value ? new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '-';
}

export function duration(start: string | null, end: string | null) {
  if (!start) return '-';
  const seconds = Math.max(0, Math.floor(((end ? Date.parse(end) : Date.now()) - Date.parse(start)) / 1000));
  return `${seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ` : ''}${Math.floor(seconds / 60) % 60}m ${seconds % 60}s`;
}

export function NodePicker({ definition, current, onChange }: { definition: FlowDefinition; current?: string | undefined; onChange: (id: string) => void }) {
  const label = useFlowLabels();
  const id = useId();
  return <div className="flex min-w-0 items-center gap-2 text-sm">
    <label htmlFor={id} className="shrink-0 text-muted-foreground">{label('selectNode')}</label>
    <Choice id={id} value={current ?? ''} onChange={event => onChange(event.target.value)}>
      <option value="">{label('none')}</option>
      {definition.nodes.map(node => <option key={node.id} value={node.id}>{node.title || node.id} ({node.id})</option>)}
    </Choice>
  </div>;
}

export const PendingJson = createContext<Dispatch<SetStateAction<number>> | null>(null);

export function JsonField<Value>({ title, value, parse, onChange }: { title: string; value: Value; parse: (raw: unknown) => Value; onChange: (value: Value) => void }) {
  const label = useFlowLabels();
  const [edited, setEdited] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const setPending = useContext(PendingJson);
  const pending = edited !== null;
  useEffect(() => {
    if (!pending || !setPending) return;
    setPending(count => count + 1);
    return () => setPending(count => count - 1);
  }, [pending, setPending]);
  function apply() {
    try { onChange(parse(JSON.parse(edited ?? ''))); setEdited(null); setInvalid(false); }
    catch { setInvalid(true); }
  }
  return <div className="space-y-2"><Field label={title} invalid={invalid ? label('invalidJson') : undefined}>{props =>
    <Textarea {...props} rows={3} spellCheck={false} className="font-mono text-xs" value={edited ?? JSON.stringify(value, null, 2) ?? ''} onChange={event => { setEdited(event.target.value); setInvalid(false); }} />}
  </Field>{pending && <div className="flex flex-wrap gap-1"><Button type="button" size="sm" variant="outline" onClick={apply}>{label('applyJson')}</Button><Button type="button" size="sm" variant="ghost" onClick={() => { setEdited(null); setInvalid(false); }}>{label('discardJson')}</Button></div>}</div>;
}
