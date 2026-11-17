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
/** Covers remain generated on 404/error. No fetch, blob, data URL or remote image. */
export function loadCoverImage(url: string | null, onLoad: (image: HTMLImageElement) => void): () => void {
  if (!url) return () => {};
  try {
    const resolved = new URL(url, window.location.href);
    if (resolved.origin !== window.location.origin || !/^https?:$/.test(resolved.protocol)) return () => {};
    const image = document.createElement('img'); image.decoding = 'async';
    // Install handlers before assigning src, including for cached SVG responses.
    image.onload = () => { if (image.naturalWidth && image.naturalHeight) onLoad(image); };
    image.onerror = () => {};
    image.src = resolved.href;
    return () => { image.onload = null; image.onerror = null; image.removeAttribute('src'); };
  } catch { return () => {}; }
}
export function drawCoverImage(ctx: CanvasRenderingContext2D, image: HTMLImageElement, width = 512, height = 320) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const w = image.naturalWidth * scale; const h = image.naturalHeight * scale;
  ctx.fillStyle = '#FFF8E7'; ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
}

/** A cover owns one texture until it leaves this gallery; frames and arcade share it. */
export type CoverResource = { releaseId: string; texture: CanvasTexture; dispose: () => void };
export function coverFor(cache: Map<string, CoverResource>, item: { gameId: string; version: number | null; releaseId: string; projectId: string; name: string }, url: string | null, invalidate: () => void): CoverResource {
  const key = `${item.gameId}:${item.version ?? item.releaseId}`;
  const hit = cache.get(key); if (hit?.releaseId === item.releaseId) return hit;
  hit?.dispose();
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 320;
  const ctx = canvas.getContext('2d')!;
  drawGeneratedCover(ctx, item.name, item.gameId);
  const texture = canvasTexture(canvas);
  let disposed = false;
  const cancel = loadCoverImage(url, image => {
    if (disposed) return;
    drawCoverImage(ctx, image); texture.needsUpdate = true; invalidate();
  });
  const resource = { releaseId: item.releaseId, texture, dispose() { disposed = true; cancel(); texture.dispose(); } };
  cache.set(key, resource); return resource;
}
