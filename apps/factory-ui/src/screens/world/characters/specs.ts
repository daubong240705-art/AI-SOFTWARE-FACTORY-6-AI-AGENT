import { artCode, type ArtCode } from '../../../components/mascot/OriginalMascot';
import { seatHash } from '../../../components/mascot/skins';
import type { CharacterSpec } from './spec';

const outline = '#0E0E16';
const make = (code: ArtCode, colors: CharacterSpec['colors'], ears: CharacterSpec['ears'], face: CharacterSpec['face'], accessories: CharacterSpec['accessories']): CharacterSpec => ({ code, colors, ears, face, accessories });
// Palette from the idle SVGs. Small pose-to-pose colour shifts in the raster-traced art are intentionally not animated.
export const characterSpecs: Record<ArtCode, CharacterSpec> = {
  LEAD: make('LEAD', { body: '#FBDE72', belly: '#FBDE72', accent: '#FACF4F', inner: '#FAC078', dark: '#393F57', cheek: '#FAC078', outline }, 'none', { eyes: 'oval', cheeks: true }, ['crown', 'headset']),
  PM: make('PM', { body: '#FBA753', belly: '#FBFBFB', accent: '#FBA753', inner: '#FBFBFB', dark: '#3A3F5B', cheek: '#FBA753', outline }, 'pointed', { eyes: 'oval', cheeks: false }, ['headset']),
  BA: make('BA', { body: '#E1DCFA', belly: '#E1DCFA', accent: '#A39CF4', inner: '#FAA1C6', dark: '#0F0F17', cheek: '#FAA1C6', outline }, 'pointed', { eyes: 'oval', whiskers: '#A39CF4', cheeks: false }, ['glasses']),
  FE: make('FE', { body: '#FADDE2', belly: '#FADDE2', accent: '#FAAFC1', inner: '#FAAFC1', dark: '#0F0F17', cheek: '#FAAFC1', outline }, 'long', { eyes: 'oval', cheeks: true }, ['brush']),
  BE: make('BE', { body: '#D08C76', belly: '#D08C76', accent: '#AE7361', inner: '#AE7361', dark: '#0E0F17', cheek: '#AE7361', outline }, 'round', { eyes: 'oval', brows: 'angry', cheeks: false }, ['laptop']),
  DEVOPS: make('DEVOPS', { body: '#DEDEEE', belly: '#DEDEEE', accent: '#5394F8', inner: '#A3A6BF', dark: '#424965', cheek: '#A3A6BF', outline }, 'pointed', { eyes: 'oval', mask: '#424965', cheeks: false }, ['gear']),
  TEST: make('TEST', { body: '#4997FA', belly: '#FBFBFB', accent: '#4981F7', inner: '#69D5FA', dark: '#0E0E17', cheek: '#69D5FA', outline }, 'crest', { eyes: 'oval', beak: '#0E0E17', cheeks: false }, ['magnifier']),
  MINT: make('MINT', { body: '#9DD2AD', belly: '#9DD2AD', accent: '#84B492', inner: '#84B492', dark: '#0E0F17', cheek: '#84B492', outline }, 'round', { eyes: 'oval', brows: 'angry', cheeks: false }, ['laptop']),
  PLUM: make('PLUM', { body: '#B499D3', belly: '#FBFBFB', accent: '#B499D3', inner: '#FBFBFB', dark: '#3A3F5B', cheek: '#B499D3', outline }, 'pointed', { eyes: 'oval', cheeks: false }, ['headset']),
};
export const characterCodes: ArtCode[] = ['LEAD', 'PM', 'BA', 'FE', 'BE', 'DEVOPS', 'TEST', 'MINT', 'PLUM'];
export function specForSeat(name: string, isLead = false): CharacterSpec {
  const code = isLead ? 'LEAD' : artCode(name, seatHash(name));
  return characterSpecs[code];
}
