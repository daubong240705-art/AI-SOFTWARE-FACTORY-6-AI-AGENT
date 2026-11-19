import * as THREE from 'three';
import { textureCounters } from '../textureStats';

// All dynamic canvases share this queue. initTexture uploads immediately in the
// scheduled frame, even when the scene itself renders at a lower frame rate.
const jobs = new Map<object, () => void>();
let frame = 0;
let upload: ((texture: THREE.Texture) => void) | undefined;
export function setScreenUploader(value: ((texture: THREE.Texture) => void) | undefined) { upload = value; }
export function queueScreen(key: object, paint: () => void) {
  jobs.set(key, paint);
  if (!frame) frame = requestAnimationFrame(tick);
}
function tick() {
  frame = 0;
  const first = jobs.entries().next().value;
  if (first) { jobs.delete(first[0]); first[1](); }
  if (jobs.size && !frame) frame = requestAnimationFrame(tick);
}
export function cancelScreen(key: object) { jobs.delete(key); }

/** One canvas and GPU texture per screen, retained through content changes.
 * Callers draw in logical coordinates; the backing store never exceeds 512px.
 * Pixel comparison also suppresses redundant font-ready/minute-timer uploads. */
export function createScreenTexture(width: number, height: number, invalidate: () => void) {
  const ratio = Math.min(1, 512 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  // Unlike CanvasTexture, Texture does not request an unqueued blank upload.
  const texture = new THREE.Texture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter; texture.anisotropy = 1;
  texture.onUpdate = () => { textureCounters.uploads++; };
  textureCounters.live++;
  const key = {}; let disposed = false, pixels: Uint8ClampedArray | undefined;
  return {
    texture,
    attach(material: THREE.Material) {
      // A stable map uses the stock shader: image changes never compile materials.
      if ('map' in material) material.map = texture;
    },
    draw(paint: (context: CanvasRenderingContext2D) => void) {
      queueScreen(key, () => {
        if (disposed) return;
        const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) return;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, width, height); context.save(); paint(context); context.restore();
        const next = context.getImageData(0, 0, canvas.width, canvas.height)?.data;
        if (pixels && next && pixels.length === next.length) {
          const before = new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.byteLength / 4);
          const after = new Uint32Array(next.buffer, next.byteOffset, next.byteLength / 4);
          let changed = false;
          for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) { changed = true; break; }
          if (!changed) return;
        }
        pixels = next;
        texture.needsUpdate = true; upload?.(texture); invalidate();
      });
    },
    cancel() { cancelScreen(key); },
    dispose() {
      if (disposed) return;
      disposed = true; cancelScreen(key); texture.dispose(); textureCounters.live--;
    },
  };
}
export type ScreenTexture = ReturnType<typeof createScreenTexture>;
