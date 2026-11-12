import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Page({ className, children, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return <div className={cn('w-full px-8 py-6 2xl:px-12', className)} {...props}>{children}</div>;
}
