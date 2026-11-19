import type { ToyEffect } from '../scene/toys/store';
import type { PoseFrame } from './poses';
export type Reaction = Pick<ToyEffect, 'tool' | 'started'> | undefined;
const pulse = (t: number, at: number, span: number) => t > at && t < at + span ? Math.sin((t - at) / span * Math.PI) : 0;
/** Additive, short cosmetic channel; the work pose and its blend remain intact. */
export function reactToToy(frame: PoseFrame, reaction: Reaction, now: number) {
  const f = { ...frame }; let x = 0, ears = 0, flash = false;
  if (!reaction) return { frame: f, x, ears, flash };
  const t = (now - reaction.started) / 1000, hit = pulse(t, 0.55, 0.6), settle = pulse(t, 1.15, 0.65);
  if (t < 0 || t >= 2) return { frame: f, x, ears, flash };
  switch (reaction.tool) {
    case 'whip': x = hit * 0.28 - settle * 0.06; f.rz += hit * -0.25; f.sy -= hit * 0.3; f.sx += hit * 0.18; break;
    case 'taser': {
      const buzz = t > 0.4 && t < 1.2 ? Math.sin((t - 0.4) / 0.8 * Math.PI) : 0;
      x = Math.sin(t * 95) * buzz * 0.055; f.rz += Math.sin(t * 80) * buzz * 0.09;
      f.sy += buzz * 0.12; ears = buzz; flash = buzz > 0 && Math.floor(t * 22) % 2 === 0; break;
    }
    case 'coffee': f.rz += Math.sin(t * 48) * hit * 0.055; f.y += hit * 0.12; f.effect = '✦'; f.sparkle = 1.5; break;
    case 'hammer': {
      const flat = pulse(t, 0.55, 0.4), jump = pulse(t, 0.95, 0.6);
      f.sy *= 1 - flat * 0.82 + jump * 0.18; f.sx += flat * 0.75 - jump * 0.1; f.sz += flat * 0.6;
      f.y += jump * 0.4; f.sy -= settle * 0.08; break;
    }
    case 'feather': f.rz += Math.sin(t * 15) * hit * 0.3; f.rx += hit * 0.15; f.sy -= Math.abs(Math.sin(t * 15)) * hit * 0.12; f.closed = hit > 0.1; break;
    case 'megaphone': x = hit * 0.09; f.rx += hit * 0.18; break;
    case 'cookie': f.y += pulse(t, 0.35, 0.65) * 0.25; f.sy += Math.sin(t * 28) * hit * 0.05; f.closed = hit > 0.1; break;
  }
  return { frame: f, x, ears, flash };
}
