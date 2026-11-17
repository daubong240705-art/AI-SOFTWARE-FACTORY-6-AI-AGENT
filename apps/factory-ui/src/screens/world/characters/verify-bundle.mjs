// Check the future integration without changing the scene owner's files or writing a second build.
// Run from apps/factory-ui: node src/screens/world/characters/verify-bundle.mjs
import { build } from 'vite';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
let injected = false;
const result = await build({
  configLoader: 'runner',
  logLevel: 'error',
  plugins: [{
    name: 'w3-lineup-bundle-probe', enforce: 'pre',
    transform(source, id) {
      if (!id.endsWith('/screens/world/scene/WorldCanvas.tsx')) return;
      assert(source.includes('<StudioSlab />'), 'Expected the W-1 scene integration point');
      injected = true;
      return `import { Lineup } from './Lineup';\n${source.replace('<StudioSlab />', '<StudioSlab /><Lineup origin={[0, 0]} quality={quality} still={props.still} />')}`;
    },
  }],
  build: { write: false, reportCompressedSize: false },
});
assert(injected, 'Lineup was included in the renderer chunk');
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
console.log('In-memory Lineup integration: PASS (≤307200 B gzip; no entry 3D leakage; no source/build files written).');
