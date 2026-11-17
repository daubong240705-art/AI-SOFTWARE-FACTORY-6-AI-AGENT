// Check the mounted studio and lineup without writing another build.
// Run from apps/factory-ui: node src/screens/world/characters/verify-bundle.mjs
import { build } from 'vite';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
const result = await build({
  configLoader: 'runner', logLevel: 'error',
  build: { write: false, reportCompressedSize: false },
});
const outputs = (Array.isArray(result) ? result : [result]).flatMap(bundle => bundle.output);
let rendererGzip = 0;
for (const output of outputs) {
  if (output.type !== 'chunk') continue;
  if (output.isEntry) assert(!/WebGLRenderer|__THREE__|react-three/.test(output.code), 'No three/R3F entry leakage');
  if (!output.code.includes('WebGLRenderer')) continue;
  const gzip = gzipSync(output.code).length; rendererGzip += gzip;
  console.log(`Renderer with Lineup: ${output.fileName}: ${gzip} B gzip`);
}
assert(rendererGzip > 0 && rendererGzip <= 300 * 1024, `Renderer budget exceeded: ${rendererGzip}`);
console.log('In-memory studio integration: PASS (≤307200 B gzip; no entry 3D leakage; no source/build files written).');
