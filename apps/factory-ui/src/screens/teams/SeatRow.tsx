import { StaggerItem } from '@/components/motion/Stagger';
import { useId } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { seatsUpdate } from '../../api/commands';
import type { OrgTeam } from '../../api/m3Models';
import { useT } from '../../i18n';
import type { useM3Command } from '../M3Shared';

export function SeatRow({ seat, projectId, readOnly, command, index }: {
  index: number;
  seat: OrgTeam['seats'][number];
  projectId: string | null;
  readOnly: boolean;
  command: ReturnType<typeof useM3Command>;
}) {
  const t = useT();
  const id = useId();
  const disabled = command.busy || !projectId;

  return (
    <StaggerItem index={index} className="grid min-w-0 gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-medium [overflow-wrap:anywhere]">{seat.name}</h4>
          <Badge variant="outline">{seat.role}</Badge>
          {seat.isLead && <Badge variant="secondary">{t('team.lead')}</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="font-normal tabular-nums">{t('ux4.running')} {seat.live}</Badge>
          <Badge variant="secondary" className="font-normal tabular-nums">{t('team.slots')} {seat.slots}</Badge>
        </div>
        {!!seat.capabilities?.length && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('m3.capabilities')}>
            {seat.capabilities.map((value) => <Badge key={value} variant="secondary" className="max-w-full whitespace-normal [overflow-wrap:anywhere]">{value}</Badge>)}
          </div>
        )}
        {!!seat.tools?.length && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('m3.tools')}>
            {seat.tools.map((value) => <Badge key={value} variant="outline" className="max-w-full whitespace-normal [overflow-wrap:anywhere]">{value}</Badge>)}
          </div>
        )}
      </div>
      {!readOnly && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!projectId || disabled) return;
            const data = new FormData(event.currentTarget);
            void command.run(seatsUpdate({ projectId, seatId: seat.id, expectedRevision: seat.revision, slots: Number(data.get('slots')) }));
          }}
        >
          <Label htmlFor={`${id}-slots`} className="text-xs text-muted-foreground">{t('team.slots')}</Label>
          <div className="flex items-center gap-2">
            <Input id={`${id}-slots`} name="slots" type="number" min={1} max={8} required defaultValue={seat.slots} disabled={disabled} className="w-20" aria-label={`${t('team.slots')} ${seat.name}`} />
            <Button type="submit" variant="outline" disabled={disabled}>{t('m3.save')}</Button>
          </div>
        </form>
      )}
    </StaggerItem>
  );
}
