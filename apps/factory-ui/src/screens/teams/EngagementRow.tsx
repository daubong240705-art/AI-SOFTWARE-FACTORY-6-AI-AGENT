import { useId, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { engagementsUpdate } from '../../api/commands';
import type { OrgTeam } from '../../api/m3Models';
import { useT } from '../../i18n';
import type { useM3Command } from '../M3Shared';

export function EngagementRow({ engagement, readOnly, command }: {
  engagement: OrgTeam['engagements'][number];
  readOnly: boolean;
  command: ReturnType<typeof useM3Command>;
}) {
  const t = useT();
  const id = useId();
  const [status, setStatus] = useState(engagement.state);

  return (
    <li className="min-w-0 space-y-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-medium [overflow-wrap:anywhere]">{engagement.projectName}</h4>
        <Badge variant="secondary">{t(`m3.values.${engagement.state}`)}</Badge>
        <Badge variant="outline" className="font-normal tabular-nums">{t('ux4.running')} {engagement.live}</Badge>
      </div>
      {readOnly ? (
        <dl className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <div className="flex gap-2"><dt className="text-muted-foreground">{t('team.priority')}</dt><dd>{engagement.priority}</dd></div>
          <div className="flex gap-2"><dt className="text-muted-foreground">{t('team.maxConcurrent')}</dt><dd>{engagement.maxConcurrent}</dd></div>
        </dl>
      ) : (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (command.busy) return;
            const data = new FormData(event.currentTarget);
            void command.run(engagementsUpdate({
              projectId: engagement.projectId, engagementId: engagement.engagementId,
              expectedRevision: engagement.revision, priority: Number(data.get('priority')),
              maxConcurrent: Number(data.get('maxConcurrent')), state: status,
            }));
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={`${id}-priority`} className="text-xs text-muted-foreground">{t('team.priority')}</Label>
            <Input id={`${id}-priority`} name="priority" type="number" min={0} max={100} required defaultValue={engagement.priority} disabled={command.busy} className="w-20" />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-concurrent`} className="text-xs text-muted-foreground">{t('team.maxConcurrent')}</Label>
            <Input id={`${id}-concurrent`} name="maxConcurrent" type="number" min={1} max={32} required defaultValue={engagement.maxConcurrent} disabled={command.busy} className="w-20" />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-state`} className="text-xs text-muted-foreground">{t('m3.state')}</Label>
            <div className="relative"><Select name="state" value={status} onValueChange={(value) => setStatus(value as typeof status)} disabled={command.busy}>
              <SelectTrigger id={`${id}-state`} className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(['active', 'paused', 'ended'] as const).map((value) => <SelectItem key={value} value={value}>{t(`m3.values.${value}`)}</SelectItem>)}
              </SelectContent>
            </Select></div>
          </div>
          <Button type="submit" variant="outline" disabled={command.busy}>{t('m3.save')}</Button>
        </form>
      )}
    </li>
  );
}
