import { createScreenTexture, type ScreenTexture } from '../screenTexture';
import { CanvasTexture, SRGBColorSpace } from 'three';

export function coverHue(gameId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < gameId.length; i += 1) hash = Math.imul(hash ^ gameId.charCodeAt(i), 16777619);
  return (hash >>> 0) % 360;
}
/** Draws a controller and game name without relying on a system emoji font. */
export function drawGeneratedCover(ctx: CanvasRenderingContext2D, name: string, gameId: string, width = 512, height = 320) {
  ctx.save(); ctx.scale(width / 512, height / 320);
  const gradient = ctx.createLinearGradient(0, 0, 512, 320); const hue = coverHue(gameId);
  gradient.addColorStop(0, `hsl(${hue} 48% 87%)`); gradient.addColorStop(1, `hsl(${hue} 44% 75%)`);
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 512, 320);
  ctx.fillStyle = 'rgba(255,248,231,.6)'; ctx.beginPath(); ctx.ellipse(256, 132, 113, 89, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#FFF8E7'; ctx.strokeStyle = '#4A3B2F'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.roundRect(171, 94, 170, 89, 30); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#4A3B2F'; ctx.fillRect(197, 129, 43, 12); ctx.fillRect(212, 114, 12, 43);
  ctx.fillStyle = '#E0A458'; ctx.beginPath(); ctx.arc(294, 123, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#AF496B'; ctx.beginPath(); ctx.arc(316, 145, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#4A3B2F'; ctx.font = '600 30px "Inter Variable", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(name, 256, 270, 460); ctx.restore();
}
export function canvasTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; texture.anisotropy = 1; return texture;
}
/** Same-origin raster request, decoded asynchronously before any canvas work. */
export function loadCoverImage(url: string | null, onLoad: (image: ImageBitmap | HTMLImageElement) => void): () => void {
  const controller = new AbortController(); let active = true; let bitmap: ImageBitmap | null = null; let image: HTMLImageElement | null = null;
  if (url) void (async () => {
    try {
      const resolved = new URL(url, window.location.href);
      if (resolved.origin !== window.location.origin || !/^https?:$/.test(resolved.protocol)) return;
      if (typeof createImageBitmap === 'function') {
        const response = await fetch(resolved, { signal: controller.signal, credentials: 'same-origin', redirect: 'error' });
        if (!response.ok) return;
        const blob = await response.blob();
        try {
          bitmap = await createImageBitmap(blob, { resizeWidth: 512, resizeQuality: 'high' });
          if (active) onLoad(bitmap); else bitmap.close();
          return;
        } catch { /* Some browsers cannot decode SVG thumbnails as bitmaps. */ }
      }
      if (!active) return;
      image = document.createElement('img'); image.decoding = 'async'; image.src = resolved.href;
      await image.decode(); if (active) onLoad(image);
    } catch { /* Keep the previous cover, or the generated cover on first load. */ }
  })();
  return () => { active = false; controller.abort(); bitmap?.close(); image?.removeAttribute('src'); };
}
export function drawCoverImage(ctx: CanvasRenderingContext2D, image: ImageBitmap | HTMLImageElement, width = 512, height = 384) {
  const iw = image instanceof HTMLImageElement ? image.naturalWidth : image.width;
  const ih = image instanceof HTMLImageElement ? image.naturalHeight : image.height;
  const scale = Math.min(width / iw, height / ih), w = iw * scale, h = ih * scale;
  ctx.fillStyle = '#FFF8E7'; ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
}

/** A cover owns one fixed texture pair until it leaves this gallery; frames and arcade share it. */
export type CoverResource = { releaseId: string; texture: CanvasTexture; screen: ScreenTexture; update: (releaseId: string, url: string | null, fallback?: { name: string; gameId: string }) => void; dispose: () => void };
export function coverFor(cache: Map<string, CoverResource>, item: { gameId: string; version: number | null; releaseId: string; projectId: string; name: string }, url: string | null, invalidate: () => void, slot = 0): CoverResource {
  // A gallery slot owns its textures across releases, games and status updates.
  const key = String(slot), hit = cache.get(key);
  if (hit) { if (hit.releaseId !== item.releaseId) hit.update(item.releaseId, url, item); return hit; }
  const screen = createScreenTexture(512, 384, invalidate);
  screen.draw(ctx => drawGeneratedCover(ctx, item.name, item.gameId, 512, 384));
  let cancel = () => {};
  let metadata = { name: item.name, gameId: item.gameId };
  const resource: CoverResource = {
    releaseId: '', texture: screen.texture, screen,
    update(releaseId, source, fallback) {
      if (resource.releaseId) screen.cancel();
      resource.releaseId = releaseId; cancel();
      if (fallback) metadata = fallback;
      screen.draw(ctx => drawGeneratedCover(ctx, metadata.name, metadata.gameId, 512, 384));
      cancel = loadCoverImage(source, image => screen.draw(ctx => drawCoverImage(ctx, image)));
    },
    dispose() { cancel(); screen.dispose(); },
  };
  resource.update(item.releaseId, url); cache.set(key, resource); return resource;
}
