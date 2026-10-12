// One requestAnimationFrame loop shared by every artwork on the page. A job is ticked only while its
// element is on screen, the tab is visible and it is among the first MAX_ANIMATING visible animating
// jobs; the rest keep their last (static) frame.
export interface ArtJob {
  el: Element;
  /** Target frame rate while animating. */
  fps: number;
  /** Optional: a temporary higher frame rate (e.g. during a jump). */
  boostFps?(now: number): number | undefined;
  /** True while the job has frames to draw (a scan in progress, a live scene). */
  animated(): boolean;
  /** Draw one frame; `now` is the rAF timestamp in ms. */
  frame(now: number): void;
  /** The element entered or left the viewport. */
  visible?(v: boolean, now: number): void;
}

interface Slot { job: ArtJob; vis: boolean; since: number; last: number; ms: number; frames: number; slow: number; fps: number }

export const MAX_ANIMATING = 6;

const slots = new Map<Element, Slot>();
let io: IntersectionObserver | null = null;
let raf = 0;
let seq = 0;
let lastTickMs = 0;
let paused = false;
let boosted = 0;

function ensureIo(): IntersectionObserver {
  return (io ??= new IntersectionObserver((entries) => {
    const now = performance.now();
    for (const e of entries) {
      const s = slots.get(e.target);
      if (!s) continue;
      const v = e.isIntersecting;
      if (v === s.vis) continue;
      s.vis = v;
      s.since = v ? ++seq : 0;
      s.job.visible?.(v, now);
    }
    wake();
  }, { threshold: 0.05 }));
}

function tick(now: number) {
  raf = 0;
  if (document.hidden || paused) return;
  boosted = 0;
  let animating = 0;
  const live: Slot[] = [];
  for (const s of slots.values()) if (s.vis && s.job.animated()) live.push(s);
  live.sort((a, b) => a.since - b.since);
  for (const s of live) {
    if (animating >= MAX_ANIMATING) break;
    animating++;
    const fps = s.job.boostFps?.(now) ?? s.fps;
    if (fps > s.fps) boosted++;
    if (now - s.last < 1000 / fps - 2) continue;
    s.last = now;
    const a = performance.now();
    s.job.frame(now);
    const cost = performance.now() - a;
    s.ms = s.frames ? s.ms * 0.9 + cost * 0.1 : cost;
    s.frames++;
    // over budget ten frames running: halve the rate (down to 4 fps)
    s.slow = cost > 14 ? s.slow + 1 : 0;
    if (s.slow >= 10) { s.slow = 0; s.fps = Math.max(4, s.fps / 2); }
  }
  lastTickMs = animating;
  if (animating) raf = requestAnimationFrame(tick);
}

/** Start the loop if something needs it. */
export function wake(): void {
  if (!raf && !document.hidden && slots.size) raf = requestAnimationFrame(tick);
}

export function addJob(job: ArtJob): () => void {
  const s: Slot = { job, vis: false, since: 0, last: -1e9, ms: 0, frames: 0, slow: 0, fps: job.fps };
  slots.set(job.el, s);
  ensureIo().observe(job.el);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', wake);
  return () => {
    slots.delete(job.el);
    io?.unobserve(job.el);
    if (!slots.size) document.removeEventListener('visibilitychange', wake);
  };
}

export interface ArtStats { boosted: number; jobs: number; visible: number; animating: number; avgMs: number; maxMs: number; perJob: { ms: number; frames: number; fps: number }[] }

export function artStats(): ArtStats {
  const all = [...slots.values()];
  const timed = all.filter((s) => s.frames > 0);
  return {
    boosted,
    jobs: all.length,
    visible: all.filter((s) => s.vis).length,
    animating: lastTickMs,
    avgMs: timed.length ? timed.reduce((a, s) => a + s.ms, 0) / timed.length : 0,
    maxMs: timed.reduce((a, s) => Math.max(a, s.ms), 0),
    perJob: timed.map((s) => ({ ms: +s.ms.toFixed(2), frames: s.frames, fps: s.fps })),
  };
}

if (typeof window !== 'undefined' && (import.meta.env.DEV || window.location.search.includes('artpreview'))) {
  (window as unknown as { __art: unknown }).__art = { stats: artStats, pause: () => { paused = true; }, resume: () => { paused = false; wake(); } };
}
