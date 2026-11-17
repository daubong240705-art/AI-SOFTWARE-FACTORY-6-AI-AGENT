import type { ReactNode } from 'react';
import { Fragment } from 'react';
import { cn } from '@/lib/utils';

export function KeyValueList({ items, className }: { items: Array<{ label: ReactNode; value: ReactNode; mono?: boolean }>; className?: string }) {
  return <dl className={cn('grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm', className)}>{items.map((item, index) => <Fragment key={index}><dt className="text-muted-foreground">{item.label}</dt><dd className={cn('m-0 min-w-0 break-words', item.mono && 'font-mono')}>{item.value}</dd></Fragment>)}</dl>;
}
