/** Retain references for equal JSON data, including unchanged model slices.
 * Poll timestamps stay in the controller; they must not invalidate scene props. */
export function shareEqual<T>(previous: T, next: T): T {
  if (Object.is(previous, next)) return previous;
  if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object' || Array.isArray(previous) !== Array.isArray(next)) return next;
  const before = previous as Record<string, unknown>, after = next as Record<string, unknown>;
  const keys = Object.keys(after);
  let equal = keys.length === Object.keys(before).length;
  const result: Record<string, unknown> = Array.isArray(next) ? [] as unknown as Record<string, unknown> : {};
  for (const key of keys) {
    result[key] = shareEqual(before[key], after[key]);
    if (result[key] !== before[key] || !(key in before)) equal = false;
  }
  return equal ? previous : result as T;
}
