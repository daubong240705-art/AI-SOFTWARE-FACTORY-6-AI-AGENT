import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useT } from '@/i18n';

export function TechDetails({ identifier, children }: { identifier?: string; children?: ReactNode }) {
  const t = useT();
  return <Collapsible className="text-xs text-muted-foreground"><CollapsibleTrigger asChild><Button type="button" variant="ghost" size="sm" className="-ml-2 h-7 gap-1 px-2 text-xs text-muted-foreground">{t('m5Ui.technicalDetails')}<ChevronDown className="size-3" /></Button></CollapsibleTrigger><CollapsibleContent className="space-y-2 pt-2 break-words">{identifier && <dl className="grid gap-1"><dt>{t('m5Ui.identifier')}</dt><dd className="font-mono">{identifier}</dd></dl>}{children}</CollapsibleContent></Collapsible>;
}
