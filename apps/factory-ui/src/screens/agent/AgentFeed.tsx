import { useState } from 'react';
import { meaningfulOfficeItems, type Interaction, type Party } from '@/api/officeModels';
import { Section } from '@/components/app';
import { Checkbox } from '@/components/ui/checkbox';
import { useT } from '@/i18n';
import { activityTime } from '../teams/activity/presentation';
import { FeedMessage } from './FeedMessage';

export function AgentFeed({ items, now, onOpenTask }: { items: Interaction[]; now: number; onOpenTask: (id: string) => void }) {
  const t = useT(); const [hideProgress, setHideProgress] = useState(false);
  const shown = meaningfulOfficeItems(items).filter(item => !hideProgress || item.kind !== 'progress')
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 50);
  const party = (value: Party) => value.kind === 'seat' ? value.name : t(value.kind === 'operator' ? 'agentUi.you' : 'agentUi.knowledge');
  return <Section title={t('agentUi.activity')} className="min-w-0" actions={<label className="flex items-center gap-2 text-xs text-muted-foreground">
    <Checkbox checked={hideProgress} onCheckedChange={value => setHideProgress(value === true)} />{t('agentUi.hideProgress')}</label>}>
    <ol className="max-h-[70vh] divide-y divide-border overflow-y-auto overscroll-contain">
      {shown.map(item => <li key={item.id} className="relative space-y-2 py-3 text-sm [overflow-wrap:anywhere]">
        {item.taskId && <button type="button" aria-label={`${t('agentUi.openTask')}: ${item.code ?? ''}`} className="absolute inset-0 rounded focus-visible:outline-2 focus-visible:outline-ring" onClick={() => onOpenTask(item.taskId!)} />}
        <div className="pointer-events-none relative space-y-2">
          <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground"><span>{party(item.from)}{item.to && ` → ${party(item.to)}`}</span><span>· {t(`agentUi.kinds.${item.kind}`)}</span></div>
          {item.code && <span className="font-mono text-xs text-info">{item.code}</span>}
          <FeedMessage text={item.text} />
          <time dateTime={item.at} className="block text-xs text-muted-foreground">{activityTime(item.at, now)}</time>
        </div>
      </li>)}
    </ol>
    {!shown.length && <p className="py-8 text-center text-sm text-muted-foreground">{t('agentUi.noActivity')}</p>}
  </Section>;
}
