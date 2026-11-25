import { StatusDot } from '@/components/app';
import { toneOf } from '@/lib/status';
import { Badge } from '@/components/ui/badge';
import { Crossfade } from '@/components/motion/Crossfade';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import type { ActivityStatus } from '@/api/activityModels';
import { pillClass } from './presentation';

export function StatusPill({ status }: { status: ActivityStatus }) {
  const t = useT();
  return <div className="shrink-0"><Crossfade contentKey={status}><Badge variant="secondary" className={cn('gap-1.5 border-0 px-2 py-1 font-normal', pillClass[status])}>
    <StatusDot tone={toneOf('activity', status)} label={t(`activityUi.status.${status}`)} pulse />
  </Badge></Crossfade></div>;
}
