import { Choice, ChoiceOption } from '@/components/ui/choice';
import { createContext, useCallback, useId, useRef, useState, type ComponentProps } from 'react';
import type { Credential, GroupSummary } from '@factory/contracts';
import { ApiClientError, type ApiClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { i18n, useT } from '@/i18n';
import { toast } from 'sonner';
import { Field, useRead } from '../agents/shared';
import { useGroups } from '../groups/GroupsContext';

export const IntegrationProject = createContext<string | undefined>(undefined);

export function useIntegrationLabels() {
  const translate = useT();
  return (key: string, values: Record<string, string> = {}) => translate(`integrationsUi.${key}`)
    .replace(/\{(\w+)\}/g, (token, name: string) => values[name] ?? token);
}

export function useProjectIntegrations(api: ApiClient, projectId?: string) {
  const { list, refresh: refreshGroups } = useGroups();
  const groupId = projectId ? list.data?.membership[projectId] : undefined;
  const [attempt, setAttempt] = useState(0);
  const read = useCallback(async (signal: AbortSignal) => {
    const result = await api.listIntegrations(groupId, signal);
    return groupId ? result.integrations : result.integrations.filter(item => item.scopeGroupId === null);
  }, [api, groupId, projectId]);
  const result = useRead(projectId && list.data && !list.error ? read : null, attempt);
  return { ...result, loading: !!projectId && (list.loading || result.loading), error: projectId ? list.error ?? result.error : undefined,
    refresh: () => { if (list.error) refreshGroups(); setAttempt(value => value + 1); } };
}

export function scopeName(groups: readonly GroupSummary[], id: string | null, label: ReturnType<typeof useIntegrationLabels>) {
  return id === null ? label('global') : groups.find(group => group.id === id)?.path ?? label('unknownGroup');
}

export function visibleCredentials(credentials: readonly Credential[], groups: readonly GroupSummary[], scope: string | null) {
  const chain = new Set<string | null>([null]);
  while (scope !== null && !chain.has(scope)) {
    chain.add(scope);
    scope = groups.find(group => group.id === scope)?.parentId ?? null;
  }
  return credentials.filter(item => chain.has(item.scopeGroupId));
}

export function ScopeChoice({ groups, value, set, fixed }: { groups: readonly GroupSummary[]; value: string | null; set: (value: string | null) => void; fixed?: boolean }) {
  const t = useIntegrationLabels();
  return <Field label={t('scope')}>{props => <Choice {...props} disabled={fixed} value={value ?? ''} onValueChange={selectedValue => set(selectedValue || null)}>
    <ChoiceOption value="">{t('global')}</ChoiceOption>
    {groups.filter(item => !item.archived || item.id === value).map(item => <ChoiceOption key={item.id} value={item.id}>{item.path}</ChoiceOption>)}
    {value && !groups.some(item => item.id === value) && <ChoiceOption value={value}>{t('unknownGroup')}</ChoiceOption>}
  </Choice>}</Field>;
}

export function CredentialChoice({ credentials, groups, value, onChange, ...props }: Omit<ComponentProps<typeof Choice>, 'value' | 'onValueChange'> & {
  credentials: readonly Credential[]; groups: readonly GroupSummary[]; value: string; onChange: (id: string) => void;
}) {
  const t = useIntegrationLabels();
  return <Choice {...props} value={value} onValueChange={selectedValue => onChange(selectedValue)}>
    <ChoiceOption value="">{t('selectCredential')}</ChoiceOption>
    {value && !credentials.some(item => item.id === value) && <ChoiceOption value={value}>{t('unavailableCredential')}</ChoiceOption>}
    {credentials.map(item => <ChoiceOption key={item.id} value={item.id}>{item.name} — {scopeName(groups, item.scopeGroupId, t)} · {'\u2022\u2022\u2022\u2022'}{item.last4}</ChoiceOption>)}
  </Choice>;
}

export function timestamp(value: string) { return new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }

export function IntegrationError({ error }: { error: unknown }) {
  const t = useIntegrationLabels();
  if (!error) return null;
  const key = error instanceof ApiClientError ? error.detailKey ?? (error.code === 'conflict' ? 'conflict' : error.code === 'not-found' ? 'notFound' : 'requestFailed') : 'requestFailed';
  return <p role="alert" className="text-sm text-destructive">{t(key)}</p>;
}

export function useIntegrationWrite() {
  const t = useIntegrationLabels();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function run(write: () => Promise<unknown>, success: () => void, message = 'saved') {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try { await write(); toast.success(t(message)); success(); }
    catch (failure) { setError(failure); }
    finally { pending.current = false; setBusy(false); }
  }
  return { busy, error, run, conflict: error instanceof ApiClientError && error.nextAction === 'refresh' && !error.detailKey };
}

export function RetryRead({ error, loading, retry }: { error?: Error | undefined; loading?: boolean; retry: () => void }) {
  const t = useIntegrationLabels();
  return <>{loading && <p role="status" className="text-sm text-muted-foreground">{t('loading')}</p>}
    <IntegrationError error={error} />{error && <Button type="button" size="sm" variant="outline" onClick={retry}>{t('refresh')}</Button>}</>;
}

export function NameConfirmation({ name, value, set }: { name: string; value: string; set: (value: string) => void }) {
  const t = useIntegrationLabels();
  const id = useId();
  return <div className="grid gap-2"><label htmlFor={id} className="text-sm">{t('confirmName', { name })}</label>
    <Input data-testid="integration-confirm-name" id={id} value={value} onChange={event => set(event.target.value)} autoComplete="off" /></div>;
}
