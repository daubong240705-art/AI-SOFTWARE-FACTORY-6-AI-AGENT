import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const baseline = JSON.parse(await readFile(new URL('./world-bundle-baseline.json', import.meta.url), 'utf8'));
const html = await readFile(path.join(dist, 'index.html'), 'utf8');
const entries = new Set();
for (const tag of html.match(/<(?:script|link)\b[^>]*>/gi) ?? []) {
  const attributes = Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map(match => [match[1].toLowerCase(), match[2]]));
  const source = /^<script\b/i.test(tag) ? attributes.src
    : attributes.rel?.split(/\s+/).includes('modulepreload') ? attributes.href : undefined;
  if (!source) continue;
  const url = new URL(source, 'https://factory.invalid/');
  if (url.origin !== 'https://factory.invalid') throw new Error('Entry must be local');
  if (url.pathname.endsWith('.js')) entries.add(path.join(dist, decodeURIComponent(url.pathname).replace(/^\/+/, '')));
}
if (!entries.size) throw new Error('No entry/preload JS found in dist/index.html');
async function javascriptFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await javascriptFiles(location));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(location);
  }
  return files;
}
const failures = [];
let entryJsGz = 0;
for (const entry of entries) {
  const content = await readFile(entry);
  entryJsGz += gzipSync(content).length;
  if (/WebGLRenderer|__THREE__|react-three/.test(content.toString())) failures.push(`3D code leaked into entry/preload: ${path.relative(dist, entry)}`);
}
const lazy = [];
for (const file of await javascriptFiles(dist)) {
  const content = await readFile(file);
  if (content.includes('WebGLRenderer') && !entries.has(file)) lazy.push({ name: path.relative(dist, file), gz: gzipSync(content).length });
}
if (!lazy.length) failures.push('No lazy WebGLRenderer chunk found');
// W-18b: operator approved richer procedural toys; entry isolation remains mandatory.
const worldLimit = 384 * 1024;
const lazyJsGz = lazy.reduce((total, chunk) => total + chunk.gz, 0);
const growth = entryJsGz - baseline.entryJsGz;
const entryGrowthLimit = 4 * 1024;
if (growth > entryGrowthLimit) failures.push(`Entry growth ${growth} exceeds ${entryGrowthLimit} bytes`);
if (lazyJsGz > worldLimit) failures.push(`Lazy renderer gzip ${lazyJsGz} exceeds ${worldLimit} bytes`);
console.log(`World bundle: entry/preload ${entryJsGz} B gzip; baseline ${baseline.entryJsGz} B; growth ${growth >= 0 ? '+' : ''}${growth} B (limit +${entryGrowthLimit} B)`);
console.log(`Lazy renderer: ${lazyJsGz} B gzip (limit ${worldLimit} B); ${lazy.map(chunk => `${chunk.name}: ${chunk.gz} B`).join(', ')}`);
console.log(`Entry 3D isolation: ${failures.some(failure => failure.startsWith('3D code leaked')) ? 'FAIL' : 'PASS'}`);
if (failures.length) { failures.forEach(failure => console.error(failure)); process.exitCode = 1; }
else console.log('World bundle guard: PASS');
