import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function PageHeader({ title, actions, children, className }: { title: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }) {
  return <header className={cn('flex flex-wrap items-center gap-3 pb-4', className)}>
    <h1 className="m-0 min-w-0 flex-1 truncate font-display text-2xl font-semibold leading-tight">{title}</h1>
    {actions && <div className="ml-auto flex items-center justify-end gap-2">{actions}</div>}
    {children && <div className="w-full min-w-0 basis-full">{children}</div>}
  </header>;
}
