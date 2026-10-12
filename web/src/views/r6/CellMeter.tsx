import { Meter } from '@/components/aq/Meter';

export interface CellMeterProps {
  /** 0–100; null draws the meter empty. Values outside the range are clamped (legacy ring gauge). */
  pct: number | null;
  className?: string;
}

/**
 * A percentage as a thin rounded progress bar (6 px, ink on an ink-4 track). Replaces the legacy
 * ring gauge (app.js 1205-1208); the exact number sits beside it in the tile.
 */
export function CellMeter({ pct, className }: CellMeterProps) {
  const known = pct !== null && Number.isFinite(pct);
  return <Meter value={known ? pct : null} max={100} label={known ? `${Math.round(pct)} %` : 'No value yet'} className={className} />;
}
