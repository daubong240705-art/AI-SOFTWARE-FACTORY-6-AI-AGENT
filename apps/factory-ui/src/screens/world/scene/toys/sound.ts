import type { Tool } from './store';
let context: AudioContext | undefined;
export function unlockSound() {
  try { context ??= new AudioContext(); void context.resume().catch(() => {}); } catch { /* Optional. */ }
  return context;
}
/** Local synthesis only. Scheduled voices are short, quiet and disconnected on completion. */
export function tone(tool: Tool | 'oiia' | 'mega' | 'sulk' | 'cheer' | 'clap', combo = 1) {
  try {
    const ready = unlockSound(); if (!ready) return;
    const audio = ready;
    const now = audio.currentTime;
    function voice(at: number, duration: number, start: number, end: number, type: OscillatorType, volume = 0.025) {
      const oscillator = audio.createOscillator(), gain = audio.createGain();
      oscillator.type = type; oscillator.frequency.setValueAtTime(start, now + at);
      oscillator.frequency.exponentialRampToValueAtTime(end, now + at + duration);
      gain.gain.setValueAtTime(0.001, now + at); gain.gain.linearRampToValueAtTime(volume * Math.min(1.6, 1 + (combo - 1) * 0.12), now + at + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, now + at + duration);
      oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(now + at); oscillator.stop(now + at + duration + 0.01);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    }
    function noise(at: number, duration: number, cutoff: number, volume: number) {
      const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * duration), audio.sampleRate), data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const source = audio.createBufferSource(), gain = audio.createGain(), filter = audio.createBiquadFilter();
      source.buffer = buffer; filter.type = 'lowpass'; filter.frequency.value = cutoff;
      gain.gain.setValueAtTime(volume * Math.min(1.6, 1 + (combo - 1) * 0.12), now + at); gain.gain.exponentialRampToValueAtTime(0.001, now + at + duration);
      source.connect(filter); filter.connect(gain); gain.connect(audio.destination); source.start(now + at);
      source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    }
    switch (tool) {
      case 'whip': noise(0.68, 0.09, 9500, 0.065); voice(0.66, 0.08, 1900, 150, 'sawtooth'); break;
      case 'taser': for (let i = 0; i < 6; i++) voice(0.4 + i * 0.11, 0.09, 110, 150, 'sawtooth'); break;
      case 'coffee': noise(0.6, 0.4, 1200, 0.04); voice(0.6, 0.35, 420, 750, 'sine', 0.012); break;
      case 'hammer': voice(0.68, 0.16, 230, 1300, 'sine'); voice(0.84, 0.18, 1300, 320, 'sine'); break;
      case 'feather': for (let i = 0; i < 4; i++) voice(0.55 + i * 0.17, 0.13, 500 + i % 2 * 150, 370, 'triangle'); break;
      case 'megaphone': voice(0.45, 0.38, 280, 260, 'sawtooth'); voice(0.45, 0.38, 350, 325, 'square', 0.01); break;
      case 'cookie': for (let i = 0; i < 4; i++) noise(0.65 + i * 0.15, 0.07, 3200, 0.04); break;
      case 'sulk': voice(.8,.35,260,130,'triangle'); voice(1.2,.5,180,80,'sine'); break;
      case 'cheer': [523,659,784,1046].forEach((pitch,i)=>voice(.55+i*.12,.2,pitch,pitch,'sine')); break;
      case 'clap': for(let i=0;i<4;i++) noise(i*.3,.06,2500,.018); break;
      case 'mega': for(let i=0;i<16;i++) voice(i*.16,.15,260*(1+i%4*.5),520*(1+i%4*.5),'triangle',.02); noise(.15,.3,6000,.025); break;
      case 'oiia': [260, 520, 520, 350].forEach((pitch, i) => { voice(i * 0.22, 0.23, pitch * 0.8, pitch, 'triangle'); voice(i * 0.22, 0.23, pitch * 1.6, pitch * 2, 'sine', 0.008); }); break;
    }
  } catch { /* Sound is optional. */ }
}
