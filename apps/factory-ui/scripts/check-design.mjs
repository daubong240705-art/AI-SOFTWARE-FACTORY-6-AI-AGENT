// Small design checks that match the running app (docs/ui/02-huong-dan-giao-dien.md):
// vi/en label parity in design/factory-v2/labels.*.json and text contrast of the real palette (src/styles/palette.css).
// The src/i18n/extra.*.ts labels are already kept in parity by TypeScript.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(app, path), 'utf8');
const failures = [];

const flatten = (value, prefix = '') => Object.fromEntries(Object.entries(value).flatMap(([key, child]) =>
  child && typeof child === 'object' ? Object.entries(flatten(child, `${prefix}${key}.`)) : [[`${prefix}${key}`, child]]));
const vi = flatten(JSON.parse(read('../../design/factory-v2/labels.vi.json')));
const en = flatten(JSON.parse(read('../../design/factory-v2/labels.en.json')));
const placeholders = (text) => typeof text === 'string' ? [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join() : '';
for (const key of new Set([...Object.keys(vi), ...Object.keys(en)])) {
  if (!(key in vi) || !(key in en)) failures.push(`label ${key} exists in only one locale`);
  else if (placeholders(vi[key]) !== placeholders(en[key])) failures.push(`label ${key} has different {placeholders}`);
}

const palette = read('src/styles/palette.css');
const block = (selector) => {
  const start = palette.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`palette.css: missing block ${selector}`);
  const body = palette.slice(start, palette.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[\da-f]{6})\b/gi)].map((m) => [m[1], m[2]]));
};
const themes = { dark: block(':root, [data-theme="dark"]'), light: block('[data-theme="light"]') };
const luminance = (hex) => hex.slice(1).match(/../g).map((n) => parseInt(n, 16) / 255)
  .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
  .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// [foreground, background, minimum]. 4.5 is WCAG AA for body text.
const pairs = [
  ['text', 'bg', 4.5], ['text', 'surface', 4.5], ['text', 'raised', 4.5], ['text', 'sidebar-bg', 4.5],
  ['muted', 'bg', 4.5], ['muted', 'surface', 4.5], ['muted', 'sidebar-bg', 4.5],
  ['need', 'bg', 4.5], ['need', 'surface', 4.5], ['run', 'surface', 4.5], ['ok', 'surface', 4.5], ['info', 'surface', 4.5],
  ['error', 'error-surface', 4.5], ['on-primary', 'text', 4.5], ['on-need', 'need', 4.5],
];
const report = [];
for (const [theme, colors] of Object.entries(themes)) {
  for (const [fg, bg, minimum] of pairs) {
    if (!colors[fg] || !colors[bg]) { failures.push(`${theme}: --${fg} or --${bg} missing in palette.css`); continue; }
    const value = ratio(colors[fg], colors[bg]);
    report.push(`${theme.padEnd(5)} ${`${fg}/${bg}`.padEnd(22)} ${value.toFixed(2)}`);
    if (value < minimum) failures.push(`${theme}: --${fg} on --${bg} contrast ${value.toFixed(2)} < ${minimum}`);
  }
}

console.log(`labels: ${Object.keys(vi).length} keys per locale\ncontrast:\n${report.join('\n')}`);
if (failures.length) { console.error(`\nFAILED\n${failures.join('\n')}`); process.exitCode = 1; }
else console.log('\nOK');
