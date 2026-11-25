import '../verify-loader.mjs';
import assert from 'node:assert/strict';
const frames = [];
globalThis.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
let ink = 0;
const noop = () => {};
globalThis.document = { createElement(kind) {
  assert.equal(kind, 'canvas');
  const canvas = { width: 0, height: 0, getContext: () => context };
  const context = new Proxy({ getImageData: () => ({ data: new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(ink) }), createLinearGradient: () => ({ addColorStop: noop }) }, { get: (o,k) => o[k] ?? noop, set: (o,k,v) => { o[k] = v; return true; } });
  return canvas;
} };
const { createScreenTexture, setScreenUploader } = await import('./screenTexture.ts');
const { textureCounters } = await import('../textureStats.ts');
let inFrame = 0, maxUploads = 0;
setScreenUploader(texture => { inFrame++; texture.onUpdate(texture); });
const tick = () => { inFrame = 0; frames.shift()?.(0); maxUploads = Math.max(maxUploads,inFrame); assert(inFrame<=1, 'one actual initTexture upload per RAF'); };
const flush = () => { while (frames.length) tick(); };
const a = createScreenTexture(2048,1024,noop), b = createScreenTexture(512,384,noop);
assert.equal(a.texture.image.width,512); assert.equal(a.texture.image.height,256);
a.draw(()=>{ink=1;}); b.draw(()=>{ink=2;});
assert.equal(textureCounters.uploads,0); tick(); assert.equal(textureCounters.uploads,1); tick(); assert.equal(textureCounters.uploads,2);
for (let poll=0; poll<20; poll++) { a.draw(()=>{ink=1;}); b.draw(()=>{ink=2;}); flush(); }
assert.equal(textureCounters.uploads,2,'identical canvases never set needsUpdate/upload');
a.dispose(); b.dispose();
assert.equal(textureCounters.live, 0);
console.log(`Texture checks passed (max ${maxUploads} uploads per frame).`);
