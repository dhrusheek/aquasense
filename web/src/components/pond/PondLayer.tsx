// Pond life (spec 09): a fixed layer under every card holding the water canvas and one goldfish.
// This file owns the DOM, listeners, tokens and the single rAF loop; the fish and the water are
// pure modules. Nothing is mounted (and no listener attached) on Home, when the pref is off, or
// below 1024 px for the fish and glints (ripples run at every width).
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useHashRoute } from '@/app/useHashRoute';
import { pondEnabledNow, usePondEnabled } from '@/components/pond/prefs';
import { useReducedMotion } from '@/components/viz/hooks';
import { RELEASE } from '@/lib/constants';
import { useSnapshot } from '@/data/hooks';
import { isOnline, lightOf } from '@/data/selectors';
import { Fish, type Attention, type Stimulus } from './fish';
import { sampleObstacles, type Ctx, type Obstacles } from './obstacles';
import { KEY, Water, type Cell } from './water';
import './pond.css';

const ATTN_SEL = '[data-slot=stat-tile], [data-slot=tray], [data-slot=light-card], [data-slot=pond-stage], [data-slot=sidebar-container], header[data-slot=top-bar]';
const CELL_H = 17;
const WIDE = '(min-width: 1024px)';
const FONT_FALLBACK = '"Geist Mono Variable", monospace';

interface PondStats { fps: number; frameMs: number; loops: number; vis: number; peekQuality: number; state: string; ripples: number; glints: number; bubbles: number; enabled: boolean }
interface PondCell { x: number; y: number; ch: string }
declare global { interface Window { __pond?: { stats(): PondStats; cells(): PondCell[] } } }

interface Api { stim(k: Stimulus): void; route(): void }

function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => { const mq = window.matchMedia(WIDE); mq.addEventListener('change', cb); return () => mq.removeEventListener('change', cb); },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

export function PondLayer() {
  const [pref] = usePondEnabled();
  const route = useHashRoute();
  if (!pref || !pondEnabledNow() || route === 'home' || route === 'story') return null;
  return <Pond route={route} />;
}

