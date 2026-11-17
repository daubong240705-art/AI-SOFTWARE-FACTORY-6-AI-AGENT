import type { StoreState } from './store';

// Compare only arrays and plain records; dates, maps and class instances retain identity semantics.
export function shallowSelectionEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index++) if (!Object.is(a[index], b[index])) return false;
    return true;
  }
  const leftPrototype = Object.getPrototypeOf(a); const rightPrototype = Object.getPrototypeOf(b);
  if (leftPrototype !== rightPrototype || (leftPrototype !== Object.prototype && leftPrototype !== null)) return false;
  const left = a as Record<string, unknown>; const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && Object.is(left[key], right[key]));
}

/** A snapshot belongs to one selector/equality pair and never mutates a committed render. */
export function createSelectorSnapshot<T>(getState: () => StoreState, selector: (state: StoreState) => T,
  isEqual: (a: T, b: T) => boolean, committed: { current: { value: T } | null }): () => T {
  let cache: { state: StoreState; value: T } | undefined;
  return () => {
    const state = getState();
    if (cache?.state === state) return cache.value;
    const next = selector(state);
    const previous = cache ?? committed.current;
    const value = next !== state && previous && isEqual(previous.value, next) ? previous.value : next;
    cache = { state, value };
    return value;
  };
}
