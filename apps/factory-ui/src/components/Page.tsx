import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Page({ className, children, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return <div className={cn('mx-auto w-full max-w-[1400px] px-8 py-6', className)} {...props}>{children}</div>;
}
