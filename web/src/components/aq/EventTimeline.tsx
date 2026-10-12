import type { ReactNode } from 'react';
import { EmptyState } from '@/components/aq/EmptyState';
import { TONE_WORD } from '@/components/aq/tone';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Num, Tone } from '@/data/types';
import { cn } from '@/lib/utils';

export interface EventTimelineItem {
  key: string;
  /** Network time in ms; the caller sorts (newest first). */
  t: Num;
  /** Ready-made time text, e.g. `netT(t) + ' · ' + whenStr(now, row)`. */
  timeLabel: string;
  tone: Tone;
  title: ReactNode;
  detail?: string;
}

export interface EventTimelineProps {
  items: EventTimelineItem[];
  /** Rows kept (default 40). */
  max?: number;
  /** Sentence shown when there are no items; say what will fill it. */
  emptyText: string;
  /** Accessible name of the list. */
  label?: string;
  className?: string;
}

// The marker is a 6 px round dot on the rail: `--ok`, outlined for warn, `--bad` for a failure.
const MARKER: Record<Tone, string> = {
  ok: 'bg-ok',
  warn: 'border border-foreground bg-card',
  bad: 'bg-bad',
  info: 'bg-foreground',
  neutral: 'border border-ink-2 bg-card',
};

/** A vertical event list on a 1 px ink-3 rail (failure / recovery, schedule and light history). */
export function EventTimeline({ items, max = 40, emptyText, label, className }: EventTimelineProps) {
  if (!items.length) return <EmptyState compact description={emptyText} className={className} />;
  const shown = items.slice(0, max);
  return (
    <ScrollArea
      data-slot="event-timeline"
      className={cn('[&>[data-slot=scroll-area-viewport]]:max-h-[440px]', className)}
    >
      <ol aria-label={label} className="relative pr-3">
        <span aria-hidden="true" className="absolute top-1 bottom-0 left-[7px] w-px bg-ink-3" />
        {shown.map((it) => (
          <li key={it.key} data-tone={it.tone} className="relative pb-4 pl-7 last:pb-0">
            <span aria-hidden="true" className={cn('absolute top-1.5 left-[5px] size-1.5 rounded-full', MARKER[it.tone])} />
            <div className="tabular meta-text">
              <span className="sr-only">{TONE_WORD[it.tone]}: </span>
              {it.timeLabel}
            </div>
            <div className="font-sans text-sm text-foreground">{it.title}</div>
            {it.detail && <div className="text-[13px] text-muted-foreground">{it.detail}</div>}
          </li>
        ))}
      </ol>
    </ScrollArea>
  );
}
