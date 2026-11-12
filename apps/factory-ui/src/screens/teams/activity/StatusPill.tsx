import { AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Crossfade } from '@/components/motion/Crossfade';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import type { ActivityStatus } from '@/api/activityModels';
import { dotClass, pillClass } from './presentation';

export function StatusPill({ status }: { status: ActivityStatus }) {
  const t = useT();
  return <div className="shrink-0"><Crossfade contentKey={status}><Badge variant="secondary" className={cn('gap-1.5 border-0 px-2 py-1 font-normal', pillClass[status])}>
    <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', dotClass[status])} />
    {status === 'problem' && <AlertCircle aria-hidden="true" />}
    {t(`activityUi.status.${status}`)}
  </Badge></Crossfade></div>;
}
