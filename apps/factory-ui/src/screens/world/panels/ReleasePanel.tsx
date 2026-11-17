import { useState } from 'react';
import type { GalleryItem } from '../data/types';
import { labels, type GalleryLocale } from '../scene/gallery/labels';
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
  return <div className="relative mb-3 flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl bg-[#CDBFE6] p-6 text-center font-semibold">
    <span aria-hidden="true">{item.name}</span>
    {url && !failed && <img src={url} alt="" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full bg-[#FFF8E7] object-contain" />}
  </div>;
}
export function ReleasePanel({ item, locale = 'vi', releaseDate, onOpenProject, baseUrl }: ReleasePanelProps) {
  const text = labels[locale]; const cover = thumbnailUrl(item.projectId, item.releaseId, baseUrl);
  const parsedDate = releaseDate ? new Date(releaseDate) : null;
  const date = parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate : null;
  return <aside aria-label={`${item.name} · v${item.version ?? '—'}`} className="w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-[#E9D4AE] bg-[#FFF8E7] p-4 text-[#4A3B2F] shadow-lg">
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
      <button type="button" disabled={!item.playUrl} title={!item.playUrl ? text.noPlay : undefined}
        onClick={() => { if (item.playUrl) window.open(item.playUrl, '_blank', 'noopener,noreferrer'); }}
        className="rounded-lg bg-[#AF496B] px-3 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40">{text.play}</button>
      <a href={`#/project/${encodeURIComponent(item.projectId)}/office`} onClick={event => { if (onOpenProject) { event.preventDefault(); onOpenProject(item); } }}
        className="rounded-lg border border-[#A87A50] px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2">{text.openProject}</a>
    </div>
  </aside>;
}