function Pond({ route }: { route: string }) {
  const reduced = useReducedMotion();
  const wide = useWide();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fishRef = useRef<HTMLPreElement>(null);
  const api = useRef<Api | null>(null);

  useEffect(() => {
    const root = rootRef.current, canvas = canvasRef.current, fishEl = fishRef.current;
    const g = canvas?.getContext('2d');
    if (!root || !canvas || !g) return;
    const nowS = () => performance.now() / 1000;
    const water = new Water();
    const fish = wide ? new Fish({
      bubble: (x, y, z) => water.bubble(x, y, undefined, z),
      depart: (x, y) => water.depart(x, y),
      cheer: (x, y) => water.ripple(x, y, undefined, 'cheer'),
    }) : null;

    let W = 0, H = 0, dpr = 1, cellW = 8.4;
    let tokens = { n2: '', n3: '', n4: '' };
    let obs: Obstacles = { pads: [], text: [] };
    let fobs: Obstacles = obs; // what the fish sees: under the cyber skin the content column counts as a pad, so it keeps to the gutters
    const cyber = document.documentElement.dataset.skin === 'cyber';
    let att: Attention | null = null, attEl: Element | null = null;
    let hoverEl: Element | null = null, hoverSince = 0, hoverDone: Element | null = null;
    let ptr: { x: number; y: number } | null = null;
    let lastProbe = 0, probeTimer = 0, lastSample = -1e9, dirty = true, alive = true, placed = false;
    let raf = 0, timer = 0, last = 0, lastWater = 0, lastSpawn = 0, drawn = false, warned = false;
    let ewma = 0, shown: Map<number, Cell> = new Map();
    const stamps: number[] = [];
    /* Release skin: cursor wake, a trail of ~ . , that fades in 400 ms (fine pointers only, at most 12 live). */
    const WAKE_MAX = 12, WAKE_MS = 400, WAKE_CH = ['~', '.', ','];
    const wake: Array<{ x: number; y: number; ch: string; t: number }> = [];
    let wakeLast: { x: number; y: number } | null = null, wakeN = 0;
    let lastText = '', lastOp = -1, lastTone = '';
    const ids = new WeakMap<Element, number>();
    let nextId = 1;
    const cells = (): Ctx => ({ w: W, h: H, cellW, cellH: CELL_H, now: nowS() });

    const readTokens = () => {
      const cs = getComputedStyle(document.documentElement);
      tokens = { n2: cs.getPropertyValue('--n2').trim(), n3: cs.getPropertyValue('--n3').trim(), n4: cs.getPropertyValue('--n4').trim() };
    };
    const applyFont = () => {
      const fam = getComputedStyle(document.documentElement).getPropertyValue('--font-mono') || FONT_FALLBACK;
      g.font = `14px ${fam}`;
      g.textBaseline = 'top';
      cellW = g.measureText('M').width || 8.4;
    };
    const size = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = root.clientWidth; H = root.clientHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      applyFont();
      drawn = false;
    };
    const attend = (el: Element, ref: { x: number; y: number } | null, ttl: number) => {
      let id = ids.get(el);
      if (!id) { id = nextId++; ids.set(el, id); }
      const r = el.getBoundingClientRect();
      att = { id, rect: { x: r.left, y: r.top, w: r.width, h: r.height }, ref, until: nowS() + ttl };
      attEl = el;
      kick();
    };
    const sample = () => {
      obs = sampleObstacles();
      fobs = obs;
      const col = cyber ? document.querySelector('.cy-main')?.getBoundingClientRect() : null;
      if (col && col.width > 0) fobs = { pads: [...obs.pads, { x: col.left + 16, y: -1000, w: Math.max(0, col.width - 32), h: H + 2000 }], text: obs.text };
      lastSample = performance.now(); dirty = false;
      if (attEl && att) { const r = attEl.getBoundingClientRect(); att.rect = { x: r.left, y: r.top, w: r.width, h: r.height }; }
      if (!placed && fish && W) { placed = true; if (reduced) fish.park(cells(), fobs); else fish.place(cells(), fobs); }
    };
    const probe = (x: number, y: number) => {
      lastProbe = performance.now();
      const el = document.elementFromPoint(x, y)?.closest(ATTN_SEL) ?? null;
      if (el !== hoverEl) { hoverEl = el; hoverSince = lastProbe; }
    };
    // Throttled to 250 ms, with a trailing call so the remembered element is where the pointer ended up.
    const probeSoon = () => {
      const wait = 250 - (performance.now() - lastProbe);
      if (wait <= 0) { if (ptr) probe(ptr.x, ptr.y); return; }
      if (probeTimer) return;
      probeTimer = window.setTimeout(() => { probeTimer = 0; if (ptr && alive) { probe(ptr.x, ptr.y); kick(); } }, wait);
    };

    const paint = (m: Map<number, Cell>) => {
      shown = m;
      const tNow = performance.now();
      while (wake.length && tNow - wake[0].t >= WAKE_MS) wake.shift();
      if (!m.size && !drawn && !wake.length) return;
      g.clearRect(0, 0, W, H);
      for (const [k, c] of m) {
        g.globalAlpha = c.a;
        g.fillStyle = c.tone === 3 ? tokens.n3 : tokens.n4;
        g.fillText(c.ch, (k % KEY) * cellW, Math.floor(k / KEY) * CELL_H);
      }
      for (const w of wake) {
        g.globalAlpha = 1 - (tNow - w.t) / WAKE_MS;
        g.fillStyle = tokens.n2;
        g.fillText(w.ch, w.x - cellW / 2, w.y - CELL_H / 2);
      }
      g.globalAlpha = 1;
      drawn = m.size > 0 || wake.length > 0;
    };

    /** One frame. Returns when the next one is wanted: 0 = next animation frame, >0 = ms asleep, <0 = not at all. */
    const step = (nowMs: number): number => {
      const a = performance.now();
      const dt = Math.min(0.1, (nowMs - last) / 1000);
      last = nowMs;
      if (dirty || a - lastSample > 500) sample();
      const c = cells();
      if (fish && fishEl && placed) {
        if (hoverEl && hoverEl !== hoverDone && ptr && a - hoverSince >= 600) { hoverDone = hoverEl; attend(hoverEl, ptr, 10); }
        // Attention holds while the pointer stays on the element and ends 10 s after it leaves.
        if (att && attEl && hoverEl === attEl && ptr) att.until = c.now + 10;
        if (!reduced) {
          const v = fish.update(dt, c, fobs, att);
          fishEl.style.transform = `translate3d(${v.x.toFixed(2)}px,${v.y.toFixed(2)}px,0)`;
          if (v.text !== lastText) { fishEl.textContent = v.text; lastText = v.text; }
          if (v.opacity !== lastOp) { fishEl.style.opacity = String(v.opacity); lastOp = v.opacity; }
          if (v.tone !== lastTone) { fishEl.style.color = `var(--${v.tone})`; lastTone = v.tone; }
        } else if (!lastText) {
          const v = fish.update(0, c, fobs, null);
          fishEl.style.transform = `translate3d(${v.x}px,${v.y}px,0)`;
          fishEl.textContent = v.text; lastText = v.text; fishEl.style.opacity = '0.75';
        }
      }
      const awake = !!fish && !reduced && !fish.idle();
      const busy = water.busy();
      if (nowMs - lastWater >= (busy ? 50 : 160) && (busy || awake || drawn || wake.length || water.glintCount())) {
        lastWater = nowMs;
        const spawn = nowMs - lastSpawn >= 160;
        if (spawn) lastSpawn = nowMs;
        paint(water.tick(c, obs, { glints: awake, spawn }));
      }
      const cost = performance.now() - a;
      ewma = ewma ? ewma * 0.9 + cost * 0.1 : cost;
      // Next frame: every frame while anything moves, 2 Hz while the fish sleeps, nothing when idle.
      if (wake.length) return 0;
      if (fish && !reduced && fish.slow()) return 125; // asleep (or long in bed): 8 fps at most, bubbles included
      if (water.busy() || awake) return 0;
      return fish && !reduced ? 500 : -1;
    };
    const frame = (nowMs: number) => {
      raf = 0;
      if (!alive || document.hidden) return;
      stamps.push(performance.now());
      let next = 0;
      try { next = step(nowMs); } catch (e) {
        // One bad frame must never freeze the fish: log once (dev) and keep going.
        if (import.meta.env.DEV && !warned) { warned = true; console.error('[pond] frame failed', e); }
      }
      if (next >= 0) schedule(next);
    };
    /** The only place a frame or a sleep timer is requested: at most one of them is ever pending. */
    function schedule(sleepMs = 0) {
      stop();
      if (!alive || document.hidden) return;
      if (sleepMs > 0) timer = window.setTimeout(() => { timer = 0; frame(performance.now()); }, sleepMs);
      else raf = requestAnimationFrame(frame);
    }
    function stop() {
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      raf = timer = 0;
    }
    /** Wake the loop: never starts a second chain; an input cuts a sleep short. */
    function kick() {
      if (raf || !alive || document.hidden) return;
      last = performance.now();
      schedule();
    }

    /* ---------- listeners (all passive, all removed below) ---------- */
    const P = { passive: true } as const;
    const onDown = (e: PointerEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      const big = !!t?.closest('[data-slot=theme-toggle]');
      if (!placed) sample();
      water.ripple(e.clientX, e.clientY, nowS(), reduced ? 'still' : big ? 'big' : 'click', obs.pads);
      if (fish && !reduced) {
        fish.input(nowS());
        if (Math.hypot(fish.x - e.clientX, fish.y - e.clientY) < 220) fish.stimulus('dart', { x: e.clientX, y: e.clientY });
      }
      kick();
    };
    const onKeyClick = (e: MouseEvent) => {
      const t = e.target instanceof Element ? e.target.closest('[data-slot=theme-toggle]') : null;
      if (!t || e.detail !== 0) return;
      const r = t.getBoundingClientRect();
      water.ripple(r.left + r.width / 2, r.top + r.height / 2, nowS(), reduced ? 'still' : 'big', obs.pads);
      kick();
    };
    const onMove = (e: PointerEvent) => {
      if (!fish || reduced) return;
      // Browsers replay the last pointer position after layout changes; that is not the user moving.
      if (ptr && e.clientX === ptr.x && e.clientY === ptr.y) return;
      ptr = { x: e.clientX, y: e.clientY };
      fish.input(nowS());
      if (e.pointerType === 'touch') return;
      probeSoon();
      kick();
    };
    const onWake = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
      if (wakeLast && Math.hypot(e.clientX - wakeLast.x, e.clientY - wakeLast.y) < 22) return;
      wakeLast = { x: e.clientX, y: e.clientY };
      wake.push({ x: e.clientX, y: e.clientY, ch: WAKE_CH[wakeN++ % WAKE_CH.length], t: performance.now() });
      if (wake.length > WAKE_MAX) wake.shift();
      kick();
    };
    const onInput = () => { fish?.input(nowS()); kick(); };
    const onFocus = (e: FocusEvent) => {
      const el = e.target instanceof Element ? e.target.closest(ATTN_SEL) : null;
      if (fish && !reduced && el) attend(el, null, 8);
    };
    const onLeave = () => { hoverEl = null; ptr = null; clearTimeout(probeTimer); probeTimer = 0; };
    const onLayout = () => { dirty = true; kick(); };
    const onResize = () => { size(); dirty = true; if (reduced) placed = false; kick(); };
    const onVis = () => { if (document.hidden) stop(); else kick(); };

    document.addEventListener('pointerdown', onDown, { capture: true, ...P });
    document.addEventListener('click', onKeyClick, { capture: true, ...P });
    document.addEventListener('visibilitychange', onVis, P);
    window.addEventListener('resize', onResize, P);
    window.addEventListener('scroll', onLayout, P);
    if (RELEASE && !reduced && window.matchMedia('(pointer: fine)').matches) document.addEventListener('pointermove', onWake, P);
    if (fish) {
      document.addEventListener('pointermove', onMove, P);
      document.addEventListener('keydown', onInput, P);
      document.addEventListener('focusin', onFocus, P);
      document.documentElement.addEventListener('mouseleave', onLeave, P);
    }
    const mo = new MutationObserver(readTokens);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    api.current = {
      stim: (k) => { fish?.stimulus(k); kick(); },
      route: () => {
        fish?.stimulus('dart');
        window.setTimeout(() => {
          if (!alive) return;
          dirty = true;
          const el = document.querySelector('[data-slot=tray], [data-slot=stat-tile]');
          if (el && fish && !reduced) attend(el, null, 15);
          kick();
        }, 200);
      },
    };

    if (fishEl && !cyber) { fishEl.style.transition = 'opacity 200ms linear, color 600ms linear'; }
    readTokens(); size();
    document.fonts?.load('14px "Geist Mono Variable"').then(() => { if (alive) { size(); dirty = true; kick(); } }, () => {});
    kick();

    if (import.meta.env.DEV) {
      window.__pond = {
        stats: () => {
          const t = performance.now();
          while (stamps.length && t - stamps[0] > 1000) stamps.shift();
          return { fps: stamps.length, frameMs: +ewma.toFixed(2), loops: (raf ? 1 : 0) + (timer ? 1 : 0), vis: fish ? +fish.visible(obs).toFixed(2) : 1, peekQuality: fish ? +fish.peekQ.toFixed(2) : 1, state: fish?.mode ?? 'none', ...water.counts(), enabled: true };
        },
        cells: () => [...shown].map(([k, c]) => ({ x: (k % KEY) * cellW, y: Math.floor(k / KEY) * CELL_H, ch: c.ch })),
      };
    }

    return () => {
      alive = false;
      stop(); clearTimeout(probeTimer);
      document.removeEventListener('pointerdown', onDown, { capture: true });
      document.removeEventListener('click', onKeyClick, { capture: true });
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onLayout);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointermove', onWake);
      document.removeEventListener('keydown', onInput);
      document.removeEventListener('focusin', onFocus);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      mo.disconnect();
      water.clear();
      api.current = null;
      if (import.meta.env.DEV) delete window.__pond;
    };
  }, [wide, reduced]);

  // Route change: startle and look at the new view's first card.
  const prevRoute = useRef(route);
  useEffect(() => {
    if (prevRoute.current === route) return;
    prevRoute.current = route;
    api.current?.route();
  }, [route]);

  // Data: a red or hot pond light agitates the fish; going offline or stale sinks it.
  const snap = useSnapshot();
  const light = lightOf(snap).state, online = isOnline(snap);
  const prev = useRef({ light, online });
  useEffect(() => {
    const p = prev.current;
    if (light !== p.light) {
      if (light === 'red' || light === 'hot') api.current?.stim('agitate');
      else if (light === 'stale') api.current?.stim('sink');
      else if (p.light === 'stale' && online) api.current?.stim('surface');
    }
    if (online !== p.online) api.current?.stim(online ? 'surface' : 'sink');
    prev.current = { light, online };
  }, [light, online]);

  return (
    <div ref={rootRef} data-slot="pond" aria-hidden="true">
      <canvas ref={canvasRef} data-slot="pond-water" />
      {wide && <pre ref={fishRef} data-slot="pond-fish" />}
    </div>
  );
}
