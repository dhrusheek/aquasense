import { cn } from '@/lib/utils';

export interface MeterProps {
  /** Current value; null renders an empty track. */
  value: number | null;
  /** Full-scale value (default 100). */
  max?: number;
  /** Accessible name (also the tooltip). */
  label?: string;
  className?: string;
}

/** A thin rounded progress bar: 6 px ink-4 track, ink fill. Replaces the ASCII `[####....]` meters. */
export function Meter({ value, max = 100, label, className }: MeterProps) {
  const known = value !== null && Number.isFinite(value) && max > 0;
  const pct = known ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={known ? value : undefined}
      title={label}
      data-slot="meter"
      className={cn('meter-track w-full min-w-0', className)}
    >
      <div className="meter-fill motion-reduce:transition-none" style={{ width: `${pct}%` }} />
    </div>
  );
}
