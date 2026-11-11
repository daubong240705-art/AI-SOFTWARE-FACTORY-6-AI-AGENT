import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const groups = [['fonts', 'font', ''], ['spacing', 'space', 'px'], ['radii', 'radius', 'px'],
  ['sizes', 'size', 'px'], ['layers', 'layer', ''], ['motion', 'motion', 'ms']];
const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const entries = (value) => object(value) && Object.keys(value).length > 0 &&
  Object.keys(value).every((key) => /^[a-z][a-zA-Z]*$/.test(key));
const numeric = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function renderTokens(tokens) {
  const invalid = () => { throw new Error('Invalid tokens.json: expected schemaVersion 2, token groups, typography, and matching light/dark palettes.'); };
  if (!object(tokens) || tokens.schemaVersion !== 2 || tokens.defaultTheme !== 'light') invalid();
  for (const [group] of groups) {
    if (!entries(tokens[group])) invalid();
    if (!Object.values(tokens[group]).every(group === 'fonts'
      ? (v) => typeof v === 'string' && /^[\w ,"'-]+$/.test(v)
      : numeric)) invalid();
  }
  if (!entries(tokens.typography)) invalid();
  for (const values of Object.values(tokens.typography)) {
    if (!object(values) || Object.keys(values).sort().join() !== 'lineHeight,size,weight' || !Object.values(values).every(numeric)) invalid();
  }
  if (!object(tokens.themes)) invalid();
  for (const theme of ['light', 'dark']) {
    if (!entries(tokens.themes[theme]) || !Object.values(tokens.themes[theme]).every((v) => typeof v === 'string' && /^#[\da-f]{6}([\da-f]{2})?$/i.test(v))) invalid();
  }
  if (Object.keys(tokens.themes.light).sort().join() !== Object.keys(tokens.themes.dark).sort().join()) invalid();
  const css = groups.flatMap(([group, prefix, suffix]) => Object.entries(tokens[group]).map(([name, value]) => `  --${prefix}-${kebab(name)}: ${value}${suffix};`));
  for (const [name, values] of Object.entries(tokens.typography))
    for (const [key, value] of Object.entries(values)) css.push(`  --type-${name}-${kebab(key)}: ${value}${key === 'weight' ? '' : 'px'};`);
  const themes = ['light', 'dark'].map((theme) => `${theme === 'light' ? ':root, ' : ''}[data-theme="${theme}"] {\n${Object.entries(tokens.themes[theme]).map(([key, value]) => `  --color-${kebab(key)}: ${value};`).join('\n')}\n}`).join('\n');
  return `/* Generated from design/factory-v2/tokens.json. */\n@font-face { font-family: 'Inter Variable'; font-style: normal; font-weight: 100 900; font-display: swap; src: url('/fonts/InterVariable.woff2') format('woff2'); }\n:root {\n${css.join('\n')}\n}\n${themes}\n`;
}

export function buildTokens({ source, output }) {
  let tokens;
  try { tokens = JSON.parse(readFileSync(join(source, 'tokens.json'), 'utf8')); }
  catch { throw new Error('Invalid tokens.json: cannot read or parse JSON.'); }
  const css = renderTokens(tokens);
  mkdirSync(join(output, 'src/styles'), { recursive: true });
  mkdirSync(join(output, 'public/fonts'), { recursive: true });
  writeFileSync(join(output, 'src/styles/tokens.css'), css, 'utf8');
  copyFileSync(join(source, 'assets/InterVariable.woff2'), join(output, 'public/fonts/InterVariable.woff2'));
  copyFileSync(join(source, 'assets/Inter-LICENSE.txt'), join(output, 'public/fonts/Inter-LICENSE.txt'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const output = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  try { buildTokens({ source: resolve(output, '../../design/factory-v2'), output }); }
  catch (error) { process.stderr.write(`Token build failed: ${error.message}\n`); process.exitCode = 1; }
}
