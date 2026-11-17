import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';

export function SplitView({ list, detail, listLabel, onBack, backLabel, className, persistentList = false }: { list: ReactNode; detail: ReactNode | null; listLabel: string; onBack?: () => void; backLabel?: string; className?: string; persistentList?: boolean }) {
  const t = useT();
  return <div className={cn('grid min-w-0 gap-4 lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]', className)}>
    <div role="region" aria-label={listLabel} className={cn('min-w-0', detail !== null && !persistentList && 'hidden lg:block')}>{list}</div>
    {detail !== null && <div className="min-w-0">{!persistentList && <Button type="button" variant="ghost" className="mb-3 lg:hidden" onClick={onBack}><ArrowLeft aria-hidden="true" />{backLabel ?? t('workUi.back')}</Button>}{detail}</div>}
  </div>;
}
