import { CellChart } from '@/components/viz/CellChart';
import { useElementSize } from '@/components/viz/hooks';
import type { Num } from '@/data/types';

export interface LocErrChartProps {
  /** derived.series.loc_err_N1: one sample per superframe, cm. */
  values: Num[];
  /** derived.series.t: network time of each sample, ms. */
  t: Num[];
  loading?: boolean;
}

/** Cell and gap in px, largest first. */
const FITS: [number, number][] = [[6, 2], [5, 1], [4, 1], [3, 1], [2, 1]];
/** Width CellChart keeps for its y axis. */
const GUTTER = 36;
const HEIGHT = 300;

/**
 * Localization error of N1 over time, in N1's tone step. The window is the last 120 superframes, so
 * the cell size is the largest that still gives every sample its own column; on a box too narrow
 * for that, CellChart shows the newest samples and says how many.
 */
export function LocErrChart({ values, t, loading = false }: LocErrChartProps) {
  const [ref, { width }] = useElementSize<HTMLDivElement>();
  const n = Math.max(1, values.length);
  const [cell, gap] = FITS.find(([c, g]) => Math.floor((width - GUTTER) / (c + g)) >= n) ?? FITS[FITS.length - 1];
  return (
    <div ref={ref} data-slot="loc-err-chart" className="min-h-75 min-w-0">
      {width > 0 && (
        <CellChart
          mode="single"
          title="Localization error of N1 over time"
          series={[{ id: 'N1', label: 'N1 error', node: 'N1', values }]}
          t={t}
          yMin={0}
          unit="cm"
          decimals={1}
          cell={cell}
          gap={gap}
          height={HEIGHT}
          loading={loading}
          emptyText="No localization error yet. One point arrives per superframe (every 3 s) once the sink has located N1 from its three anchors."
        />
      )}
    </div>
  );
}
