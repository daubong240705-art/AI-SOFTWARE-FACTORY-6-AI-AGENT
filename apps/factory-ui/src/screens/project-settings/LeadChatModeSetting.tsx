import { useId, useState } from 'react';
import { type Command } from '@factory/contracts';
import { setLeadChatMode } from '@/api/commands';
import { Choice, ChoiceOption } from '@/components/ui/choice';
import { ErrorNotice } from '@/components/ErrorNotice';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';

export function LeadChatModeSetting({ store, projectId }: { store: Store; projectId: string }) {
  const t = useT(); const id = useId();
  const project = store.useStoreSelector(state => state.projects.find(value => value.id === projectId));
  const [command, setCommand] = useState<Command>();
  const [busy, setBusy] = useState(false);
  const error = store.useStoreSelector(state => command ? state.pending[command.commandId]?.error : undefined);
  if (!project) return null;
  const mode = project.leadChatMode ?? 'auto';
  async function change(value: string) {
    if (!project || busy || (value !== 'auto' && value !== 'classic') || value === mode) return;
    const next = setLeadChatMode({ projectId, expectedRevision: project.revision, leadChatMode: value });
    setCommand(next); setBusy(true);
    try { await store.send(next); await store.loadProjects(); }
    finally { setBusy(false); }
  }
  return <section className="space-y-2 rounded-xl border border-border p-5">
    <label htmlFor={id} className="block font-display text-lg">{t('leadChatUi.setting')}</label>
    <Choice id={id} data-testid="lead-chat-mode" value={mode} disabled={busy} onValueChange={value => void change(value)}>
      <ChoiceOption value="auto">{t('leadChatUi.auto')}</ChoiceOption>
      <ChoiceOption value="classic">{t('leadChatUi.classic')}</ChoiceOption>
    </Choice>
    {error && <ErrorNotice error={error} />}
  </section>;
}
