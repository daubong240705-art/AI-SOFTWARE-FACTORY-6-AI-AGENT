import { lazy, Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n';

const MarkdownRenderer = lazy(() => import('./ProfileMarkdownRenderer'));

export function ProfileMarkdown({ content }: { content: string }) {
  const t = useT();
  return <Suspense fallback={<div role="status" aria-label={t('agentProfile.loadingContent')} className="space-y-3"><span className="sr-only">{t('agentProfile.loadingContent')}</span><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" /></div>}><MarkdownRenderer content={content} /></Suspense>;
}
