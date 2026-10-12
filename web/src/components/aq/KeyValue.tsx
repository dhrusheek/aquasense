import { type ReactNode } from 'react';
import { EmptyState } from '@/components/aq/EmptyState';
import { TONE_TEXT } from '@/components/aq/tone';
import type { Tone } from '@/data/types';
import { cn } from '@/lib/utils';

export interface KeyValueItem {
  k: string;
  /** Text, a chip, a RoutePath … anything renderable. */
  v: ReactNode;
  /** Kept for call sites; numbers and ids are mono, words are sans (see the value cell). */
  mono?: boolean;
  /** Tints the value text; status tones only. */
  tone?: Tone;
  title?: string;
}

export interface KeyValueProps {
  items: KeyValueItem[];
  /** 2 = two columns of rows from 640 px up. */
  columns?: 1 | 2;
  /** Tighter rows and 12 px values. */
  dense?: boolean;
  /** Align values right (default) or left. */
  align?: 'left' | 'right';
  /** Sentence shown when `items` is empty; say what will fill it. */
  emptyText?: string;
  className?: string;
}

/** A definition list of facts as full-width rows: sans ink-2 key left, ink value right, 1 px ink-3 rules. */
export function KeyValue({
  items, columns = 1, dense = false, align = 'right', emptyText = 'Nothing reported yet.', className,
}: KeyValueProps) {
  if (!items.length) return <EmptyState compact description={emptyText} className={className} />;
  return (
    <dl
      data-slot="key-value"
      className={cn('grid grid-cols-1 gap-x-8', columns === 2 && 'sm:grid-cols-2', className)}
    >
      {items.map((it) => (
        <div
          key={it.k}
          className={cn(
            'flex min-w-0 items-baseline justify-between gap-6 border-b border-ink-3 py-2.5 last:border-b-0',
            dense ? 'min-h-10' : 'min-h-10',
          )}
        >
          <dt className="label-caps shrink-0 max-w-[55%]">{it.k}</dt>
          <dd
            title={it.title}
            className={cn(
              'min-w-0 wrap-break-word text-foreground tabular',
              typeof it.v === 'string' && !/[0-9]/.test(it.v) && !it.mono ? 'font-sans' : 'font-mono',
              dense ? 'text-[13px]' : 'text-sm',
              align === 'right' ? 'text-right' : 'text-left',
              it.tone && TONE_TEXT[it.tone],
            )}
          >
            {it.v}
          </dd>
        </div>
      ))}
    </dl>
  );
}
