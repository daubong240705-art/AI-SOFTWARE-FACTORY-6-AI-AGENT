import type { Project } from '@factory/contracts';
import { Mascot } from '@/components/mascot/Mascot';
import { Button, buttonVariants } from '@/components/ui/button';
import { useT } from '@/i18n';
import type { FallbackReason } from './debugHook';

export function WorldFallback({ reason, projects, onSwitch, onRetry, children }: {
  reason: FallbackReason; projects: readonly Project[];
  onSwitch: () => void; onRetry: () => void; children?: ReactNode;
}) {
  const t = useT();
  return <div className="world-fallback">
    <section className="world-fallback-card rounded-xl border border-border bg-card p-6 text-center text-card-foreground shadow-sm" aria-labelledby="world-fallback-title">
      <Mascot seat="Lead" state="thinking" size={80} animated={false} />
      <h1 id="world-fallback-title" className="font-display text-xl font-semibold">{t('worldUi.title')}</h1>
      <p className="my-3 text-sm text-muted-foreground" role={reason === 'error' ? 'alert' : 'status'}>{t(`worldUi.reasons.${reason}`)}</p>
      <div className="flex flex-wrap justify-center gap-2">
        {projects.filter(project => project.disposition !== 'archived').map(project => <a key={project.id} className={buttonVariants({ variant: 'outline', size: 'sm' })} href={`#/project/${encodeURIComponent(project.id)}/office`}>{t('worldUi.openOffice').replace('{project}', project.name)}</a>)}
      </div>
      {(reason === 'reduced-motion' || reason === 'preference') && <Button size="sm" className="mt-4" onClick={onSwitch}>{t(reason === 'reduced-motion' ? 'worldUi.openStill' : 'worldUi.open3d')}</Button>}
      {reason === 'error' && <Button size="sm" className="mt-4" onClick={onRetry}>{t('worldUi.retry')}</Button>}
      {children && <div className="world-fallback-controls">{children}</div>}
    </section>
  </div>;
}
import type { ReactNode } from 'react';
