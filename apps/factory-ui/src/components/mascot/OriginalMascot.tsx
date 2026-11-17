import { Accessory, Effects } from './Details';
import type { MascotState } from './state';

// The operator's own artwork: 7 characters x 7 poses, already cropped to one square box per character, plus two
// recoloured variants in the same style (MINT bear, PLUM fox) so larger teams never repeat a character.
// Only the URLs are bundled here (the SVG files are emitted as assets and loaded by the browser on demand).
const urls = import.meta.glob('../../assets/mascot/original/*/*.svg', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export type ArtCode = 'LEAD' | 'PM' | 'BA' | 'FE' | 'BE' | 'DEVOPS' | 'TEST' | 'MINT' | 'PLUM';
const codes: ArtCode[] = ['LEAD', 'PM', 'BA', 'FE', 'BE', 'DEVOPS', 'TEST', 'MINT', 'PLUM'];
const pose = { idle: '00_Idle', thinking: '01_Thinking', working: '02_Working', attention: '03_Attention', success: '04_Success', error: '05_Error', resting: '06_Resting' } as const;
const poseOf: Record<MascotState, keyof typeof pose> = {
  idle: 'idle', thinking: 'thinking', working: 'working', typing: 'working', attention: 'attention',
  done: 'success', success: 'success', error: 'error', offline: 'resting',
};
// Seats of the other packs borrow the closest character of the set.
const seatCode: Record<string, ArtCode> = {
  lead: 'LEAD', pm: 'PM', ba: 'BA', fe: 'FE', be: 'BE', devops: 'DEVOPS', test: 'TEST',
  researcher: 'BA', analyst: 'BA', 'fact checker': 'TEST', architect: 'BE', 'data designer': 'BE', 'api designer': 'DEVOPS',
  'architecture reviewer': 'TEST', 'ux designer': 'FE', 'ui designer': 'FE', 'design reviewer': 'TEST',
  // web-games: six seats, six different characters.
  'game designer': 'BA', 'rules engineer': 'BE', 'ui artist': 'FE', 'client engineer': 'DEVOPS', 'qa engineer': 'TEST',
  // game-studio: nine seats, so the two variants are used here.
  'product strategist': 'PM', 'technical artist': 'FE', 'physics engineer': 'BE', 'gameplay engineer': 'MINT',
  'network engineer': 'PLUM', 'devops engineer': 'DEVOPS',
};
export function artCode(seat: string, hash: number): ArtCode {
  return seatCode[seat.trim().toLowerCase()] ?? codes[hash % codes.length]!;
}
const url = (code: ArtCode, state: MascotState) => urls[`../../assets/mascot/original/${code}/${code}_${pose[poseOf[state]]}.svg`];

/** Character art plus small effect marks (question mark, sparkles, !!, Zzz, laptop, check, error cross) drawn over it. */
export function OriginalArt({ code, state }: { code: ArtCode; state: MascotState }) {
  const working = state === 'working' || state === 'typing';
  return <>
    <img className="mascot-art" src={url(code, state)} alt="" draggable={false} decoding="async" />
    <svg className="mascot-overlay" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      {working && code !== 'BE' && code !== 'MINT' && <g className="mascot-laptop" stroke="var(--mascot-outline)" strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round"><Accessory kind="laptop" /></g>}
      {state === 'done' && <g strokeLinecap="round" strokeLinejoin="round"><circle cx="82" cy="82" r="12" fill="var(--ok)" stroke="var(--mascot-outline)" strokeWidth="2.4" /><path d="M75 82l5 5 9-10" fill="none" stroke="#fff" strokeWidth="3.4" /></g>}
      {state === 'error' && <g strokeLinecap="round" strokeLinejoin="round"><circle cx="82" cy="82" r="12" fill="var(--need)" stroke="var(--mascot-outline)" strokeWidth="2.4" /><path d="M76 76l12 12m0-12L76 88" fill="none" stroke="#fff" strokeWidth="3.4" /></g>}
      <Effects state={state} />
    </svg>
  </>;
}
