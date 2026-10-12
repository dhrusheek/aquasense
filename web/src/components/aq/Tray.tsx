import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import './aq-motion.css';
import { Ascii } from '@/components/ascii/Ascii';
import { cn } from '@/lib/utils';

export interface TrayProps {
  /** Tray title: an <h2>, sans 15/600, sentence case. */
  title: string;
  /** Section id (also the anchor); the heading gets `${id}-title`. */
  id?: string;
  /** Quiet 13 px ink-2 subtitle under the title. */
  description?: ReactNode;
  /** Mono note beside the title (a count, a version). */
  meta?: ReactNode;
  /** Right side of the title row: a chip, a filter, a CommandButton. */
  actions?: ReactNode;
  /** Kept for call sites; the panel body is always bare now. */
  bare?: boolean;
  /** Grid placement on the view's 12-column grid, e.g. `col-span-12 lg:col-span-8`. */
  className?: string;
  children: ReactNode;
}

const FADE_MS = 120;

/** The 8-character wave at the right of the header: mounted only while hovered or fading out. */
function useHeaderWave() {
  const [state, setState] = useState<'off' | 'on' | 'leaving'>('off');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const enter = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || !window.matchMedia('(hover: hover)').matches) return;
    window.clearTimeout(timer.current);
    setState('on');
  };
  const leave = () => {
    setState((s) => (s === 'on' ? 'leaving' : s));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('off'), FADE_MS);
  };
  return { state, enter, leave };
}

/**
 * One landmark section of a view: a white 16 px-radius card (1 px ink-3 border, no shadow, 24 px padding,
 * 16 px under 640 px). The header is the sans title with an optional quiet subtitle, meta and actions on
 * the right; no title bar rule, no caps, no corner dots.
 */
export function Tray({ title, id, description, meta, actions, bare = false, className, children }: TrayProps) {
  const auto = useId();
  const titleId = `${id ?? auto}-title`;
  const wave = useHeaderWave();
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      data-slot="tray"
      data-bare={bare || undefined}
      className={cn('surface-tray flex min-w-0 flex-col gap-5 p-4 sm:p-6', className)}
    >
      <div
        data-slot="tray-header"
        onPointerEnter={wave.enter}
        onPointerLeave={wave.leave}
        className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
            <h2 id={titleId} className="tray-title">{title}</h2>
            {meta != null && meta !== false && (
              <span data-slot="tray-meta" className="meta-text">{meta}</span>
            )}
          </div>
          {description != null && description !== false && (
            <p data-slot="tray-description" className="max-w-[72ch] text-[13px] leading-5 text-muted-foreground">{description}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
          <span className="tray-wave-slot" aria-hidden="true" data-leaving={wave.state === 'leaving' || undefined}>
            {wave.state !== 'off' && <Ascii anim="wave" cols={8} rows={1} fps={6} size="xs" ink="mono" aria-hidden />}
          </span>
          {actions != null && actions !== false && (
            <div data-slot="tray-actions" className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
          )}
        </div>
      </div>
      <div data-slot="tray-body" className="flex min-w-0 flex-1 flex-col gap-4 text-card-foreground">
        {children}
      </div>
    </section>
  );
}
