/** Cosmetic state only. This module has no application store, API or command dependency. */
export const tools = ['whip', 'taser', 'coffee', 'hammer', 'feather', 'megaphone', 'cookie'] as const;
export type Tool = typeof tools[number];
export const icons: Record<Tool, string> = { whip: '〰', taser: 'ϟ', coffee: '☕', hammer: '🔨', feather: '🪶', megaphone: '📣', cookie: '🍪' };
export type ToyEffect = Readonly<{ worker: string; tool: Tool; started: number; until: number; quiet: boolean; combo: number; cheered: boolean; sulkUntil: number }>;
export type Combo = Readonly<{ worker: string; count: number; until: number }>;
export type Sulk = Readonly<{ worker: string; started: number; until: number; quiet: boolean }>;
export type ToySnapshot = Readonly<{ tool: Tool | null; open: boolean; sound: boolean; oiiaSpins: number; oiiaMegaSpins: number; catSpin: Readonly<{ started: number; mega: boolean; audience: boolean }>; combo: readonly Combo[]; sulking: readonly Sulk[]; day: string; counts: Readonly<Partial<Record<Tool, number>>>; active: readonly ToyEffect[] }>;
export const localDay = (now: Date) => `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
const key = 'factory-ui.world.toys.v1';
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
export class ToyStore {
  private state: ToySnapshot = { tool: null, open: false, sound: false, oiiaSpins: 0, oiiaMegaSpins: 0, catSpin: { started: 0, mega: false, audience: false }, combo: [], sulking: [], day: '', counts: {}, active: [] };
  private listeners = new Set<() => void>();
  private hits = new Map<string, number[]>();
  private cooldown = new Map<string, number>();
  private storage: Storage | undefined;
  constructor(storage?: Storage) {
    this.storage = storage;
    try {
      const saved: unknown = JSON.parse(storage?.getItem(key) ?? 'null');
      if (saved && typeof saved === 'object') {
        const value = saved as Record<string, unknown>, counts: Partial<Record<Tool, number>> = {};
        if (value.counts && typeof value.counts === 'object') for (const tool of tools) {
          const n = (value.counts as Record<string, unknown>)[tool];
          if (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0) counts[tool] = n;
        }
        this.state = { ...this.state, sound: value.sound === true, day: typeof value.day === 'string' ? value.day : '', counts };
      }
    } catch { /* Storage is optional; the tray remains usable in memory. */ }
    this.refresh();
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<ToySnapshot>, persist = false) {
    this.state = Object.freeze({ ...this.state, ...patch });
    if (persist) try { this.storage?.setItem(key, JSON.stringify({ sound: this.state.sound, day: this.state.day, counts: this.state.counts })); } catch { /* Memory only. */ }
    this.listeners.forEach(listener => listener());
  }
  refresh(now = Date.now()) {
    const day = localDay(new Date(now)), active = this.state.active.filter(effect => effect.until > now);
    const combo = this.state.combo.filter(c => c.until > now), sulking = this.state.sulking.filter(s => s.until > now);
    for (const [worker, times] of this.hits) { const recent = times.filter(at => now - at < 20000); if (recent.length) this.hits.set(worker, recent); else this.hits.delete(worker); }
    for (const [id, until] of this.cooldown) if (until <= now) this.cooldown.delete(id);
    if (day !== this.state.day || active.length !== this.state.active.length || combo.length !== this.state.combo.length || sulking.length !== this.state.sulking.length) this.update({ combo, sulking, day, counts: day === this.state.day ? this.state.counts : {}, active }, day !== this.state.day);
  }
  open = (open: boolean) => this.update({ open, tool: open ? this.state.tool : null });
  select = (tool: Tool | null) => this.update({ tool });
  mute = () => this.update({ sound: !this.state.sound }, true);
  spin = (mega = false, audience = false, now = Date.now()) => this.update({ oiiaSpins: this.state.oiiaSpins + 1, oiiaMegaSpins: this.state.oiiaMegaSpins + (mega ? 1 : 0), catSpin: Object.freeze({ started: now, mega, audience }) });
  clear = () => { this.cooldown.clear(); this.hits.clear(); this.update({ active: [], combo: [], sulking: [], catSpin: { started: 0, mega: false, audience: false }, tool: null, open: false }); };
  apply(worker: string, tool: Tool, quiet: boolean, now = Date.now()) {
    this.refresh(now);
    const sulk = this.state.sulking.find(s => s.worker === worker);
    const treat = tool === 'cookie' || tool === 'coffee', cheered = !!sulk && treat;
    if (!worker || sulk && !treat || !cheered && (this.cooldown.get(worker) ?? 0) > now || !cheered && this.state.active.length >= 3 && !this.state.active.some(effect => effect.worker === worker)) return false;
    const previous = this.state.combo.find(c => c.worker === worker);
    const combo = cheered ? 1 : Math.min(9, (previous?.count ?? 0) + 1);
    const hits = treat ? [] : [...(this.hits.get(worker) ?? []), now];
    this.hits.set(worker, hits);
    const sulkUntil = hits.length >= 6 ? now + 10000 : 0;
    if (sulkUntil || cheered) this.hits.delete(worker);
    const duration = quiet ? 3000 : sulkUntil ? 10000 : tool === 'coffee' ? 10000 : tool === 'megaphone' ? 5000 : tool === 'taser' ? 6200 : 3000;
    const active = this.state.active.filter(effect => effect.worker !== worker);
    if (cheered && active.length >= 3) active.shift();
    this.cooldown.set(worker, now + 1000);
    this.update({
      combo: [...this.state.combo.filter(c => c.worker !== worker), Object.freeze({ worker, count: combo, until: now + 4000 })],
      sulking: [...this.state.sulking.filter(s => s.worker !== worker), ...(sulkUntil ? [Object.freeze({ worker, started: now, until: sulkUntil, quiet })] : [])],
      active: [...active, Object.freeze({ worker, tool, started: now, until: now + duration, quiet, combo, cheered, sulkUntil })],
      counts: { ...this.state.counts, [tool]: (this.state.counts[tool] ?? 0) + 1 },
    }, true);
    return true;
  }
}
let storage: Storage | undefined;
try { storage = globalThis.localStorage; } catch { /* Private browsing. */ }
export const toys = new ToyStore(storage);
