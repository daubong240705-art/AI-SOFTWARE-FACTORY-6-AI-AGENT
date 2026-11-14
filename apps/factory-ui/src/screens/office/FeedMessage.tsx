import { useId, useLayoutEffect, useRef, useState } from 'react';
import { MarkdownContent } from '@/components/MarkdownContent';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';

const COLLAPSED_HEIGHT = 6 * 24;

export function FeedMessage({ text }: { text: string }) {
  const t = useT(); const id = useId();
  const content = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    const measure = () => setLong(element.getBoundingClientRect().height > COLLAPSED_HEIGHT + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);
  return <div>
    <div id={id} className={cn(!expanded && 'max-h-36 overflow-hidden')}>
      <div ref={content}><MarkdownContent content={text} className="space-y-2 leading-6" /></div>
    </div>
    {long && <button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}
      className="mt-1 rounded px-1 py-1 text-xs font-medium text-info underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
      {t(expanded ? 'officeUi.showLess' : 'officeUi.showMore')}
    </button>}
  </div>;
}
