import type { KnowledgeItem, KnowledgeResult } from '@/api/readModels';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { useT } from '@/i18n';
import { KnowledgeStatus, KnowledgeTitle } from '../KnowledgePresentation';
import { readableText } from '../artifactPresentation';
import { relativeTime } from '../Inbox';
import { DocumentIcon, documentSize, documentType } from './presentation';

export function DocumentList({ rows, onSelect }: { rows: Array<KnowledgeItem | KnowledgeResult>; onSelect: (id: string) => void }) {
  const t = useT();
  return <Card className="gap-0 overflow-hidden rounded-xl border-border py-0 shadow-none"><ul className="m-0 list-none divide-y divide-border p-0">{rows.map(row => <li key={row.artifactId}>
    <Item asChild className="w-full flex-nowrap items-start rounded-none p-5 text-left hover:bg-secondary"><button type="button" onClick={() => onSelect(row.artifactId)}>
      <ItemMedia variant="icon" className="rounded-lg text-muted-foreground"><DocumentIcon mediaType={row.mediaType} /></ItemMedia>
      <ItemContent className="min-w-0 gap-2"><ItemTitle className="w-full flex-wrap font-medium [overflow-wrap:anywhere]"><KnowledgeTitle title={row.title} /><Badge variant="outline" className="font-normal text-muted-foreground">{t(row.origin === 'upload' ? 'knowledgeUi.upload' : 'knowledgeUi.agent')}</Badge><KnowledgeStatus status={row.status} /></ItemTitle>
        <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{t(`knowledgeUi.types.${documentType(row.mediaType)}`)}</span><span>{documentSize(row.sizeBytes)}</span>{'createdAt' in row && <time dateTime={row.createdAt}>{relativeTime(row.createdAt)}</time>}</span>
        <ItemDescription className="line-clamp-1 text-left">{readableText('snippet' in row && row.snippet.trim() ? row.snippet : row.abstractL0)}</ItemDescription>
      </ItemContent>
    </button></Item>
  </li>)}</ul></Card>;
}
