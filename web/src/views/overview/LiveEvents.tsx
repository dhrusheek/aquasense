import { useId, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { EmptyState } from '@/components/aq/EmptyState';
import { TONE_DOT, TONE_WORD } from '@/components/aq/tone';
import type { EventRow } from '@/data/types';
import { eventKey, interpretEvent, newestFirst } from '@/lib/interpret';
import { cn } from '@/lib/utils';

export interface LiveEventsProps {
  /** state.events, in any order; `undefined` until the first poll has answered. */
  events: readonly EventRow[] | null | undefined;
  /** Time text of a row, e.g. `(t) => tAgo(now, t)`. */
  ago: (t: EventRow['t']) => string;
  /** Lines shown (default 6). */
  max?: number;
}

/**
 * What the network is doing, in sentences: the newest events of the sink, newest first (spec 05
 * §4.8). A line that arrives while the page is open slides in once.
 */
export function LiveEvents({ events, ago, max = 6 }: LiveEventsProps) {
  const titleId = useId();
  const rows = newestFirst(events);

  // Every key present when the first data arrived. Those lines were already history, so they do
  // not animate; anything that shows up later is new. Set once (state, not a ref, because it is
  // read while rendering) and never changed afterwards.
  const [known, setKnown] = useState<Set<string> | null>(() => (events != null ? new Set(rows.map(eventKey)) : null));
  if (known === null && events != null) setKnown(new Set(rows.map(eventKey)));

  // Two reports of the same event would share a key; the second one gets a suffix.
  const used = new Map<string, number>();
  const lines = rows.slice(0, max).map((e) => {
    const base = eventKey(e);
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return { key: n ? `${base}#${n}` : base, fresh: known !== null && !known.has(base), e, ...interpretEvent(e) };
  });

  return (
    <section aria-labelledby={titleId} data-slot="live-events" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={titleId} className="tray-title">Live events</h2>
        <a
          href="#events"
          className="inline-flex items-center gap-1 text-[13px] whitespace-nowrap text-foreground underline underline-offset-4 transition-colors duration-150 hover:bg-[var(--ink-4)]"
        >
          Raw events
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </a>
      </div>

      {lines.length === 0 ? (
        <EmptyState
          compact
          description="Events appear here as the sink reports route changes, schedule updates and light changes."
        />
      ) : (
        // aria-relevant="additions": a new line is announced, the ticking "… s ago" is not.
        <ul aria-labelledby={titleId} aria-live="polite" aria-relevant="additions" className="flex flex-col gap-1.5">
          {lines.map((l) => (
            <li
              key={l.key}
              data-tone={l.tone}
              data-fresh={l.fresh || undefined}
              className={cn('flex items-start gap-3 rounded-lg', l.fresh && 'bg-[var(--ink-5)] animate-in duration-200 fade-in slide-in-from-top-2')}
            >
              <span className="tabular w-24 shrink-0 font-mono text-[13px] leading-5 text-muted-foreground">{ago(l.e.t)}</span>
              <span className="flex h-5 shrink-0 items-center">
                <span aria-hidden="true" className={cn('size-2', TONE_DOT[l.tone])} />
                <span className="sr-only">{TONE_WORD[l.tone]}: </span>
              </span>
              <span className="min-w-0 text-sm leading-5 text-foreground">{l.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
