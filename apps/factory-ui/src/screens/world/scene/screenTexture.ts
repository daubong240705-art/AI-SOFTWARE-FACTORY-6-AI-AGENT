import * as THREE from 'three';

// A shared queue limits canvas painting and texture uploads to one screen per
// browser frame, including when several asynchronous image decodes finish at once.
const jobs = new Map<object, () => void>();
let frame = 0;
export function queueScreen(key: object, paint: () => void) {
  jobs.set(key, paint);
  if (!frame) frame = requestAnimationFrame(tick);
}
function tick() {
  frame = 0;
  const first = jobs.entries().next().value;
  if (first) { jobs.delete(first[0]); first[1](); }
  if (jobs.size && !frame) frame = requestAnimationFrame(tick);
}
export function cancelScreen(key: object) { jobs.delete(key); }

/** Two pre-sized CPU buffers and two GPU textures for this screen's lifetime.
 * Painting is queued outside React and R3F's render callbacks. Swapping sources
 * uploads once; the 200ms fade changes a shader uniform only. */
export function createScreenTexture(width: number, height: number, invalidate: () => void) {
  const canvas = () => { const value = document.createElement('canvas'); value.width = width; value.height = height; return value; };
  const texture = (source: HTMLCanvasElement) => {
    const value = new THREE.CanvasTexture(source); value.colorSpace = THREE.SRGBColorSpace;
    value.generateMipmaps = false; value.minFilter = THREE.LinearFilter; value.anisotropy = 1; return value;
  };
  const canvases = [canvas(), canvas()] as const, textures = [texture(canvases[0]), texture(canvases[1])] as const;
  let index = 0; const map = textures[0];
  const currentUniform = { value: textures[0] }, previousUniform = { value: textures[1] };
  const blend = { value: 1 }; const key = {}; let disposed = false, painted = false, fade = 0, started = 0;
  const animate = (now: number) => {
    if (disposed) return;
    blend.value = Math.min(1, (now - started) / 200); invalidate();
    fade = blend.value < 1 ? requestAnimationFrame(animate) : 0;
  };
  return {
    texture: map,
    attach(material: THREE.Material) {
      material.onBeforeCompile = shader => {
        shader.uniforms.previousScreen = previousUniform; shader.uniforms.currentScreen = currentUniform; shader.uniforms.screenMix = blend;
        shader.fragmentShader = 'uniform sampler2D currentScreen; uniform sampler2D previousScreen; uniform float screenMix;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', THREE.ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )', 'texture2D( currentScreen, vMapUv )').replace('diffuseColor *= sampledDiffuseColor;', 'diffuseColor *= mix(texture2D(previousScreen, vMapUv), sampledDiffuseColor, screenMix);'));
      };
      material.customProgramCacheKey = () => 'world-screen-fade-v1';
    },
    draw(paint: (context: CanvasRenderingContext2D) => void) {
      queueScreen(key, () => {
        if (disposed) return;
        // Let the previous transition finish before reusing its source buffer.
        if (fade) { queueScreen(key, () => this.draw(paint)); return; }
        const next = index === 0 ? 1 : 0;
        const context = canvases[next].getContext('2d'); if (!context) return;
        context.clearRect(0, 0, width, height); paint(context);
        previousUniform.value = textures[index]!; currentUniform.value = textures[next]; index = next;
        textures[next].needsUpdate = true;
        blend.value = painted ? 0 : 1; painted = true;
        if (blend.value === 0) { started = performance.now(); fade = requestAnimationFrame(animate); }
        invalidate();
      });
    },
    cancel() { cancelScreen(key); },
    dispose() { disposed = true; cancelScreen(key); cancelAnimationFrame(fade); textures.forEach(value => value.dispose()); },
  };
}
export type ScreenTexture = ReturnType<typeof createScreenTexture>;
