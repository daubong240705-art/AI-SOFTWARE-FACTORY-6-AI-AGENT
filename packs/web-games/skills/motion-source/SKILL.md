---
name: motion-source
description: Exact source of src/client/motion.ts (motion helpers) for games created before the starter shipped it. Client Engineer only; read when the file is missing.
---

# motion.ts source

Create `src/client/motion.ts` with exactly this content when the project does not have it.

```ts
// Motion helpers for turn-based games: small, quick feedback that never changes game state.
// Only transform and opacity are animated. Every helper resolves when its effect ends, leaves the
// element at its rest style, and turns into an instant change under prefers-reduced-motion.

export const EASE = {
  pop: "cubic-bezier(.34, 1.56, .64, 1)",
  out: "cubic-bezier(.22, 1, .36, 1)",
  in: "cubic-bezier(.55, 0, 1, .45)",
} as const;

export const reducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Cancels running animations on an element so a new effect starts from its rest style. */
export function settle(element: Element): void {
  for (const animation of element.getAnimations()) animation.cancel();
}

async function run(element: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions): Promise<void> {
  settle(element);
  if (reducedMotion()) return;
  const animation = element.animate(keyframes, { fill: "none", ...options });
  try { await animation.finished; } catch { /* cancelled by a newer effect */ }
}

/** Small: a piece placed, a card selected, a button confirmed. */
export const pop = (element: Element, duration = 220): Promise<void> =>
  run(element, [{ transform: "scale(.6)", opacity: 0.4 }, { transform: "scale(1)", opacity: 1 }], { duration, easing: EASE.pop });

/** Error: illegal move or not your turn. */
export const shake = (element: Element): Promise<void> =>
  run(element, [0, -6, 6, -4, 4, 0].map((x) => ({ transform: `translateX(${x}px)` })), { duration: 220, easing: "ease-in-out" });

/** Draws attention to whose turn it is or to a winning line (at most a few pulses). */
export const pulse = (element: Element, times = 2): Promise<void> =>
  run(element, [{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }], { duration: 360, iterations: times, easing: EASE.out });

/** Fades and rises an element into view: a new message, a result banner. */
export const enter = (element: Element, duration = 260): Promise<void> =>
  run(element, [{ transform: "translateY(10px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration, easing: EASE.out });

/**
 * Makes an element that is already in its new place look as if it flew there from `from`
 * (FLIP): a card from a hand to the discard pile, a chip to a betting square, a drawn card.
 * Render the new state first, then call flyFrom(newElement, sourceElementOrRect).
 */
export function flyFrom(element: HTMLElement, from: Element | DOMRect, duration = 360, arc = 40): Promise<void> {
  const start = from instanceof Element ? from.getBoundingClientRect() : from;
  const end = element.getBoundingClientRect();
  if (!end.width || !start.width) return Promise.resolve();
  const dx = start.left + start.width / 2 - (end.left + end.width / 2);
  const dy = start.top + start.height / 2 - (end.top + end.height / 2);
  const scale = Math.max(0.3, Math.min(2, start.width / end.width));
  return run(element, [
    { transform: `translate(${dx}px, ${dy}px) scale(${scale}) rotate(-8deg)` },
    { transform: `translate(${dx / 2}px, ${dy / 2 - arc}px) scale(${(scale + 1) / 2}) rotate(4deg)`, offset: 0.55 },
    { transform: "none" },
  ], { duration, easing: EASE.out });
}

/** Remembers where elements are, so after re-rendering you can fly each one from its old place. */
export function snapshotRects(elements: Iterable<HTMLElement>, key: (element: HTMLElement) => string): Map<string, DOMRect> {
  const rects = new Map<string, DOMRect>();
  for (const element of elements) rects.set(key(element), element.getBoundingClientRect());
  return rects;
}

/** Turns a card over: the first half hides it edge-on, `swap` changes the face, the second half shows it. */
export async function flip(element: HTMLElement, swap: () => void, duration = 260): Promise<void> {
  if (reducedMotion()) { swap(); return; }
  await run(element, [{ transform: "rotateY(0deg)" }, { transform: "rotateY(90deg)" }], { duration: duration / 2, easing: EASE.in });
  swap();
  await run(element, [{ transform: "rotateY(-90deg)" }, { transform: "rotateY(0deg)" }], { duration: duration / 2, easing: EASE.out });
}

/**
 * Suspense before a random result is shown (dice, a shaken bowl, a spinner): the dice tumble and
 * show random faces, then settle on the real result with a pop. `draw(element, face)` renders one
 * face. The result already exists in the authoritative state; this only delays showing it.
 */
export async function rollDice(dice: readonly HTMLElement[], faces: readonly number[], draw: (element: HTMLElement, face: number) => void,
  options: { duration?: number; sides?: number } = {}): Promise<void> {
  const duration = options.duration ?? 1400, sides = options.sides ?? 6;
  if (reducedMotion()) { dice.forEach((die, index) => draw(die, faces[index] ?? 1)); return; }
  const tumbling = dice.map((die, index) => run(die, [
    { transform: "translateY(0) rotate(0deg)" },
    { transform: `translateY(-14px) rotate(${index % 2 ? -200 : 200}deg)`, offset: 0.25 },
    { transform: `translateY(0) rotate(${index % 2 ? -380 : 380}deg)`, offset: 0.55 },
    { transform: `translateY(-6px) rotate(${index % 2 ? -520 : 520}deg)`, offset: 0.8 },
    { transform: "translateY(0) rotate(720deg)" },
  ], { duration, easing: EASE.out }));
  const started = performance.now();
  while (performance.now() - started < duration - 120) {
    dice.forEach((die) => draw(die, 1 + Math.floor(Math.random() * sides)));
    await sleep(70 + (performance.now() - started) / 12);
  }
  await Promise.all(tumbling);
  dice.forEach((die, index) => draw(die, faces[index] ?? 1));
  await Promise.all(dice.map((die) => pop(die, 200)));
}

/** Shakes a container (a dice cup, a deck) for `duration` ms: the build-up before a reveal. */
export const rattle = (element: Element, duration = 900): Promise<void> =>
  run(element, [0, -8, 7, -6, 8, -5, 6, 0].map((deg, index) => ({ transform: `rotate(${deg}deg) translateY(${index % 2 ? -3 : 0}px)` })),
    { duration, easing: "ease-in-out" });

/** Visible countdown (3, 2, 1) in `element`; resolves after it. Purely visual: rules have no clock. */
export async function countdown(element: HTMLElement, seconds = 3): Promise<void> {
  for (let left = seconds; left > 0; left -= 1) {
    element.textContent = String(left);
    void pop(element, 300);
    await sleep(reducedMotion() ? 250 : 800);
  }
  element.textContent = "";
}

/** Counts a number up or down (points, coins) instead of jumping to the new value. */
export async function tickNumber(element: HTMLElement, from: number, to: number, duration = 600, format = (n: number) => String(n)): Promise<void> {
  if (reducedMotion() || from === to) { element.textContent = format(to); return; }
  const started = performance.now();
  for (;;) {
    const t = Math.min(1, (performance.now() - started) / duration);
    element.textContent = format(Math.round(from + (to - from) * (1 - (1 - t) ** 3)));
    if (t === 1) return;
    await new Promise(requestAnimationFrame);
  }
}

/** Large: a win. A burst of at most 30 small pieces in an overlay above `container`, removed afterwards. */
export async function confetti(container: HTMLElement, colors: readonly string[] = ["#f2c14e", "#7fd1ae", "#f28b82", "#8ab4f8"], count = 24): Promise<void> {
  if (reducedMotion()) return;
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:50";
  document.body.append(layer);
  const box = container.getBoundingClientRect();
  const pieces = Array.from({ length: Math.min(30, count) }, (_, index) => {
    const piece = document.createElement("span");
    piece.style.cssText = `position:absolute;left:${box.left + box.width / 2}px;top:${box.top + box.height / 3}px;width:8px;height:12px;border-radius:2px;background:${colors[index % colors.length]}`;
    layer.append(piece);
    const angle = Math.random() * Math.PI * 2, distance = 80 + Math.random() * 160;
    return piece.animate([
      { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
      { transform: `translate(${Math.cos(angle) * distance}px, ${Math.sin(angle) * distance + 140}px) rotate(${Math.random() * 720}deg)`, opacity: 0 },
    ], { duration: 900 + Math.random() * 300, easing: EASE.out }).finished.catch(() => undefined);
  });
  await Promise.all(pieces);
  layer.remove();
}

let audio: AudioContext | null = null;
const MUTE_KEY = "game-muted";
export const isMuted = (): boolean => { try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return true; } };
export const setMuted = (muted: boolean): void => { try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch { /* storage unavailable */ } };

/** A short generated tone (no audio files). Call only after a user gesture; quiet; respects mute. */
export function tone(frequency = 520, duration = 90, volume = 0.05): void {
  if (isMuted() || typeof AudioContext !== "function") return;
  try {
    audio ??= new AudioContext();
    const oscillator = audio.createOscillator(), gain = audio.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration / 1000);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(); oscillator.stop(audio.currentTime + duration / 1000);
  } catch { /* audio unavailable */ }
}
```
