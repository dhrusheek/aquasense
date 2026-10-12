import { isValidElement, type ReactNode } from 'react';
import { TONE_DOT, TONE_WORD } from '@/components/aq/tone';
import { Skeleton } from '@/components/ui/skeleton';
import type { Num, Tone } from '@/data/types';
import { fmt } from '@/lib/format';
import { useDecode } from '@/lib/useDecode';
import { cn } from '@/lib/utils';

export interface StatTileProps {
  label: string;
  /** A number is formatted with `fmt(value, decimals)`; null / undefined render "—"; anything else renders as given. */
  value: ReactNode | Num;
  /** Decimals for a numeric `value` (default 1). */
  decimals?: number;
  unit?: string;
  /** One 13 px ink-2 line under the value. */
  sub?: ReactNode;
  /** ok / warn / bad draw a 6 px round dot at the right of the label: `--ok`, outlined, `--bad`. The value is ink. */
  tone?: Tone;
  /** `md` = 18 px value, for long strings such as "(50, 30)". */
  size?: 'lg' | 'md';
  /** Chart slot under the tile (CellSpark), 32 px tall, full width. */
  spark?: ReactNode;
  loading?: boolean;
  className?: string;
  'aria-label'?: string;
}

function isStatus(tone: Tone | undefined): tone is 'ok' | 'warn' | 'bad' {
  return tone === 'ok' || tone === 'warn' || tone === 'bad';
}

/** One headline number: label, value + unit, a sub line and an optional spark. */
export function StatTile({
  label, value, decimals = 1, unit, sub, tone, size = 'lg', spark, loading = false, className, 'aria-label': ariaLabel,
}: StatTileProps) {
  const empty = value === null || value === undefined || value === '' || typeof value === 'boolean';
  const shown: ReactNode = empty ? '—' : typeof value === 'number' ? fmt(value, decimals) : (value as ReactNode);
  const decode = useDecode(!empty && typeof shown === 'string' ? shown : null);
  const hasSub = sub !== null && sub !== undefined && sub !== false && sub !== '';

  return (
    <div
      data-slot="stat-tile"
      data-tone={tone}
      role="group"
      aria-label={ariaLabel ?? label}
      aria-busy={loading || undefined}
      className={cn('surface-card flex min-h-28 min-w-0 flex-col p-4 text-card-foreground sm:p-5', className)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="label-caps min-w-0 truncate" title={label}>{label}</span>
        {isStatus(tone) && (
          <span data-slot="stat-tile-tone" className={cn('size-1.5 shrink-0', TONE_DOT[tone])}>
            <span className="sr-only">{TONE_WORD[tone]}: </span>
          </span>
        )}
      </div>

      {loading ? (
        <div className="mt-3 flex flex-col gap-2">
          <Skeleton className="h-8 w-24 max-w-full" />
          <Skeleton className="h-3 w-32 max-w-full" />
        </div>
      ) : (
        <>
          <div className="mt-2 flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            <span
              data-slot="stat-tile-value"
              role={decode.decoding ? 'img' : undefined}
              aria-label={decode.decoding && typeof shown === 'string' ? shown : undefined}
              className={cn(
                'tabular min-w-0 font-mono font-medium tracking-tight',
                size === 'md' ? 'text-lg' : 'text-[28px] leading-9',
                empty ? 'text-muted-foreground' : 'text-foreground',
              )}
            >
              {decode.decoding ? decode.text : shown}
            </span>
            {unit && !empty && <span className="font-mono text-[13px] text-muted-foreground">{unit}</span>}
          </div>
          <div
            data-slot="stat-tile-sub"
            className={cn('mt-1 min-w-0 text-[13px] leading-5 text-muted-foreground', !isValidElement(sub) && 'truncate')}
            title={typeof sub === 'string' ? sub : undefined}
          >
            {hasSub ? sub : ' '}
          </div>
        </>
      )}

      {spark != null && spark !== false && <div data-slot="stat-tile-spark" className="mt-3 h-8 w-full">{spark}</div>}
    </div>
  );
}
