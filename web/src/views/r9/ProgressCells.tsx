import { cn } from '@/lib/utils';

export interface ProgressCellsProps {
  /** One entry per step, in step order: true = shown. */
  steps: boolean[];
  /** Write `13 of 17` after the squares. Default true. */
  count?: boolean;
  className?: string;
}

/**
 * Progress as a row of small rounded squares, one per step: ink when the step has been shown, an
 * ink-4 square otherwise, so a gap says exactly which step is missing; the next step to show has an
 * ink ring. `13 of 17` follows.
 */
export function ProgressCells({ steps, count = true, className }: ProgressCellsProps) {
  const done = steps.filter(Boolean).length;
  const next = steps.indexOf(false);
  return (
    <span
      role="img"
      aria-label={`${done} of ${steps.length} steps shown`}
      data-slot="progress-cells"
      className={cn('inline-flex flex-wrap items-center gap-x-3 gap-y-1.5', className)}
    >
      <span aria-hidden="true" className="inline-flex flex-wrap items-center gap-1">
        {steps.map((on, i) => (
          <span
            key={i}
            className={cn(
              'size-2.5 rounded-[3px]',
              on ? 'bg-foreground' : 'bg-[var(--ink-4)]',
              i === next && 'ring-1 ring-foreground ring-offset-1 ring-offset-card',
            )}
          />
        ))}
      </span>
      {count && <span aria-hidden="true" className="tabular font-mono text-[13px] whitespace-nowrap text-muted-foreground">{done} of {steps.length}</span>}
    </span>
  );
}
