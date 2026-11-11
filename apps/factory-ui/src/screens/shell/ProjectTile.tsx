import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

const projectColors = [
  'border-project-1/35 bg-project-1/15 text-project-1',
  'border-project-2/35 bg-project-2/15 text-project-2',
  'border-project-3/35 bg-project-3/15 text-project-3',
  'border-project-4/35 bg-project-4/15 text-project-4',
] as const;
export function ProjectTile({ id, name, className }: { id: string; name: string; className?: string }) {
  let hash = 0;
  for (const character of id) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  const words = name.trim().split(/\s+/);
  const code = (words.length > 1 ? `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}` : name.slice(0, 2)).toLocaleUpperCase();
  return <Avatar aria-hidden="true" className={cn('h-6 w-7 shrink-0 rounded-[7px] border font-mono', projectColors[hash % projectColors.length], className)}>
    <AvatarFallback className="rounded-none bg-transparent font-mono text-[11px] font-semibold text-inherit">{code}</AvatarFallback>
  </Avatar>;
}
