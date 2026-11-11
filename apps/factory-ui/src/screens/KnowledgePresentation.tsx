import { BookOpen, Code2, Database, FileText, GitBranch, Image, ListChecks, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useT } from '../i18n';
import { artifactTitle } from './artifactPresentation';

export function KnowledgeTitle({ title }: { title: string }) {
  return <>{artifactTitle(title)}</>;
}

export function KnowledgeKindIcon({ kind }: { kind: string }) {
  const Icon = kind === 'research-report' ? Search : kind === 'adr' ? GitBranch : kind === 'data-model' || kind === 'dataset' ? Database : kind === 'api-contract' || kind === 'code-ref' ? Code2 : kind === 'design-asset' || kind === 'media' || kind === 'ui-spec' ? Image : kind === 'plan' || kind === 'requirements' ? ListChecks : kind === 'dossier' ? BookOpen : FileText;
  return <Icon aria-hidden="true" className="size-4" />;
}

export function KnowledgeStatus({ status }: { status: string }) {
  const t = useT();
  return <Badge variant="outline" className={cn('gap-1.5 font-normal', status === 'approved' || status === 'reviewed' ? 'text-ok' : status === 'in-review' ? 'text-info' : 'text-muted-foreground')}><span aria-hidden="true" className="size-1.5 rounded-full bg-current" />{t(`knowledgeUi.statuses.${status}`)}</Badge>;
}

// Keep document content inert: no embedded HTML or remote resources.
export function KnowledgeText({ text, code = false }: { text: string; code?: boolean }) {
  if (code) return <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-4 font-mono text-xs leading-7 whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</pre>;
  return <div className="space-y-4 text-sm leading-7 [overflow-wrap:anywhere]">{text.split(/(```[^\n]*\n[\s\S]*?(?:```|$))/g).filter(Boolean).map((block, index) => {
    if (block.startsWith('```')) return <KnowledgeText key={index} text={block.replace(/^```[^\n]*\n/, '').replace(/```$/, '').trimEnd()} code />;
    return block.split(/\n\s*\n/).filter(part => part.trim()).map((part, line) => {
      const heading = /^(#{1,6})\s+([^\n]+)$/.exec(part.trim());
      return heading ? <h4 key={`${index}-${line}`} className="pt-2 font-display text-lg font-semibold">{heading[2]}</h4> : <p key={`${index}-${line}`} className="whitespace-pre-wrap">{part}</p>;
    });
  })}</div>;
}
