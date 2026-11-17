import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Section({ title, actions, children, className, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return <section id={id} className={cn('space-y-3', className)}>
    {(title || actions) && <div className="flex items-center gap-3">{title && <h2 className="m-0 text-base font-semibold">{title}</h2>}{actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}</div>}
    {children}
  </section>;
}
