import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { slotInfo, type SlotInfo } from '@/data/selectors';
import { DEFAULT_SLOTS } from '@/lib/constants';
import { fmtI } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDocumentHidden, useReducedMotion } from './hooks';
import { NodePattern } from './NodePattern';
import { isNodeId, type NodeId } from './patterns';

export interface SlotStripProps {
  variant: 'mini' | 'full';
  /** schedule.slots; an empty list falls back to [3, 1, 2, 3, 0, 255] (legacy 1448). */
  slots: number[];
  /** schedule.master. */
  master: number | null;
  /** schedule.slot_ms || 500. */
  slotMs: number;
  /** currentSlot(); null → no cursor. Optional when `t0` and `now` are given instead. */
  current?: { idx: number; frac: number } | null;
  /** !isOnline(): cursor hidden, no 'now'. Default false. */
  stale?: boolean;

  /* ---- additive (spec 02 §5, request 6) ---- */
  /** schedule.t0 and the network clock: the strip works out the current slot itself. */
  t0?: number | null;
  now?: number | null;
  /** Called when the slot under the cursor changes (null when there is no cursor). */
  onCurrentSlot?: (idx: number | null) => void;
  className?: string;
}

/**
 * Where the network is in its superframe (port of app.js 557-562, without the store):
 * `idx` = slot index, `frac` = position in the superframe 0..1. Null when `t0` or `now` is unknown.
 */
export function currentSlot(
  slots: readonly unknown[], slotMs: number, t0: number | null | undefined, now: number | null | undefined,
): { idx: number; frac: number; n: number; sl: number; sfOff: number } | null {
  if (t0 == null || now == null || !Number.isFinite(t0) || !Number.isFinite(now)) return null;
  const sl = slotMs || 500, n = slots.length || 6;
  const sfMs = sl * n, ph = ((now - t0) % sfMs + sfMs) % sfMs;
  return { idx: Math.floor(ph / sl), frac: ph / sfMs, n, sl, sfOff: Math.floor((now - t0) / sfMs) };
}

/** The owner's swatch on an ink (current) cell sits on a small round card-coloured chip, so its tone still reads. */
const CHIP_ON_INVERSE = 'inline-flex rounded-full bg-card p-0.5';

function ownerNode(info: SlotInfo): NodeId | null {
  const id = 'N' + info.ownerNum;
  return info.ownerNum !== null && isNodeId(id) ? id : null;
}

function slotLabel(i: number, info: SlotInfo, now: boolean): string {
  return `slot ${i} · ${info.owner} — ${info.kind}${now ? ' (now)' : ''}`;
}

/** The TDMA superframe: one rounded box per slot with its owner's swatch; the current slot is an ink box. */
export function SlotStrip(props: SlotStripProps) {
  const { variant, slots: slotsIn, master, slotMs, stale = false, t0, now, className } = props;
  const slots = slotsIn.length ? slotsIn : DEFAULT_SLOTS;
  const current = props.current !== undefined ? props.current : currentSlot(slots, slotMs, t0, now);
  return variant === 'mini'
    ? <Mini slots={slots} master={master} current={current} stale={stale} className={className} />
    : <Full slots={slots} master={master} slotMs={slotMs || 500} current={current} stale={stale} onCurrentSlot={props.onCurrentSlot} className={className} />;
}

/* ---------- mini: the System page and anywhere a strip has to be small ---------- */

