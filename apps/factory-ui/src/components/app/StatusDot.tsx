import { AlertCircle } from 'lucide-react';
import { toneDot, toneText, type StatusTone } from '@/lib/status';
import { cn } from '@/lib/utils';

export function StatusDot({ tone, label, labelHidden = false, pulse = false, className }: {
  tone: StatusTone; label: string; labelHidden?: boolean; pulse?: boolean; className?: string;
}) {
  return <span className={cn('inline-flex shrink-0 items-center gap-1.5 text-sm', className)}>
    {tone === 'error' ? <AlertCircle aria-hidden="true" className="size-3.5 shrink-0 text-need" />
      : <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', toneDot[tone], pulse && tone === 'run' && 'motion-safe:animate-pulse')} />}
    <span className={cn(toneText[tone], labelHidden && 'sr-only')}>{label}</span>
  </span>;
}
