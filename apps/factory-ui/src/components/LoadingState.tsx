import { MascotEmpty } from './mascot';
import { useT } from '../i18n';
import { cn } from '@/lib/utils';

export function LoadingState({ inline = false, className }: { inline?: boolean; className?: string }) {
  const t = useT();
  return <div role="status" aria-live="polite" aria-label={t('viewStates.loading')} className={cn('flex w-full items-center justify-center', inline ? 'min-h-32 flex-1' : 'h-full min-h-[16rem] flex-1', className)}>
    <div className="max-w-full"><MascotEmpty seat="Lead" state="thinking" compact><p className="m-0 text-sm text-muted-foreground">{t('viewStates.loading')}</p></MascotEmpty></div>
  </div>;
}
