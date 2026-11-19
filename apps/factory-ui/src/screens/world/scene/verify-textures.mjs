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
const { coverFor, loadCoverImage } = await import('./gallery/coverTexture.ts');
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
const cache = new Map(), item = { projectId: 'p',gameId:'g',releaseId:'r1',version:1,name:'Game' };
const cover = coverFor(cache,item,null,noop); flush();
const uploads = textureCounters.uploads, live = textureCounters.live, texture = cover.texture;
for (let poll=0;poll<20;poll++) { assert.equal(coverFor(cache,{...item,playing:poll},null,noop),cover); flush(); }
assert.equal(textureCounters.uploads,uploads); assert.equal(textureCounters.live,live);
ink=3; coverFor(cache,{...item,releaseId:'r2'},null,noop); flush(); assert.equal(cover.texture,texture);
assert.equal(textureCounters.uploads,uploads+1,'new release updates existing texture');
ink=4; a.draw(()=>{}); a.dispose(); flush(); assert.equal(textureCounters.uploads,uploads+1,'disposed queued upload is cancelled');
b.dispose(); cover.dispose(); assert.equal(textureCounters.live,0);
// Decode and cancellation are exercised without network access.
globalThis.window = { location: { href:'https://factory.invalid/world', origin:'https://factory.invalid' } };
let requests=0, decode, closed=0, loaded=0;
globalThis.fetch = async () => { requests++; return { ok:true, blob: async()=>new Blob(['offline fixture']) }; };
globalThis.createImageBitmap = async (blob, options) => { assert(blob instanceof Blob); assert.equal(options.resizeWidth,512); return new Promise(resolve=>{decode=resolve;}); };
const cancel = loadCoverImage('/thumbnail',()=>loaded++);
for(let i=0;i<8;i++) await Promise.resolve();
cancel(); decode({ width:512,height:384,close(){closed++;} });
for(let i=0;i<8;i++) await Promise.resolve();
assert.equal(loaded,0); assert.equal(closed,1); assert.equal(requests,1);
// Unsupported bitmap decode falls back to async img.decode on the fetched blob.
globalThis.createImageBitmap = async()=>{throw new Error('unsupported fixture');};
let decoded=false;
globalThis.document.createElement=kind=>{ assert.equal(kind,'img'); return { set decoding(value){assert.equal(value,'async');}, set src(value){assert(value.startsWith('blob:'));}, decode:async()=>{decoded=true;},removeAttribute:noop }; };
const fallbackCancel=loadCoverImage('/thumbnail',()=>loaded++);
for(let i=0;i<16;i++) await Promise.resolve();
assert(decoded); assert.equal(loaded,1); assert.equal(requests,2,'fallback reuses fetched blob'); fallbackCancel();
console.log(`Dynamic texture PASS (single texture, <=512px, 40 identical updates flat, release reuse, stale decode/disposal, async bitmap + fallback, max uploads/frame=${maxUploads}, live=0)`);

// Real gallery resources survive both identical polls and changing releases.
const canvasDocument = globalThis.document;
canvasDocument.createElement = kind => {
  assert.equal(kind,'canvas');
  const canvas = { width:0,height:0,getContext:()=>ctx };
  const ctx = new Proxy({ getImageData:()=>({data:new Uint8ClampedArray(canvas.width*canvas.height*4).fill(ink)}),createLinearGradient:()=>({addColorStop:noop}) },{get:(o,k)=>o[k]??noop,set:(o,k,v)=>{o[k]=v;return true;}});
  return canvas;
};
globalThis.fetch=async()=>({ok:false}); // no live request, retain generated cover
const { makeGallery } = await import('./gallery/Gallery.tsx');
const atlas = createScreenTexture(2048,2048,noop), galleryCovers = new Map();
const gallery = makeGallery([], '',noop,galleryCovers,atlas);
const release = { ...item, state:'done',enabled:true,current:true,playing:0,playUrl:null };
gallery.update([release]); flush();
const inventory = () => { const ids=[]; gallery.group.traverse(o=>{if(o.isMesh)ids.push([o.geometry.uuid,o.material.uuid]);}); return ids; };
const resources=inventory(), galleryUploads=textureCounters.uploads, galleryLive=textureCounters.live;
for(let poll=0;poll<20;poll++) { gallery.update([{...release}]); flush(); }
assert.deepEqual(inventory(),resources,'identical polls retain every material and geometry');
assert.equal(textureCounters.live,galleryLive); assert.equal(textureCounters.uploads,galleryUploads);
const firstCover=galleryCovers.get('0').texture;
gallery.update([{...release,releaseId:'r3',playing:4,state:'pending'}]); flush();
assert.deepEqual(inventory(),resources,'changed status/release also retains materials and geometry');
assert.equal(galleryCovers.get('0').texture,firstCover);
gallery.dispose(); atlas.dispose(); galleryCovers.forEach(c=>c.dispose()); assert.equal(textureCounters.live,0);
console.log('Persistent gallery PASS (polls/releases reuse geometry, materials and slot textures; live=0 after disposal)');
