import { useId, useState } from 'react';
import { AUTONOMY_LEVELS, type AutonomyLevel } from '@factory/contracts';
import { autonomySet } from '@/api/commands';
import { CommandFormFrame } from '@/components/CommandFormFrame';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { autonomyPendingKey } from '@/state/settingsCommands';

export type AutonomyTarget = {
  subject: 'project' | 'team'; subjectRef: string; name: string;
  level: number | 'unknown'; revision: number | null; source: string;
};
export function AutonomyDialog({ target, store, projectId, onClose }: {
  target: AutonomyTarget; store: Store; projectId: string; onClose: () => void;
}) {
  const t = useT(); const id = useId();
  const [level, setLevel] = useState(String(target.level)); const [understood, setUnderstood] = useState(false);
  const raising = target.level === 'unknown' || Number(level) > target.level;
  function submit() {
    // A missing revision only represents an absent setting when its source is default.
    if (target.revision === null && target.source !== 'default') return 'settingsWrite.revisionMissing';
    if (!AUTONOMY_LEVELS.some(value => String(value) === level)) return 'settingsWrite.invalid';
    if (raising && !understood) return 'settingsWrite.acknowledge';
    return autonomySet({ projectId, subject: target.subject, subjectRef: target.subjectRef,
      level: Number(level) as AutonomyLevel, expectedRevision: target.revision });
  }
  return <CommandFormFrame pendingKey={autonomyPendingKey(target.subject, target.subjectRef)} store={store} send={store.sendSettings}
    onClose={onClose} onSubmit={submit} title={t('settingsWrite.changeLevel')} description={target.name}
    submitLabel={t('automationWrite.confirm')} invalidKey="settingsWrite.invalid"
    submitDisabled={level === String(target.level) || level === 'unknown' || (raising && !understood)}>
    <RadioGroup aria-label={t('settingsUi.autonomy')} value={level} onValueChange={value => { setLevel(value); setUnderstood(false); }}>
      {AUTONOMY_LEVELS.map(value => <div key={value} className="flex items-start gap-3 rounded-lg border border-border p-3">
        <RadioGroupItem id={`${id}-${value}`} value={String(value)} aria-describedby={`${id}-${value}-help`} className="mt-1" />
        <div className="space-y-1"><Label htmlFor={`${id}-${value}`} className="leading-relaxed"><span className="font-mono text-xs">L{value}</span>{t(`settingsUi.levels.${value}`)}</Label><p id={`${id}-${value}-help`} className="text-xs text-muted-foreground">{t(`settingsUi.levelHelp.${value}`)}</p></div>
      </div>)}
    </RadioGroup>
    {raising && <div className="space-y-3"><Alert className="border-need/40 bg-need/5"><AlertDescription className="text-foreground">{t('settingsWrite.raiseWarning')}</AlertDescription></Alert><div className="flex items-center gap-2"><Checkbox id={`${id}-ack`} checked={understood} onCheckedChange={value => setUnderstood(value === true)} /><Label htmlFor={`${id}-ack`}>{t('settingsWrite.understood')}</Label></div></div>}
    <p className="text-xs leading-relaxed text-muted-foreground">{t('settingsWrite.operatorOnly')}</p>
  </CommandFormFrame>;
}
