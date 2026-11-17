import type { ReactNode } from 'react';
import { relativeTime } from '@/lib/inbox';
import { ProjectTile } from '../shell/ProjectTile';
import { ActionHints } from './ActionHints';

export function AttentionPane({ kind, projectId, projectName, code, since, title, titleId, children, actions }: {
  kind: string; projectId: string; projectName: string;
  code?: string | undefined; since?: string | undefined;
  title: ReactNode; titleId?: string; children: ReactNode; actions?: ReactNode;
}) {
  return <section className="flex min-h-full min-w-0 flex-1 flex-col" {...(titleId === undefined ? {} : { 'aria-labelledby': titleId })}>
    <header className="shrink-0 px-6 pt-6 pb-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
        <span>{kind}</span>
        <span className="inline-flex min-w-0 items-center gap-2"><ProjectTile id={projectId} name={projectName} className="size-5" /><span className="[overflow-wrap:anywhere]">{projectName}</span></span>
        {code && <span className="font-mono [overflow-wrap:anywhere]">{code}</span>}
        {since && !since.startsWith('9999') && <time dateTime={since}>{relativeTime(since)}</time>}
      </div>
      <h2 {...(titleId === undefined ? {} : { id: titleId })} className="text-2xl font-semibold [overflow-wrap:anywhere]">{title}</h2>
    </header>
    <div className="shrink-0 space-y-6 px-6 pb-6">{children}</div>
    {actions && <footer className="sticky bottom-0 z-10 mt-auto shrink-0 border-t border-border bg-background/95 px-6 py-3 backdrop-blur"><div className="flex flex-wrap items-center gap-2">{actions}<ActionHints /></div></footer>}
  </section>;
}
