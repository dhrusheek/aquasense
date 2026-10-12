// The ASCII engine: ONE requestAnimationFrame loop for every <Ascii> on the page.
//
//  - the loop runs only while at least one animator is on screen and the tab is visible;
//  - each animator has its own frame rate and is rendered when its interval has elapsed;
//  - the DOM is written only when the generated string differs from the one on screen;
//  - a finite animation (a meter settling, a caret that blinks three times) leaves the loop by itself.
//
// No React in here. Ascii.tsx owns the element and decides whether to register at all
// (reduced motion renders frame 0 once and never registers).

export type AsciiParamValue =
  | number | string | boolean | null | undefined
  | readonly number[] | readonly boolean[];
export type AsciiParams = Readonly<Record<string, AsciiParamValue>>;

/** A generator is pure and deterministic in `frame`: same arguments, same string. */
export type AsciiGen = (frame: number, cols: number, rows: number, params: AsciiParams) => string;

export interface RegisterOptions {
  cols?: number;
  rows?: number;
  /** Frame to start from (default 0): lets a looping animation carry on across a params change. */
  start?: number;
  /** Stop by itself after this many frames, leaving the last one on screen. Omit for a loop. */
  frames?: number;
}

/** Stops the animator and returns the last frame it rendered. Safe to call more than once. */
export type Unregister = () => number;

interface Animator {
  el: HTMLElement;
  gen: AsciiGen;
  params: AsciiParams;
  cols: number;
  rows: number;
  /** ms per frame */
  interval: number;
  frame: number;
  /** Frame at which a finite animation ends; Infinity for a loop. */
  end: number;
  /** rAF timestamp of the last rendered frame; 0 = the clock starts on the next tick. */
  last: number;
  /** Intersecting the viewport (IntersectionObserver, threshold 0.05). */
  visible: boolean;
  text: string;
}

const EMPTY: AsciiParams = Object.freeze({});
const animators = new Set<Animator>();
const byElement = new WeakMap<Element, Animator>();
let raf = 0;
let observer: IntersectionObserver | null = null;
let listening = false;
let ticks = 0;

/** Write `text` into the element's single text node (created on first use). */
export function paint(el: HTMLElement, text: string): void {
  const node = el.firstChild;
  if (node !== null && node.nodeType === 3 && node.nextSibling === null) {
    if ((node as Text).data !== text) (node as Text).data = text;
  } else {
    el.textContent = text;
  }
}

function draw(a: Animator): void {
  const text = a.gen(a.frame, a.cols, a.rows, a.params);
  if (text === a.text) return;
  a.text = text;
  paint(a.el, text);
}

function remove(a: Animator): void {
  if (!animators.delete(a)) return;
  byElement.delete(a.el);
  observer?.unobserve(a.el);
}

function tick(now: number): void {
  raf = 0;
  ticks++;
  for (const a of animators) {
    if (!a.visible) continue;
    if (a.last === 0) { a.last = now; continue; } // just came on screen: frame already painted, start its clock
    const dt = now - a.last;
    if (dt < a.interval) continue;
    // Keep the cadence exact, but never burst to catch up after a stall.
    a.last = dt < a.interval * 2 ? a.last + a.interval : now;
    a.frame++;
    draw(a);
    if (a.frame >= a.end) remove(a); // deleting the current entry of a Set while iterating is safe
  }
  schedule();
}

function schedule(): void {
  if (raf !== 0 || document.hidden) return;
  for (const a of animators) {
    if (a.visible) { raf = requestAnimationFrame(tick); return; }
  }
}

function onVisibility(): void {
  if (document.hidden) {
    if (raf !== 0) cancelAnimationFrame(raf);
    raf = 0;
    for (const a of animators) a.last = 0; // no time passes while the tab is in the background
  } else {
    schedule();
  }
}

function onIntersect(entries: IntersectionObserverEntry[]): void {
  for (const e of entries) {
    const a = byElement.get(e.target);
    if (!a || a.visible === e.isIntersecting) continue;
    a.visible = e.isIntersecting;
    a.last = 0;
  }
  schedule();
}

function listen(): void {
  if (listening) return;
  listening = true;
  document.addEventListener('visibilitychange', onVisibility);
  if (typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver(onIntersect, { threshold: 0.05 });
  }
}

/**
 * Paint the starting frame into `el` and animate it at `fps` while it is on screen.
 * Returns `unregister`. With `fps <= 0` or `frames: 0` only the starting frame is painted.
 */
export function register(
  el: HTMLElement,
  gen: AsciiGen,
  fps: number,
  params: AsciiParams = EMPTY,
  options: RegisterOptions = {},
): Unregister {
  const start = Math.max(0, Math.floor(options.start ?? 0));
  const a: Animator = {
    el, gen, params,
    cols: options.cols ?? 0,
    rows: options.rows ?? 1,
    interval: 1000 / fps,
    frame: start,
    end: options.frames === undefined ? Infinity : start + Math.max(0, Math.floor(options.frames)),
    last: 0,
    visible: false,
    text: gen(start, options.cols ?? 0, options.rows ?? 1, params),
  };
  paint(el, a.text);
  if (!(fps > 0) || a.frame >= a.end) return () => a.frame;

  listen();
  animators.add(a);
  byElement.set(el, a);
  if (observer) {
    observer.observe(el); // reports asynchronously; the animator stays idle until it is seen
  } else {
    a.visible = true;
    schedule();
  }
  return () => { remove(a); return a.frame; };
}

/** Engine counters, for tests and the browser console (`__ascii.stats()` in dev). */
export function stats(): { animators: number; active: number; running: boolean; ticks: number } {
  let active = 0;
  for (const a of animators) if (a.visible) active++;
  return { animators: animators.size, active, running: raf !== 0, ticks };
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __ascii?: unknown }).__ascii = { stats };
}

// Dev only: a hot update of this module must not leave the previous loop running beside the new one.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (raf !== 0) cancelAnimationFrame(raf);
    raf = 0;
    observer?.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    animators.clear();
  });
}
