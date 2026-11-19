import { useMemo, useState } from 'react';
import type { AgentDetail, AgentSummary, AgentTemplateDetail } from '@factory/contracts';
import { ApiClientError, type ApiClient } from '@/api/client';
import { agentsSaveAsTemplate, agentsUpgradeFromTemplate } from '@/api/commands';
import { Textarea } from '@/components/ui/textarea';
import { AgentHistory } from '../agents/AgentHistory';
import { AdminDialog, DialogButtons, Field, useWriteFeedback, type Submit } from '../agents/shared';
import { LibraryError, ReadFeedback, useLibraryLabels } from './shared';

export function SaveTemplateDialog({ agent, close, submit }: { agent: AgentSummary; close: () => void; submit: Submit }) {
  const t = useLibraryLabels();
  const writer = useWriteFeedback(submit);
  const [description, setDescription] = useState('');
  return <AdminDialog title={t('saveAsTemplate')} description={t('saveTemplateHelp', { name: agent.name })} close={close} busy={writer.busy}
    onSubmit={() => void writer.run(() => agentsSaveAsTemplate({ projectId: agent.projectId, agentId: agent.id, description }), close)}
    footer={<DialogButtons close={close} label={t('saveAsTemplate')} busy={writer.busy} />}>
    <LibraryError error={writer.error} />
    <Field label={t('templateDescription')}>{props => <Textarea {...props} disabled={writer.busy} maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} />}</Field>
  </AdminDialog>;
}

export function UpgradeTemplateDialog({ api, agent, detail, template, current, loading, error, close, submit, refresh }: {
  api: ApiClient; agent: AgentSummary; detail: AgentDetail | undefined; template: AgentTemplateDetail | undefined; current: AgentSummary | undefined;
  loading: boolean; error: Error | undefined; close: () => void; submit: Submit; refresh: () => void;
}) {
  const t = useLibraryLabels();
  const writer = useWriteFeedback(submit);
  const [reviewed, setReviewed] = useState(false);
  const target = agent.template!;
  const stale = current?.revision !== agent.revision || (!!detail && (detail.revision !== agent.revision || detail.template?.id !== target.id || detail.template.revision !== target.revision)) ||
    (!!template && (template.template.id !== target.id || template.revision !== target.latestRevision || template.template.latestRevision !== target.latestRevision));
  const disabled = stale || loading || !!error || !detail || !template || !reviewed || (writer.error instanceof ApiClientError && writer.error.code === 'conflict');
  const upgrade = () => {
    if (!disabled) void writer.run(() => agentsUpgradeFromTemplate({ projectId: agent.projectId, agentId: agent.id, expectedRevision: agent.revision, toRevision: target.latestRevision }), close);
  };
  const title = t('upgradeFromTemplate', { revision: target.latestRevision });
  return <AdminDialog wide title={title} description={t('upgradeHelp', { name: agent.name, revision: target.latestRevision })} close={close} busy={writer.busy}
    onSubmit={upgrade} footer={<DialogButtons close={close} label={title} busy={writer.busy} disabled={disabled} destructive />}>
    <LibraryError error={writer.error} stale={stale} />
    <ReadFeedback error={error} loading={loading} retry={refresh} />
    {detail && template && !stale && <UpgradeDiff api={api} detail={detail} template={template} onReview={setReviewed} />}
  </AdminDialog>;
}

function UpgradeDiff({ api, detail, template, onReview }: { api: ApiClient; detail: AgentDetail; template: AgentTemplateDetail; onReview: (reviewed: boolean) => void }) {
  const t = useLibraryLabels();
  const revisions = detail.revisions.filter(item => item.revision === detail.configRevision);
  const comparisonApi = useMemo<ApiClient>(() => ({ ...api, getAgentRevision: async (projectId, agentId, revision, signal) => {
    const result = await api.getAgentRevision(projectId, agentId, revision, signal);
    if (signal?.aborted) return result;
    onReview(true);
    return result;
  } }), [api, onReview]);
  return <div className="space-y-2" onChangeCapture={event => { if (event.target instanceof HTMLSelectElement) onReview(false); }}>
    <p className="text-sm text-muted-foreground">{t('compareHelp', { revision: template.revision })}</p>
    <AgentHistory api={comparisonApi} detail={{ ...detail, config: template.config, revisions }} busy rollback={() => {}} />
  </div>;
}
