import type { ToyEffect } from '../scene/toys/store';
import type { PoseFrame } from './poses';
export type Reaction = (Pick<ToyEffect, 'tool' | 'started'> & Partial<Pick<ToyEffect, 'combo' | 'sulkUntil'>>) | undefined;
export type ReactionSample = { frame: PoseFrame; x: number; ears: number; flash: boolean };
const pulse = (t: number, at: number, span: number) => t > at && t < at + span ? Math.sin((t - at) / span * Math.PI) : 0;
function finish(result: ReactionSample, x: number, ears: number, flash: boolean) {
  result.x = x; result.ears = ears; result.flash = flash; return result;
}
/** Additive channel. The animator supplies a reusable output; standalone CPU callers may omit it. */
export function reactToToy(frame: PoseFrame, reaction: Reaction, now: number, output?: ReactionSample) {
  const result = output ?? { frame: { ...frame }, x: 0, ears: 0, flash: false };
  const f = result.frame; Object.assign(f, frame);
  let x = 0, ears = 0, flash = false;
  if (!reaction) return finish(result, x, ears, flash);
  const raw = (now - reaction.started) / 1000;
  const impact = reaction.tool === 'whip' || reaction.tool === 'hammer';
  const t = impact ? raw < 0.68 ? raw : raw < 0.75 ? 0.68 : raw - 0.07 : raw;
  if (reaction.sulkUntil && now < reaction.sulkUntil && raw > 1.1) {
    f.ry += Math.PI * Math.min(1, (raw - 1.1) / 0.6); f.sy *= 0.92; f.effect = '☁ ×';
    return finish(result, x, ears, flash);
  }
  if (raw < 0 || raw >= 3.07) return finish(result, x, ears, flash);
  const power = 1 + Math.min(5, (reaction.combo ?? 1) - 1) * 0.1;
  const hit = pulse(t, 0.55, 0.6) * power, settle = pulse(t, 1.15, 1.7);
  switch (reaction.tool) {
    case 'whip':
      x = hit * 0.4 - settle * 0.06; f.rz -= hit * 0.28; f.sy -= hit * 0.3; f.sx += hit * 0.18; break;
    case 'taser': {
      const buzz = pulse(raw, 0.4, 0.8);
      x = Math.sin(t * 95) * buzz * 0.055; f.rz += Math.sin(t * 80) * buzz * 0.09;
      f.sy += buzz * 0.12; ears = buzz; flash = buzz > 0 && Math.floor(t * 14) % 2 === 0; break;
    }
    case 'coffee':
      f.rz += Math.sin(t * 32) * hit * 0.04; f.y += hit * 0.12; f.effect = '✦'; f.sparkle = 1.5; break;
    case 'hammer': {
      const flat = pulse(t, 0.48, 0.4), jump = pulse(t, 0.95, 0.6);
      f.sy *= 1 - flat * 0.82 + jump * 0.18; f.sx += flat * 0.75 - jump * 0.1; f.sz += flat * 0.6;
      f.y += jump * 0.4; f.sy -= settle * 0.08;
      if (t > 1.05) { f.effect = '✦'; f.sparkle = 1.1; f.rz += Math.sin(t * 7) * settle * 0.08; }
      break;
    }
    case 'feather':
      f.rz += Math.sin(t * 15) * hit * 0.3; f.rx += hit * 0.15; f.sy -= Math.abs(Math.sin(t * 15)) * hit * 0.12; f.closed = hit > 0.1; break;
    case 'megaphone': x = hit * 0.13; f.rx += hit * 0.18; break;
    case 'cookie':
      f.y += pulse(t, 0.35, 0.65) * 0.25; f.sy += Math.sin(t * 28) * hit * 0.05; f.closed = hit > 0.1; break;
  }
  return finish(result, x, ears, flash);
}
