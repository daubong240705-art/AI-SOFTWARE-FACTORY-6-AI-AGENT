import * as THREE from 'three';
import { poseLabels } from '../copy';
import { characterCodes } from './specs';

export const effectGlyphs = ['…', '!', '✦', '☁ ×', 'Zzz'] as const;
const labels = [...effectGlyphs, '</>', ...characterCodes, ...Object.values(poseLabels).flatMap(label => [label.vi, label.en])];
const columns = 6; const tileWidth = 256; const tileHeight = 96;
const rows = Math.ceil(labels.length / columns);
type Resources = {
  toon: THREE.MeshToonMaterial; outline: THREE.MeshBasicMaterial;
  text: THREE.MeshBasicMaterial; sprite: THREE.SpriteMaterial;
  atlas: THREE.CanvasTexture; gradient: THREE.DataTexture;
  regions: Map<string, THREE.PlaneGeometry>;
};
let resources: Resources | undefined;

/** One canvas atlas for effects, laptop screens and review labels; no external images or fonts. */
function drawAtlas(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  labels.forEach((label, index) => {
    const x = index % columns * tileWidth; const y = Math.floor(index / columns) * tileHeight;
    if (label === '…' || label === '!') {
      ctx.fillStyle = '#FFFAF0'; ctx.beginPath(); ctx.roundRect(x + 12, y + 8, tileWidth - 24, tileHeight - 16, 25); ctx.fill();
      ctx.strokeStyle = '#0E0E16'; ctx.lineWidth = 5; ctx.stroke();
    }
    ctx.font = `${label.length > 10 ? 24 : 36}px "Inter Variable", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = label === '</>' ? '#3ED9A2' : label === '✦' ? '#E2A72D' : label === 'Zzz' ? '#657397' : '#0E0E16';
    if (label === '☁ ×') {
      ctx.fillStyle = '#9B9FAA'; ctx.fillText('☁', x + 96, y + 48);
      ctx.fillStyle = '#CF5058'; ctx.fillText('×', x + 160, y + 48);
    } else ctx.fillText(label, x + tileWidth / 2, y + tileHeight / 2);
  });
}
export function characterResources(): Resources {
  if (resources) return resources;
  const gradient = new THREE.DataTexture(new Uint8Array([95, 170, 255]), 3, 1, THREE.RedFormat);
  gradient.minFilter = THREE.NearestFilter; gradient.magFilter = THREE.NearestFilter; gradient.needsUpdate = true;
  const canvas = document.createElement('canvas'); canvas.width = columns * tileWidth; canvas.height = rows * tileHeight;
  drawAtlas(canvas);
  const atlas = new THREE.CanvasTexture(canvas); atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.generateMipmaps = false; atlas.minFilter = THREE.LinearFilter;
  const result: Resources = {
    toon: new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradient }),
    outline: new THREE.MeshBasicMaterial({ color: '#0E0E16', side: THREE.BackSide }),
    text: new THREE.MeshBasicMaterial({ map: atlas, transparent: true, depthWrite: false, toneMapped: false }),
    sprite: new THREE.SpriteMaterial({ map: atlas, transparent: true, depthWrite: false, toneMapped: false }),
    atlas, gradient, regions: new Map(),
  };
  resources = result;
  // Redraw once the bundled variable font is ready, without starting an animation loop.
  if (document.fonts) void document.fonts.load('36px "Inter Variable"').then(() => {
    if (resources !== result) return;
    drawAtlas(canvas); atlas.needsUpdate = true; atlasChanged.forEach(invalidate => invalidate());
  }).catch(() => { /* The system sans-serif fallback keeps labels readable. */ });
  return result;
}
const atlasChanged = new Set<() => void>();
export function subscribeAtlas(invalidate: () => void) { atlasChanged.add(invalidate); return () => { atlasChanged.delete(invalidate); }; }
export function glyphGeometry(label: string) {
  const assets = characterResources(); const cached = assets.regions.get(label); if (cached) return cached;
  const index = labels.indexOf(label); if (index < 0) throw new Error(`Unknown character atlas label: ${label}`);
  const column = index % columns; const row = Math.floor(index / columns);
  const geometry = new THREE.PlaneGeometry(1, 1); const uv = geometry.getAttribute('uv');
  // Half-pixel inset prevents adjacent atlas cells bleeding through linear filtering.
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i,
    (column * tileWidth + 1 + uv.getX(i) * (tileWidth - 2)) / assets.atlas.image.width,
    1 - (row * tileHeight + 1 + (1 - uv.getY(i)) * (tileHeight - 2)) / assets.atlas.image.height);
  assets.regions.set(label, geometry); return geometry;
}
export function glyphMesh(label: string, width: number, height: number) {
  const mesh = new THREE.Mesh(glyphGeometry(label), characterResources().text); mesh.scale.set(width, height, 1); return mesh;
}
export function glyphSprite(label: string, width: number, height: number) {
  const sprite = new THREE.Sprite(characterResources().sprite); sprite.geometry = glyphGeometry(label); sprite.scale.set(width, height, 1); return sprite;
}
export function sharedMaterialCount() { return resources ? 4 : 0; }
export function disposeCharacterResources() {
  if (!resources) return;
  const { toon, outline, text, sprite, atlas, gradient, regions } = resources;
  toon.dispose(); outline.dispose(); text.dispose(); sprite.dispose(); atlas.dispose(); gradient.dispose();
  regions.forEach(geometry => geometry.dispose()); resources = undefined;
}
