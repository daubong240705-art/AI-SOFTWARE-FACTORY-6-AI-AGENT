/** Cosmetic state only. This module has no application store, API or command dependency. */
export const tools = ['whip', 'taser', 'coffee', 'hammer', 'feather', 'megaphone', 'cookie'] as const;
export type Tool = typeof tools[number];
export const icons: Record<Tool, string> = { whip: '〰', taser: 'ϟ', coffee: '☕', hammer: '🔨', feather: '🪶', megaphone: '📣', cookie: '🍪' };
export type ToyEffect = Readonly<{ worker: string; tool: Tool; started: number; until: number; quiet: boolean }>;
export type ToySnapshot = Readonly<{ tool: Tool | null; open: boolean; sound: boolean; day: string; counts: Readonly<Partial<Record<Tool, number>>>; active: readonly ToyEffect[] }>;
export const localDay = (now: Date) => `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
const key = 'factory-ui.world.toys.v1';
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
export class ToyStore {
  private state: ToySnapshot = { tool: null, open: false, sound: false, day: '', counts: {}, active: [] };
  private listeners = new Set<() => void>();
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
    for (const [id, until] of this.cooldown) if (until <= now) this.cooldown.delete(id);
    if (day !== this.state.day || active.length !== this.state.active.length) this.update({ day, counts: day === this.state.day ? this.state.counts : {}, active }, day !== this.state.day);
  }
  open = (open: boolean) => this.update({ open, tool: open ? this.state.tool : null });
  select = (tool: Tool | null) => this.update({ tool });
  mute = () => this.update({ sound: !this.state.sound }, true);
  clear = () => { this.cooldown.clear(); this.update({ active: [], tool: null, open: false }); };
  apply(worker: string, tool: Tool, quiet: boolean, now = Date.now()) {
    this.refresh(now);
    if (!worker || (this.cooldown.get(worker) ?? 0) > now || this.state.active.length >= 3 && !this.state.active.some(effect => effect.worker === worker)) return false;
    const duration = quiet ? 1800 : tool === 'coffee' ? 10000 : tool === 'megaphone' ? 5000 : tool === 'whip' ? 3000 : 1800;
    this.cooldown.set(worker, now + 1000);
    // Reapplying to a worker replaces its cosmetic effect, never its work state.
    this.update({ active: [...this.state.active.filter(e => e.worker !== worker), { worker, tool, started: now, until: now + duration, quiet }], counts: { ...this.state.counts, [tool]: (this.state.counts[tool] ?? 0) + 1 } }, true);
    return true;
  }
}
let storage: Storage | undefined;
try { storage = globalThis.localStorage; } catch { /* Private browsing. */ }
export const toys = new ToyStore(storage);