function Mini({ slots, master, current, stale, className }: {
  slots: number[]; master: number | null; current: { idx: number; frac: number } | null; stale: boolean; className?: string;
}) {
  return (
    <ol data-slot="slot-strip" data-variant="mini" aria-label="TDMA superframe" className={cn('flex items-center gap-1', className)}>
      {slots.map((_, i) => {
        const info = slotInfo(i, slots, master);
        const nowHere = !!current && current.idx === i && !stale;
        const owner = ownerNode(info);
        const text = slotLabel(i, info, nowHere);
        return (
          <li
            key={i}
            title={text}
            aria-label={text}
            aria-current={nowHere ? 'time' : undefined}
            data-now={nowHere || undefined}
            className={cn(
'relative flex h-6 w-7 items-center justify-center rounded-[10px] border font-mono text-2xs leading-none',
              // rounded cells; control is on an ink-4 fill, unused dashed; the current slot is an ink cell
              nowHere ? 'z-10 border-foreground bg-foreground text-card' : 'border-border bg-card text-muted-foreground',
              !nowHere && info.cls === 'control' && 'bg-[var(--ink-4)]',
              info.cls === 'unused' && 'border-dashed',
            )}
          >
            {owner
              ? <span className={nowHere ? CHIP_ON_INVERSE : 'inline-flex'}><NodePattern id={owner} size={12} /></span>
              : info.cls === 'control' ? 'C' : '·'}
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- full: view r4 ---------- */

interface CursorState {
  /** Superframe position and the performance.now() it was true at; the rAF loop dead-reckons from it. */
  frac: number; at: number;
  sfMs: number; n: number;
  stale: boolean; reduced: boolean; hidden: boolean;
  idx: number | null;
  x: number; y: number; h: number;
  raf: number;
}

function Full({ slots, master, slotMs, current, stale, onCurrentSlot, className }: {
  slots: number[]; master: number | null; slotMs: number; current: { idx: number; frac: number } | null; stale: boolean;
  onCurrentSlot?: (idx: number | null) => void; className?: string;
}) {
  const reduced = useReducedMotion();
  const hidden = useDocumentHidden();
  const gridRef = useRef<HTMLOListElement | null>(null);
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const [nowIdx, setNowIdx] = useState<number | null>(current && !stale ? current.idx : null);
  const notify = useRef(onCurrentSlot);
  useEffect(() => { notify.current = onCurrentSlot; }, [onCurrentSlot]);

  const n = slots.length;
  const st = useRef<CursorState>({
    frac: 0, at: 0, sfMs: slotMs * n, n, stale, reduced, hidden, idx: null, x: -1, y: -1, h: -1, raf: 0,
  });

  // Re-sync the dead-reckoning clock whenever the caller hands in a fresh position.
  const has = current !== null;
  const frac = current ? current.frac : 0;
  useLayoutEffect(() => {
    const s = st.current;
    s.frac = frac;
    s.at = performance.now();
    s.sfMs = slotMs * n;
    s.n = n;
    s.stale = stale || !has;
    s.reduced = reduced;
    s.hidden = hidden;
  }, [frac, has, slotMs, n, stale, reduced, hidden]);

  // One rAF loop moves the cursor. It reads the slot boxes' geometry, so it follows the grid when it
  // wraps (two columns on a phone), and it writes a style only when the rounded pixel changes.
  useEffect(() => {
    const s = st.current;
    const tick = () => {
      s.raf = requestAnimationFrame(tick);
      const grid = gridRef.current, cur = cursorRef.current;
      if (!grid || !cur) return;
      if (s.stale) {
        if (s.idx !== null) { s.idx = null; setNowIdx(null); notify.current?.(null); }
        if (s.x !== -2) { s.x = -2; cur.style.visibility = 'hidden'; }
        return;
      }
      const f = (s.frac + (performance.now() - s.at) / s.sfMs) % 1;
      const pos = f * s.n;
      const idx = Math.min(s.n - 1, Math.floor(pos));
      const within = s.reduced ? 0 : pos - idx; // reduced motion: snap to the slot's left edge
      if (idx !== s.idx) { s.idx = idx; setNowIdx(idx); notify.current?.(idx); }
      const el = grid.children[idx] as HTMLElement | undefined;
      if (!el) return;
      const x = Math.round(el.offsetLeft + within * el.offsetWidth) - 1;
      const y = el.offsetTop, h = el.offsetHeight;
      if (x !== s.x || y !== s.y || h !== s.h) {
        if (s.x === -2 || s.x === -1) cur.style.visibility = 'visible';
        s.x = x; s.y = y; s.h = h;
        cur.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        cur.style.height = `${h}px`;
      }
    };
    if (!hidden) s.raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(s.raf); s.raf = 0; s.x = -1; };
  }, [hidden]);

  const cols = Math.min(Math.max(n, 1), 8);
  return (
    <TooltipProvider delayDuration={150}>
      <div data-slot="slot-strip" data-variant="full" className={cn('flex flex-col gap-3', className)}>
        <div className="relative">
          <ol
            ref={gridRef}
            aria-label="TDMA superframe, one box per slot"
            className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(var(--slot-cols),minmax(0,1fr))]"
            style={{ '--slot-cols': cols } as CSSProperties}
          >
            {slots.map((_, i) => {
              const info = slotInfo(i, slots, master);
              const owner = ownerNode(info);
              const nowHere = nowIdx === i && !stale;
              const range = `${fmtI(i * slotMs)}–${fmtI((i + 1) * slotMs)} ms`;
              return (
                <Tooltip key={i}>
                  <TooltipTrigger asChild>
                    <li
                      tabIndex={0}
                      aria-label={`slot ${i}, ${range}, ${info.owner}, ${info.kind}${nowHere ? ', now' : ''}`}
                      aria-current={nowHere ? 'time' : undefined}
                      data-slot-kind={info.cls}
                      data-now={nowHere || undefined}
                      className={cn(
                        'relative flex min-w-0 flex-col gap-1 rounded-[10px] border p-3',
                        // rounded cells; control is on an ink-4 fill, unused dashed, the beacon has an ink border;
                        // the current slot is an ink cell
                        nowHere ? 'z-10 border-foreground bg-foreground text-card' : 'border-border bg-card',
                        !nowHere && info.cls === 'control' && 'bg-[var(--ink-4)]',
                        info.cls === 'unused' && 'border-dashed',
                        !nowHere && info.cls === 'beacon' && 'border-foreground',
                      )}
                    >
                      <span className={cn('tabular flex flex-col font-mono text-2xs', nowHere ? 'text-card' : 'text-muted-foreground')}>
                        <span>slot {i}</span>
                        <span>{range}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        {owner || info.cls === 'control'
                          ? <span className={nowHere ? CHIP_ON_INVERSE : 'inline-flex'}><NodePattern id={owner ?? 'hatch'} size={16} /></span>
                          : null}
                        <span className={cn('text-base leading-6 font-semibold', owner && 'font-mono', nowHere ? 'text-card' : 'text-ink')}>{info.owner}</span>
                      </span>
                      <span className={cn('text-[13px] leading-5', nowHere ? 'text-card' : 'text-muted-foreground')}>{info.kind}</span>
                    </li>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={6} className="block">
                    <div className="tabular flex flex-col gap-0.5 text-xs">
                      <span className="font-mono">slot {i} · {range}</span>
                      <span className="font-semibold">{info.owner}</span>
                      <span>{info.kind}</span>
                      {nowHere && <span>now</span>}
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </ol>
          {/* the cursor: current network time sweeping the slots */}
          <div
            ref={cursorRef}
            aria-hidden="true"
            data-slot="slot-cursor"
            className="pointer-events-none invisible absolute top-0 left-0 z-20 w-0.5 rounded-full bg-white mix-blend-difference will-change-transform"
          />
        </div>
      </div>
    </TooltipProvider>
  );
}
