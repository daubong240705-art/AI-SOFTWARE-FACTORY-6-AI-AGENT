import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Tool } from './store';
const ignore = () => {};
export type BurstKind = Tool | 'confetti' | 'hearts' | 'storm' | 'disco';
export const burstModes: Record<BurstKind, number> = { whip: 0, taser: 1, coffee: 2, hammer: 3, feather: 4, megaphone: 5, cookie: 6, confetti: 7, hearts: 8, storm: 9, disco: 10 };
let atlas: THREE.CanvasTexture | undefined;
function particleAtlas() {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  for (let kind = 0; kind < 10; kind++) {
    ctx.save(); ctx.translate(kind * 128 + 64, 64); ctx.fillStyle = '#FFFFFF';
    if (kind === 1 || kind === 2 || kind === 7) {
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 58); g.addColorStop(0, 'white'); g.addColorStop(0.55, '#FFFFFFC0'); g.addColorStop(1, '#FFFFFF00'); ctx.fillStyle = g; ctx.fillRect(-64, -64, 128, 128);
    } else if (kind === 4) {
      ctx.beginPath(); ctx.moveTo(0, 44); ctx.bezierCurveTo(-80, -3, -38, -66, 0, -23); ctx.bezierCurveTo(38, -66, 80, -3, 0, 44); ctx.fill();
    } else if (kind === 0 || kind === 5) {
      ctx.beginPath(); const points = kind === 5 ? 10 : 8;
      for (let i = 0; i < points; i++) { const a = i * Math.PI * 2 / points - Math.PI / 2, r = i % 2 ? kind === 5 ? 23 : 12 : 54; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); ctx.fill();
    } else if (kind === 6) {
      ctx.beginPath(); ctx.moveTo(0, -54); ctx.bezierCurveTo(-65, 22, -27, 60, 0, 51); ctx.bezierCurveTo(27, 60, 65, 22, 0, -54); ctx.fill();
    } else if (kind === 9) { ctx.lineWidth = 7; ctx.strokeStyle = 'white'; ctx.beginPath(); ctx.arc(0, 0, 48, 0, Math.PI * 2); ctx.stroke(); }
    else { ctx.rotate(kind); ctx.fillRect(-28, -40, 56, 80); }
    ctx.restore();
  }
  atlas = new THREE.CanvasTexture(canvas); atlas.colorSpace = THREE.SRGBColorSpace; return atlas;
}
function makeParticles(count: number) {
  const base = new THREE.PlaneGeometry(1, 1), geometry = new THREE.InstancedBufferGeometry();
  geometry.index = base.index; geometry.attributes = base.attributes; geometry.instanceCount = count;
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) { seeds[i * 4] = (i * 0.61803398875) % 1; seeds[i * 4 + 1] = (i * 0.754877666 + 0.17) % 1; seeds[i * 4 + 2] = (i * 0.56984029 + 0.31) % 1; seeds[i * 4 + 3] = i; }
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4)); return geometry;
}
export const particleGeometry = makeParticles(64), lightParticleGeometry = makeParticles(12);
export const particleMaterial = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
  uniforms: { uAge: { value: -1 }, uMode: { value: 0 }, uPower: { value: 1 }, uAtlas: { value: null } },
  vertexShader: `
    attribute vec4 aSeed; uniform float uAge, uMode, uPower;
    varying vec2 vUv; varying vec3 vColor; varying float vAlpha, vKind;
    void main() {
      float id = mod(aSeed.w, 4.0), kind = 0.0;
      if(uMode == 0.0) kind = id < 2.0 ? 0.0 : 7.0;
      if(uMode == 1.0) kind = id < 2.0 ? 0.0 : 1.0;
      if(uMode == 2.0) kind = id < 3.0 ? 2.0 : 5.0;
      if(uMode == 3.0) kind = id < 2.0 ? 5.0 : 7.0;
      if(uMode == 4.0) kind = id < 2.0 ? 4.0 : 6.0;
      if(uMode == 5.0) kind = id < 2.0 ? 6.0 : 9.0;
      if(uMode == 6.0) kind = id < 3.0 ? 3.0 : 4.0;
      if(uMode == 7.0) kind = 8.0;
      if(uMode == 8.0) kind = 4.0;
      if(uMode == 9.0) kind = 6.0;
      float start = uMode >= 7.0 ? 0.0 : 0.68;
      float life = 1.2 + aSeed.z * 0.85;
      float delay = id < 2.0 ? 0.0 : aSeed.y * 0.34;
      float age = uAge - start - delay;
      float p = clamp(age / life, 0.0, 1.0), a = aSeed.x * 6.283185;
      vec3 center = vec3(cos(a) * p * (0.5 + aSeed.y) * uPower, 0.8 + sin(a) * p * 0.7 + p * 0.8, sin(a) * p * 0.7 + 0.6);
      float size = (0.1 + aSeed.z * 0.12) * uPower;
      vColor = vec3(1.0, 0.84, 0.35);
      if(kind == 1.0) { center.y = 0.7 + p * 1.25; size = 0.3 + p * 0.6; vColor = vec3(0.27,0.3,0.37); }
      if(kind == 2.0) { center = vec3(sin(p*8.0+a)*0.17, 1.0+p*1.6, 0.75); size = 0.16 + p*0.3; vColor = vec3(0.95,0.98,1.0); }
      if(kind == 3.0 || kind == 8.0) { center.y = 0.8 + p*1.8 - p*p*2.7; size *= 0.7; vColor = kind == 3.0 ? vec3(0.65,0.36,0.13) : vec3(0.5+0.5*sin(a),0.55+0.4*cos(a*2.0),0.65+0.35*sin(a*3.0)); }
      if(kind == 4.0) { center.y = 0.9+p*1.5; vColor = vec3(1.0,0.36,0.6); }
      if(kind == 5.0 && uMode == 3.0) { center = vec3(cos(a+uAge*4.0)*0.75,1.45+p*0.25,sin(a+uAge*4.0)*0.65); size *= 1.25; }
      if(kind == 6.0) { center.y = 1.3-p*1.2; vColor = vec3(0.38,0.8,1.0); }
      if(kind == 7.0) { center.y = 0.08+p*0.22; size = 0.2+p*0.42; vColor = vec3(0.8,0.67,0.5); }
      if(kind == 9.0) { center.x += p*0.8; size = 0.2+p*0.8; }
      if(uMode == 7.0) { center.y += 0.8; center.x *= 1.6; center.z *= 1.6; }
      if(uMode == 9.0) { center.y = 1.7-p*0.8; center.x *= 0.28; size *= 0.5; }
      float rotation = kind == 3.0 || kind == 8.0 ? age * (aSeed.y-0.5)*8.0 : 0.0;
      vec2 quad = mat2(cos(rotation),-sin(rotation),sin(rotation),cos(rotation)) * position.xy * size;
      vec4 view;
      if(uMode == 10.0) {
        float radius = 0.45 + aSeed.y * 0.8;
        center = vec3(cos(a+uAge*1.8)*radius,0.08,sin(a+uAge*1.8)*radius);
        vColor=vec3(0.6+0.4*sin(a+uAge*3.0),0.6+0.4*cos(a*2.0+uAge*3.0),0.8);
        view=modelViewMatrix*vec4(center+vec3(quad.x,0.0,quad.y),1.0);
      } else { view = modelViewMatrix * vec4(center,1.0); view.xy += quad; }
      gl_Position = projectionMatrix * view; vUv = uv; vKind = kind;
      vAlpha = uMode == 10.0 ? 0.25 + 0.55*pow(sin(a+uAge*6.0),2.0) : step(0.0,age) * (1.0-smoothstep(0.65,1.0,p)) * (age < life ? 1.0 : 0.0);
    }`,
  fragmentShader: `uniform sampler2D uAtlas; varying vec2 vUv; varying vec3 vColor; varying float vAlpha,vKind;
    void main(){ float a=texture2D(uAtlas,vec2((vUv.x+vKind)/10.0,vUv.y)).a*vAlpha; if(a<0.015) discard; gl_FragColor=vec4(vColor,a);
 #include <tonemapping_fragment>\n #include <colorspace_fragment>
 }`,
});
// Branches share endpoints and are baked into one draw. Core and halo share the same shader.
function makeLightning() {
  const positions: number[] = [], uvs: number[] = [];
  for (let branch = 0; branch < 7; branch++) for (let j = 0; j < 7; j++) {
    const point = (k: number) => { const p = k / 7; return [-0.35 + p * (branch < 2 ? 1.15 : 0.6), 0.85 + (branch - 3) * p * 0.12 + (k === 0 || k === 7 ? 0 : Math.sin(k * 37 + branch * 9) * 0.09)]; };
    const a = point(j), b = point(j + 1);
    for (const [k, side] of [[0, -1], [1, -1], [1, 1], [0, -1], [1, 1], [0, 1]]) { const q = k ? b : a; positions.push(q[0]!, q[1]! + side! * 0.045, 0.75); uvs.push(k!, (side! + 1) / 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions,3)); g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2)); return g;
}
export const lightningGeometry = makeLightning();
export const lightningMaterial = new THREE.ShaderMaterial({ transparent:true, depthWrite:false, side:THREE.DoubleSide, forceSinglePass: true, uniforms:{uAge:{value:-1}},
  vertexShader:`uniform float uAge; varying vec2 vUv; void main(){ vec3 p=position; p.y+=sin(p.x*32.0+floor(uAge*18.0)*9.0)*0.035; vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0); }`,
  fragmentShader:`uniform float uAge; varying vec2 vUv; void main(){ float edge=abs(vUv.y-0.5)*2.0; float live=step(0.55,uAge)*(1.0-step(1.7,uAge)); float a=(pow(1.0-edge,3.0)*0.7+step(edge,0.13))*live; if(a<0.01)discard; gl_FragColor=vec4(mix(vec3(0.12,0.48,1.0),vec3(0.85,1.0,1.0),step(edge,0.2)),a); }`,
});
export function Burst({ started, kind, low, power = 1, loop = false }: { started:number; kind:BurstKind; low:boolean; power?:number; loop?:boolean }) {
  const material = useMemo(() => { const m = particleMaterial.clone(); m.uniforms.uAtlas!.value = particleAtlas(); m.uniforms.uMode!.value = burstModes[kind]; m.uniforms.uPower!.value = power; return m; },[kind,power]);
  useEffect(() => () => material.dispose(),[material]);
  useFrame(() => { const t = (Date.now()-started)/1000; material.uniforms.uAge!.value = loop ? t % 1.8 : t; });
  return <mesh dispose={null} geometry={low ? lightParticleGeometry : particleGeometry} material={material} frustumCulled={false} raycast={ignore} />;
}
export function Lightning({started}:{started:number}) {
  const material = useMemo(() => lightningMaterial.clone(),[]), mesh = useRef<THREE.Mesh>(null);
  useEffect(() => () => material.dispose(),[material]);
  useFrame(() => { const t=(Date.now()-started)/1000; material.uniforms.uAge!.value=t; if(mesh.current) mesh.current.visible=t>0.5&&t<1.75; });
  return <mesh dispose={null} ref={mesh} geometry={lightningGeometry} material={material} raycast={ignore} />;
}
export function prepareParticleAtlas() { particleMaterial.uniforms.uAtlas!.value = particleAtlas(); }
