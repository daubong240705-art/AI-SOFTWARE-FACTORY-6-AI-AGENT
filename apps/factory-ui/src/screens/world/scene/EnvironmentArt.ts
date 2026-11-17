import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { palette, type ArtKind, type ArtPanel } from '../layout/zones';

const tileWidth = 256, tileHeight = 160, columns = 4;
const screens = new Set<ArtKind>(['design', 'rules', 'art', 'client', 'qa', 'lead', 'owner', 'game']);
const accents = [palette.rose, palette.sky, palette.sage, palette.butter, palette.lavender, palette.mint];
// All imagery is local canvas drawing: no image requests, logos, blob URLs or external fonts.
function drawTile(ctx: CanvasRenderingContext2D, kind: ArtKind, text?: string) {
  const rect = (color: string, x: number, y: number, w: number, h: number) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
  const circle = (color: string, x: number, y: number, r: number) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
  const line = (color: string, points: number[], width = 3) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
    for (let i = 0; i < points.length; i += 2) { if (i === 0) ctx.moveTo(points[i]!, points[i + 1]!); else ctx.lineTo(points[i]!, points[i + 1]!); }
    ctx.stroke();
  };
  const words = (value: string, x: number, y: number, size = 15, color = palette.ink) => {
    ctx.font = `600 ${size}px "Inter Variable"`; ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(value, x, y, 236);
  };
  const sketch = (x: number, y: number, scale = 1) => {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    circle(palette.butter, 0, -15, 21); circle(palette.rose, -16, -30, 9); circle(palette.rose, 16, -30, 9);
    circle(palette.ink, -7, -17, 2.5); circle(palette.ink, 7, -17, 2.5);
    line(palette.ink, [-5, -7, 0, -4, 5, -7], 2);
    rect(palette.sage, -17, 7, 34, 30); line(palette.ink, [-13, 39, -18, 49], 5); line(palette.ink, [13, 39, 18, 49], 5);
    ctx.restore();
  };
  const game = (x: number, y: number, w: number, h: number) => {
    rect(palette.sky, x, y, w, h); circle(palette.butter, x + w * 0.8, y + h * 0.2, h * 0.12);
    rect(palette.sage, x, y + h * 0.75, w, h * 0.25);
    rect(palette.wood, x + w * 0.12, y + h * 0.57, w * 0.23, h * 0.08);
    rect(palette.wood, x + w * 0.58, y + h * 0.4, w * 0.25, h * 0.08);
    sketch(x + w * 0.45, y + h * 0.43, h / 150);
    for (let i = 0; i < 3; i++) circle(palette.butter, x + w * (0.6 + i * 0.09), y + h * 0.28, h * 0.035);
  };
  if (kind === 'sign') {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '600 96px "Inter Variable"';
    ctx.fillStyle = text === 'Lazy Studio' ? palette.cream : palette.ink;
    if (text === 'Lazy Studio') { ctx.shadowColor = palette.mint; ctx.shadowBlur = 12; }
    ctx.fillText(text ?? '', 128, 80, 245); ctx.shadowBlur = 0; return;
  }
  rect(screens.has(kind) ? '#293D46' : palette.cream, 0, 0, 256, 160);
  if (screens.has(kind)) {
    rect('#40545C', 0, 0, 256, 18);
    for (let i = 0; i < 3; i++) circle(accents[i]!, 10 + i * 11, 9, 3);
    words('STUDIO / ' + kind.toUpperCase(), 52, 10, 10, palette.cream);
  }
  switch (kind) {
    case 'design':
      rect('#F6EBD3', 10, 26, 236, 124);
      for (let x = 10; x < 247; x += 16) line('#D6C9B1', [x, 26, x, 150], 1);
      for (let y = 26; y < 151; y += 16) line('#D6C9B1', [10, y, 246, y], 1);
      line(palette.ink, [27, 123, 27, 94, 78, 94, 78, 64, 155, 64, 155, 109, 225, 109], 4);
      sketch(123, 89, 0.5); words('LEVEL 01 · SKETCH', 18, 140, 11); break;
    case 'rules':
    case 'client':
      rect('#354952', 8, 26, 30, 126);
      for (let i = 0; i < 10; i++) {
        words(String(i + 1).padStart(2, '0'), 13, 33 + i * 12, 9, palette.sky);
        rect(accents[i % 6]!, 48 + (i % 3) * 8, 30 + i * 12, 55 + (i * 29 % 104), 4);
        rect('#718C93', 49 + (i % 3) * 8, 36 + i * 12, 24 + (i * 7 % 50), 2);
      }
      if (kind === 'client') { rect(palette.cream, 140, 71, 109, 82); game(145, 76, 99, 72); } break;
    case 'art':
      rect(palette.cream, 36, 25, 164, 126); rect('#5C6A70', 6, 25, 23, 126);
      for (let i = 0; i < 6; i++) { rect(accents[i]!, 11, 31 + i * 18, 12, 12); circle(accents[i]!, 225, 39 + i * 20, 7); }
      sketch(116, 80, 1); words('brush · 08', 44, 141, 10); break;
    case 'qa':
      words('TEST PLAN / DEMO', 12, 33, 14, palette.cream);
      for (let i = 0; i < 5; i++) {
        const y = 48 + i * 20, color = i === 3 ? palette.rose : palette.mint;
        rect('#40545C', 10, y, 235, 16); rect(color, 14, y + 3, 10, 10);
        words(['input', 'round loop', 'save / load', 'edge case', 'viewport'][i]!, 33, y + 8, 11, palette.cream);
        words(i === 3 ? '×' : '✓', 220, y + 8, 13, color);
      } break;
    case 'lead':
      for (let col = 0; col < 3; col++) {
        const x = 10 + col * 81; rect('#40545C', x, 28, 73, 122);
        rect(accents[col]!, x + 4, 32, 65, 6);
        for (let row = 0; row < 3 - col % 2; row++) {
          rect(accents[(col + row) % 6]!, x + 7, 47 + row * 32, 59, 26);
          rect('#60706B', x + 12, 54 + row * 32, 40, 3); rect('#60706B', x + 12, 62 + row * 32, 27, 2);
        }
      } break;
    case 'owner':
      words('LAZY / OVERVIEW', 14, 34, 14, palette.cream);
      for (let i = 0; i < 3; i++) { rect('#40545C', 12 + i * 81, 48, 72, 28); rect(accents[i + 2]!, 19 + i * 81, 55, 40, 5); rect(palette.cream, 19 + i * 81, 65, 25, 4); }
      for (let i = 0; i < 8; i++) rect(accents[i % 6]!, 15 + i * 19, 139 - (i * 11 % 46), 12, 10 + (i * 11 % 46));
      line(palette.mint, [178, 133, 192, 117, 207, 122, 221, 98, 243, 87], 4); break;
    case 'game': game(8, 25, 240, 127); break;
    case 'sticky':
      words('Ý tưởng cùng nhau', 14, 18, 17);
      for (let col = 0; col < 3; col++) {
        line('#B9C7BC', [13 + col * 81, 39, 78 + col * 81, 39], 2);
        for (let row = 0; row < 2; row++) {
          const x = 17 + col * 81, y = 48 + row * 49;
          rect(accents[(col + row) % 6]!, x, y, 56, 38);
          line(palette.darkWood, [x + 8, y + 12, x + 44, y + 12], 2);
          line(palette.darkWood, [x + 8, y + 21, x + 31, y + 21], 2);
        }
      } break;
    case 'caro':
      rect(palette.sky, 0, 0, 256, 160); words('Cờ caro', 19, 23, 24);
      for (let i = 0; i < 4; i++) { line(palette.cream, [82 + i * 29, 47, 82 + i * 29, 142], 2); line(palette.cream, [66, 58 + i * 25, 186, 58 + i * 25], 2); }
      for (let i = 0; i < 3; i++) { line(palette.ink, [90 + i * 29, 67 + i * 25, 102 + i * 29, 79 + i * 25]); line(palette.ink, [102 + i * 29, 67 + i * 25, 90 + i * 29, 79 + i * 25]); }
      ctx.strokeStyle = palette.rose; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(126, 73, 8, 0, Math.PI * 2); ctx.stroke(); break;
    case 'uno':
      rect(palette.rose, 0, 0, 256, 160); words('UNO · Đổi màu!', 17, 24, 22);
      for (let i = 0; i < 4; i++) { rect(palette.cream, 33 + i * 47, 49 + i % 2 * 10, 43, 86); rect(accents[i + 1]!, 37 + i * 47, 53 + i % 2 * 10, 35, 78); words(String(i + 2), 44 + i * 47, 91 + i % 2 * 10, 27); } break;
    case 'baucua':
      rect(palette.mint, 0, 0, 256, 160); words('Bầu Cua', 18, 23, 24);
      for (let i = 0; i < 6; i++) {
        const x = 50 + (i % 3) * 78, y = 66 + Math.floor(i / 3) * 57;
        rect(palette.cream, x - 26, y - 22, 52, 45); circle(accents[i]!, x, y, 14);
        if (i % 2) { line(palette.ink, [x - 17, y - 13, x + 17, y + 13], 2); line(palette.ink, [x + 17, y - 13, x - 17, y + 13], 2); }
        circle(palette.ink, x - 5, y - 3, 2); circle(palette.ink, x + 5, y - 3, 2);
      } break;
    case 'taixiu':
      rect(palette.lavender, 0, 0, 256, 160); words('Tài Xỉu · Xúc xắc', 15, 24, 22);
      for (let i = 0; i < 3; i++) { const x = 28 + i * 78; rect(palette.cream, x, 64, 58, 58); for (let dot = 0; dot <= i; dot++) circle(palette.ink, x + 15 + dot * 13, 80 + dot * 13, 4); } break;
  }
}

