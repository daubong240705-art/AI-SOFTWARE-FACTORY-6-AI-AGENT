import { useId, useState } from 'react';
import { Share2 } from 'lucide-react';
import { artifactsShare } from '@/api/commands';
import { knowledgeVisibilities, type KnowledgeArtifact } from '@/api/readModels';
import { CommandFormFrame } from '@/components/CommandFormFrame';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useT } from '@/i18n';
import { knowledgePendingKey } from '@/state/knowledgeCommands';
import type { Store } from '@/state/store';
import { artifactTitle } from '../artifactPresentation';
import { KnowledgeVisibility } from '../KnowledgePresentation';

type Version = KnowledgeArtifact['versions'][number];
type Visibility = typeof knowledgeVisibilities[number];

function disabledReason(status: string, visibility: Visibility) {
  if (['withdrawn', 'rejected', 'superseded'].includes(status)) return 'knowledgeWrite.inactive';
  if (visibility === 'shared' && status !== 'approved') return 'knowledgeWrite.approvedOnly';
  if (visibility === 'team-draft' && status === 'approved') return 'knowledgeWrite.noDraft';
  return '';
}

function ShareDialog({ store, projectId, artifactId, title, version, onClose }: {
  store: Store; projectId: string; artifactId: string; title: string; version: Version; onClose: () => void;
}) {
  const t = useT(); const id = useId();
  const [visibility, setVisibility] = useState<Visibility>(version.visibility);
  const [understood, setUnderstood] = useState(false);
  const forbidden = disabledReason(version.status, visibility);
  const organization = visibility === 'shared';
  return <CommandFormFrame store={store} pendingKey={knowledgePendingKey(artifactId, version.version)} send={store.sendKnowledge}
    onClose={onClose} title={t('knowledgeWrite.share')} description={`${artifactTitle(title)} · ${t('knowledgeUi.version')} ${version.version}`}
    submitLabel={t('automationWrite.confirm')} invalidKey="knowledgeWrite.invalid"
    submitDisabled={Boolean(forbidden) || visibility === version.visibility || (organization && !understood)}
    onSubmit={() => {
      if (forbidden) return forbidden;
      if (organization && !understood) return 'knowledgeWrite.acknowledge';
      return artifactsShare({ projectId, artifactId, version: version.version, visibility });
    }}>
    <RadioGroup aria-label={t('knowledgeWrite.visibility')} value={visibility} onValueChange={value => {
      if (knowledgeVisibilities.includes(value as Visibility)) { setVisibility(value as Visibility); setUnderstood(false); }
    }}>
      {knowledgeVisibilities.map(value => {
        const reason = disabledReason(version.status, value);
        return <div key={value} className="flex items-start gap-3 rounded-lg border border-border p-4">
          <RadioGroupItem id={`${id}-${value}`} value={value} disabled={Boolean(reason)} aria-describedby={`${id}-${value}-help`} className="mt-1" />
          <div className="space-y-1"><Label htmlFor={`${id}-${value}`} className="leading-relaxed">{t(`knowledgeUi.visibility.${value}`)}</Label>
            <div id={`${id}-${value}-help`} className="space-y-1 text-xs leading-relaxed text-muted-foreground"><p>{t(`knowledgeWrite.help.${value}`)}</p>{reason && <p>{t(reason)}</p>}</div>
          </div>
        </div>;
      })}
    </RadioGroup>
    {organization && <div className="space-y-3"><Alert className="border-need/40 bg-need/5"><AlertDescription className="text-foreground">{t('knowledgeWrite.organizationWarning')}</AlertDescription></Alert>
      <div className="flex items-center gap-2"><Checkbox id={`${id}-ack`} checked={understood} onCheckedChange={value => setUnderstood(value === true)} /><Label htmlFor={`${id}-ack`}>{t('knowledgeWrite.understood')}</Label></div>
    </div>}
  </CommandFormFrame>;
}

export function ShareDocument({ store, projectId, artifactId, title, version }: {
  store: Store; projectId: string; artifactId: string; title: string; version: Version;
}) {
  const t = useT(); const [open, setOpen] = useState(false);
  const busy = store.useStoreSelector(state => state.loading[knowledgePendingKey(artifactId, version.version)]);
  return <div className="flex flex-wrap items-center gap-2">
    <Button type="button" variant="ghost" size="sm" disabled={Boolean(busy)} onClick={() => setOpen(true)}><Share2 aria-hidden="true" className="size-4" />{t('knowledgeWrite.share')}</Button>
    <KnowledgeVisibility visibility={version.visibility} />
    {open && <ShareDialog store={store} projectId={projectId} artifactId={artifactId} title={title} version={version} onClose={() => setOpen(false)} />}
  </div>;
}
