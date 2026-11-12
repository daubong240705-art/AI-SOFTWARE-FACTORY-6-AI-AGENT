// Crops each character of the mascot set (mascot/03_States_SVG, git-ignored source art) to one square box per character
// and writes the SVGs the UI uses. Run from the repository root: node scripts/crop-mascot-assets.mjs (needs playwright, installed in apps/factory-ui).
import { chromium } from '../apps/factory-ui/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
const src = 'mascot/03_States_SVG';
const dst = 'apps/factory-ui/src/assets/mascot/original';
const b = await chromium.launch(); const page = await b.newPage();
const result = {};
for (const code of readdirSync(src)) {
  const files = readdirSync(`${src}/${code}`).filter(f => f.endsWith('.svg')).sort();
  let x0 = 768, y0 = 768, x1 = 0, y1 = 0; const per = {};
  for (const f of files) {
    const svg = readFileSync(`${src}/${code}/${f}`, 'utf8');
    const box = await page.evaluate(async (svg) => {
      const img = new Image(); img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
      await img.decode(); const c = document.createElement('canvas'); c.width = 768; c.height = 768;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, 768, 768);
      const d = ctx.getImageData(0, 0, 768, 768).data; let a = 768, bb = 768, cc = 0, dd = 0;
      for (let y = 0; y < 768; y++) for (let x = 0; x < 768; x++) if (d[(y * 768 + x) * 4 + 3] > 16) { if (x < a) a = x; if (x > cc) cc = x; if (y < bb) bb = y; if (y > dd) dd = y; }
      return [a, bb, cc, dd];
    }, svg);
    per[f] = box; x0 = Math.min(x0, box[0]); y0 = Math.min(y0, box[1]); x1 = Math.max(x1, box[2]); y1 = Math.max(y1, box[3]);
  }
  const w = x1 - x0, h = y1 - y0, side = Math.ceil(Math.max(w, h) * 1.06); const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const vx = Math.round(cx - side / 2), vy = Math.round(cy - side / 2);
  result[code] = { box: [x0, y0, x1, y1], viewBox: [vx, vy, side, side] };
  mkdirSync(`${dst}/${code}`, { recursive: true });
  for (const f of files) {
    let svg = readFileSync(`${src}/${code}/${f}`, 'utf8').replace(/<!--[\s\S]*?-->\s*/g, '');
    svg = svg.replace('width="768" height="768" viewBox="0 0 768 768"', `width="256" height="256" viewBox="${vx} ${vy} ${side} ${side}"`);
    if (!svg.includes(`viewBox="${vx} ${vy}`)) throw new Error('viewBox not replaced ' + f);
    writeFileSync(`${dst}/${code}/${f}`, svg);
  }
}
console.log(JSON.stringify(result));
await b.close();
