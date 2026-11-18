import { tools, type Tool } from './store';
let context: AudioContext | undefined;
/** Generated, short, quiet beeps. Called only from a user gesture when sound was enabled. */
export function tone(tool: Tool) {
  try {
    context ??= new AudioContext();
    void context.resume().catch(() => {});
    const oscillator = context.createOscillator(), gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = tool === 'hammer' ? 'sine' : 'triangle';
    oscillator.frequency.setValueAtTime(240 + tools.indexOf(tool) * 85, now);
    oscillator.frequency.exponentialRampToValueAtTime(tool === 'hammer' ? 850 : 180, now + 0.12);
    gain.gain.setValueAtTime(0.035, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    oscillator.connect(gain); gain.connect(context.destination); oscillator.start(now); oscillator.stop(now + 0.18);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  } catch { /* Sound is optional. */ }
}
