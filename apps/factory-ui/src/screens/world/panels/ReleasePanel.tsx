import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { GalleryItem } from '../data/types';
import { worldCopy, type GalleryLocale } from '../copy';
import { thumbnailUrl } from '../scene/gallery/thumbnailUrl';

export type ReleasePanelProps = {
  item: GalleryItem;
  /** GalleryItem has no date: pass releaseVersions[projectId].at or ReleaseView's date. */
  releaseDate?: string | null;
  locale?: GalleryLocale;
  baseUrl?: string;
  onOpenProject?: (item: GalleryItem) => void;
};
function Cover({ item, url }: { item: GalleryItem; url: string | null }) {
  const [failed, setFailed] = useState(false);
  return <div className="relative mb-3 flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg bg-secondary p-6 text-center font-semibold">
    <span aria-hidden="true">{item.name}</span>
    {url && !failed && <img src={url} alt="" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full bg-card object-contain" />}
  </div>;
}
export function ReleasePanel({ item, locale = 'vi', releaseDate, onOpenProject, baseUrl }: ReleasePanelProps) {
  const text = worldCopy[locale].gallery; const cover = thumbnailUrl(item.projectId, item.releaseId, baseUrl);
  const parsedDate = releaseDate ? new Date(releaseDate) : null;
  const date = parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate : null;
  return <aside aria-label={`${item.name} · v${item.version ?? '—'}`} className="world-panel-content">
    <Cover key={cover ?? `${item.projectId}:${item.releaseId}`} item={item} url={cover} />
    <h2 className="text-lg font-semibold">{item.name}</h2>
    <p className="text-sm">v{item.version ?? '—'}</p>
    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      <dt className="font-medium">{text.releaseDate}</dt><dd>{date ? <time dateTime={date.toISOString()}>{new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date)}</time> : '—'}</dd>
      <dt className="font-medium">{text.portal}</dt>
      <dd>{item.enabled === null ? '—' : item.enabled ? text.enabled : text.off}{item.current && <span> · {text.current}</span>}</dd>
      {item.playing !== null && item.playing > 0 && <><dt className="font-medium">{text.playing}</dt><dd>{item.playing}</dd></>}
    </dl>
    <div className="mt-4 flex flex-wrap gap-2">
      <Button type="button" size="sm" disabled={!item.playUrl} title={!item.playUrl ? text.noPlay : undefined}
        onClick={() => { if (item.playUrl) window.open(item.playUrl, '_blank', 'noopener,noreferrer'); }}
        >{text.play}</Button>
      <Button variant="outline" size="sm" asChild><a href={`#/project/${encodeURIComponent(item.projectId)}/office`} onClick={event => { if (onOpenProject) { event.preventDefault(); onOpenProject(item); } }}>{text.openProject}</a></Button>
    </div>
  </aside>;
}
