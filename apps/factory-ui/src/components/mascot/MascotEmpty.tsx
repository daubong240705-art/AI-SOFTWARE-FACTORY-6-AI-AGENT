import type { ReactNode } from 'react';
import { Empty, EmptyDescription, EmptyTitle } from '@/components/ui/empty';
import { cn } from '@/lib/utils';
import { Mascot } from './Mascot';
import { useMascotSkin } from './preference';
import type { MascotState } from './state';

type Props = {
  seat: string;
  state?: MascotState;
  size?: number;
  compact?: boolean;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
  /** Preserve the existing empty block, including its icon, when skins are off. */
  fallback?: ReactNode;
};

export function MascotEmpty({ seat, state = 'idle', size, compact = false, title, description, action, className, children, fallback }: Props) {
  const skin = useMascotSkin();
  const content = <>{title && <EmptyTitle className="font-display">{title}</EmptyTitle>}{description && <EmptyDescription>{description}</EmptyDescription>}{children}{action}</>;
  if (skin === 'off') return fallback === undefined ? content : fallback;
  return <Empty className={cn('w-full flex-none gap-3 border-0 p-0 md:p-0', compact && 'flex-row justify-center text-left', className)}>
    <Mascot seat={seat} state={state} size={size ?? (compact ? 48 : 96)} decorative />
    <div className={cn('flex min-w-0 flex-col items-center gap-3', compact && 'flex-1 items-start')}>{content}</div>
  </Empty>;
}
