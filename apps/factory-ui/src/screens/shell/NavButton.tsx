import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export function NavButton({ collapsed = false, className, ...props }: ComponentProps<typeof Button> & { collapsed?: boolean }) {
  const button = <Button type="button" variant="ghost" {...props} className={cn(
    'relative h-10 min-h-10 w-full shrink-0 justify-start gap-2.5 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left text-sm font-normal text-muted-foreground hover:bg-card hover:text-foreground',
    'aria-[current=page]:bg-secondary aria-[current=page]:text-foreground aria-[current=page]:before:absolute aria-[current=page]:before:inset-y-2 aria-[current=page]:before:-left-2.5 aria-[current=page]:before:w-[3px] aria-[current=page]:before:rounded-r aria-[current=page]:before:bg-foreground',
    collapsed && 'justify-center px-1', className,
  )} />;
  return collapsed ? <Tooltip><TooltipTrigger asChild>{button}</TooltipTrigger><TooltipContent side="right" sideOffset={12}>{props['aria-label']}</TooltipContent></Tooltip> : button;
}
