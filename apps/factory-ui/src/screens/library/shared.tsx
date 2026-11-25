import type { ReactNode } from 'react';
import type { Command, SkillSummary } from '@factory/contracts';
import { AgentCommandError, ApiClientError } from '@/api/client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { i18n, useT } from '@/i18n';
import { bundledSkillDescriptions } from '@/i18n/bundledSkillDescriptions';
import { AdminDialog, DialogButtons, ErrorText, ReadStatus, useAgentLabels, useWriteFeedback, type Submit } from '../agents/shared';

export function useLibraryLabels() {
  const t = useT();
  return (key: string, values: Record<string, string | number> = {}) =>
    t(`libraryUi.${key}`).replace(/\{(\w+)\}/g, (token, name: string) => String(values[name] ?? token));
}

export const dateTime = (value: string) => new Date(value).toLocaleString(i18n.locale);
export const panelClass = 'min-w-0 space-y-4 rounded-xl border border-border bg-card/60 p-4';

export function skillDescription(skill: SkillSummary) {
  const translation = bundledSkillDescriptions.get(skill.description);
  return i18n.locale === 'vi' && skill.source?.startsWith('pack:') && translation ? translation : skill.description;
}

export function ReadFeedback({ error, loading, retry }: { error: Error | undefined; loading: boolean; retry: () => void }) {
  const t = useAgentLabels();
  return <><ReadStatus error={error} loading={loading} />{error && <Button type="button" variant="outline" size="sm" onClick={retry}>{t('reload')}</Button>}</>;
}

export function LibraryError({ error, stale }: { error: unknown; stale?: boolean }) {
  const t = useLibraryLabels();
  if (stale || (error instanceof ApiClientError && error.code === 'conflict')) {
    const refusal = error instanceof AgentCommandError ? error.inputMessage : undefined;
    return <Alert variant="destructive" className="break-words"><AlertDescription>{t('conflict')}{refusal && <span className="block">{refusal}</span>}</AlertDescription></Alert>;
  }
  return <ErrorText error={error} />;
}

export function PlainText({ children }: { children: string }) {
  return <pre tabIndex={0} className="max-h-96 min-w-0 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/50 p-3 font-mono text-xs">{children}</pre>;
}

export function LibraryRow({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: ReactNode }) {
  return <li><button data-testid="library-row" type="button" aria-pressed={selected} onClick={onSelect} className="w-full min-w-0 space-y-1 rounded-lg border border-border bg-background/60 p-3 text-start hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring aria-pressed:border-ring aria-pressed:bg-muted">
    {children}
  </button></li>;
}

export function DeleteDialog({ name, close, submit, build, blocked, stale, onDeleted }: { name: string; close: () => void; submit: Submit; build: () => Command; blocked: boolean; stale: boolean; onDeleted?: () => void }) {
  const t = useLibraryLabels();
  const agentLabel = useAgentLabels();
  const writer = useWriteFeedback(submit);
  const disabled = blocked || stale || (writer.error instanceof ApiClientError && writer.error.code === 'conflict');
  return <AdminDialog title={t('deleteTitle')} description={t('deleteHelp', { name })} close={close} busy={writer.busy}
    onSubmit={() => { if (!disabled) void writer.run(build, () => { close(); onDeleted?.(); }); }}
    footer={<DialogButtons close={close} label={agentLabel('delete')} busy={writer.busy} disabled={disabled} destructive />}>
    <LibraryError error={writer.error} stale={stale} />
  </AdminDialog>;
}
