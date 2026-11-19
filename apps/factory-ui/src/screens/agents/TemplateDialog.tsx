import { useCallback, useState } from 'react';
import type { AgentConfig } from '@factory/contracts';
import type { AgentLibrary } from '@/api/agentModels';
import type { ApiClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AdminDialog, Choice, DialogButtons, Field, ReadStatus, useAgentLabels, useRead } from './shared';

export type TemplateDraft = { initial: AgentConfig; template: { id: string; revision: number; link: boolean }; library: AgentLibrary };

export function TemplateDialog({ api, close, start }: { api: ApiClient; close: () => void; start: (draft: TemplateDraft) => void }) {
  const t = useAgentLabels();
  const [templateId, setTemplate] = useState('');
  const [name, setName] = useState('');
  const [link, setLink] = useState(false);
  const [retry, setRetry] = useState(0);
  const library = useRead(api.getAgentLibrary, retry);
  const read = useCallback((signal: AbortSignal) => api.getAgentTemplate(templateId, signal), [api, templateId]);
  const detail = useRead(templateId ? read : null, retry);
  const selected = detail.data;
  function open() {
    if (!selected || !library.data || detail.loading || detail.error) return;
    start({ initial: { ...selected.config, name: name.trim() || selected.config.name }, template: { id: selected.template.id, revision: selected.revision, link }, library: library.data });
  }
  return <AdminDialog title={t('fromTemplate')} description={t('templateHelp')} close={close} onSubmit={open} footer={<DialogButtons close={close} label={t('continue')} disabled={!selected || detail.loading || !!detail.error} />}>
    <ReadStatus loading={library.loading || detail.loading} error={library.error ?? detail.error} missingRoute={!!library.error} />
    {(library.error || detail.error) && <Button type="button" size="sm" variant="outline" onClick={() => setRetry(value => value + 1)}>{t('reload')}</Button>}
    {library.data?.templates.length === 0 && <p className="text-sm text-muted-foreground">{t('emptyTemplates')}</p>}
    {!!library.data?.templates.length && <Field label={t('template')}>{props => <Choice {...props} value={templateId} onChange={event => setTemplate(event.target.value)}>
      <option value="">{t('chooseTemplate')}</option>
      {library.data!.templates.map(item => <option key={item.id} value={item.id}>{item.name} · {item.role} · {item.source ? `${item.source.packKey}@${item.source.packVersion}` : t('noSourcePack')}</option>)}
    </Choice>}</Field>}
    {selected && <>
      <div className="space-y-1 break-words text-sm"><strong>{selected.template.name} · {selected.template.role} · r{selected.revision}</strong><p>{selected.template.description}</p><p className="text-muted-foreground">{selected.template.source ? t('sourcePack', { pack: `${selected.template.source.packKey}@${selected.template.source.packVersion}` }) : t('noSourcePack')}</p></div>
      <Field label={t('templateMode')}>{props => <Choice {...props} value={link ? 'link' : 'copy'} onChange={event => setLink(event.target.value === 'link')}><option value="copy">{t('copy')}</option><option value="link">{t('link')}</option></Choice>}</Field>
      <Field label={t('nameOverride')}>{props => <Input {...props} value={name} maxLength={80} placeholder={selected.config.name} onChange={event => setName(event.target.value)} />}</Field>
    </>}
  </AdminDialog>;
}
