import { toys, type Tool } from './store';
import { tone } from './sound';
export function playToy(worker: string, tool: Tool, quiet: boolean) {
  if (toys.apply(worker, tool, quiet) && toys.snapshot().sound && !quiet) {
    const effect = toys.snapshot().active.find(e => e.worker === worker)!;
    tone(tool, effect.combo);
    if (effect.cheered) tone('cheer');
    if (effect.sulkUntil) tone('sulk');
  }
}