export async function makeArtwork(panels: ArtPanel[], gradient: THREE.Texture) {
  await document.fonts.load('600 32px "Inter Variable"');
  const tiles = [...new Map(panels.map(p => [`${p.kind}:${p.text ?? ''}`, p])).values()];
  const canvas = document.createElement('canvas'); canvas.width = columns * tileWidth;
  canvas.height = Math.ceil(tiles.length / columns) * tileHeight;
  const ctx = canvas.getContext('2d')!;
  const lookup = new Map<string, number>();
  tiles.forEach((tile, index) => {
    lookup.set(`${tile.kind}:${tile.text ?? ''}`, index);
    ctx.save(); ctx.translate(index % columns * tileWidth, Math.floor(index / columns) * tileHeight);
    ctx.beginPath(); ctx.rect(0, 0, tileWidth, tileHeight); ctx.clip(); drawTile(ctx, tile.kind, tile.text); ctx.restore();
  });
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  // A half-texel inset prevents neighbouring atlas cells bleeding into monitor edges.
  const geometryFor = (panel: ArtPanel) => {
    const index = lookup.get(`${panel.kind}:${panel.text ?? ''}`)!;
    const x = index % columns * tileWidth, y = Math.floor(index / columns) * tileHeight;
    const plane = new THREE.PlaneGeometry(panel.width, panel.height), uv = plane.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (x + 0.5 + uv.getX(i) * (tileWidth - 1)) / canvas.width, 1 - (y + 0.5 + (1 - uv.getY(i)) * (tileHeight - 1)) / canvas.height);
    plane.rotateY(panel.yaw); plane.translate(...panel.position); return plane;
  };
  const printed = new THREE.MeshToonMaterial({ map: texture, gradientMap: gradient, alphaTest: 0.1 });
  const emissive = new THREE.MeshToonMaterial({ map: texture, emissiveMap: texture, emissive: 'white', emissiveIntensity: 0.55, gradientMap: gradient });
  const neon = new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.1 });
  const group = new THREE.Group(), geometries: THREE.BufferGeometry[] = [];
  const batches = [panels.filter(p => !screens.has(p.kind) && p.text !== 'Lazy Studio'), panels.filter(p => screens.has(p.kind)), panels.filter(p => p.text === 'Lazy Studio')];
  batches.forEach((batch, index) => {
    if (!batch.length) return;
    const pieces = batch.map(geometryFor), geometry = mergeGeometries(pieces)!;
    pieces.forEach(p => p.dispose()); geometries.push(geometry);
    group.add(new THREE.Mesh(geometry, [printed, emissive, neon][index]!));
  });
  return { group, dispose() { geometries.forEach(g => g.dispose()); printed.dispose(); emissive.dispose(); neon.dispose(); texture.dispose(); } };
}
