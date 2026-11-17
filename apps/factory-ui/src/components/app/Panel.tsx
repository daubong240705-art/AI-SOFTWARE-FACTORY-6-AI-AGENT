import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn('rounded-xl border border-border bg-card p-4', className)} />;
}
