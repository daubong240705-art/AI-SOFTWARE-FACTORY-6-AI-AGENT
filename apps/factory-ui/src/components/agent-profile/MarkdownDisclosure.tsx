import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ProfileMarkdown } from './ProfileMarkdown';

export function MarkdownDisclosure({ label, content }: { label: string; content: string }) {
  return <Collapsible className="space-y-3">
    <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="h-auto max-w-full justify-start whitespace-normal px-0 text-left text-muted-foreground hover:bg-transparent hover:text-foreground [&[data-state=open]>svg]:rotate-180"><ChevronDown className="size-4 shrink-0 transition-transform" aria-hidden="true" />{label}</Button></CollapsibleTrigger>
    <CollapsibleContent><ProfileMarkdown content={content} /></CollapsibleContent>
  </Collapsible>;
}
