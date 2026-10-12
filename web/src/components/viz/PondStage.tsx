import { cn } from '@/lib/utils';
import { useElementSize } from './hooks';
import type { NodeId } from './patterns';
import { Topology, TopologyLegend, type TopologyTarget } from './Topology';

export interface PondStageProps {
  /**
   * Deprecated and ignored: the dithered pond field is no longer drawn behind the map (spec 05
   * §4.3). The prop stays so existing callers compile. Default false.
   */
  showField?: boolean;
  showPackets?: boolean;
  showRoutes?: boolean;
  /**
   * `true` (default): ACK % on links that are up, plus `link down` and `not in range`.
   * `'down-only'`: the two state labels without ACK % (the Overview). `false`: none.
   */
  linkLabels?: boolean | 'down-only';
  highlightRoute?: NodeId | null;
  onSelect?: (target: TopologyTarget) => void;
  /** The key under the stage. Default true. */
  legend?: boolean;
  /**
   * From 1280 px up, let the box grow past 3:2 to fill the height its parent gives: for a stage
   * that shares a grid row with a taller column. Default false.
   */
  fill?: boolean;
  className?: string;
}

/** A stage narrower than this draws the compact map. */
const COMPACT_BELOW = 520;

/**
 * The map's stage: a square-cornered box (3:2, square on a phone) with a 1 px ink-3 frame; the topology SVG
 * paints its own backdrop. It measures itself, hands its width and height to the topology, and has
 * the one-line key under it.
 */
export function PondStage({
  showField = false, showPackets = true, showRoutes = true, linkLabels = true, highlightRoute = null,
  onSelect, legend = true, fill = false, className,
}: PondStageProps) {
  void showField;
  const [ref, { width, height }] = useElementSize<HTMLDivElement>();
  const ready = width > 0 && height > 0;
  const compact = width < COMPACT_BELOW;

  return (
    <div data-slot="pond-stage" className={cn('@container flex min-w-0 flex-col gap-3', fill && 'xl:h-full', className)}>
      <div
        ref={ref}
        data-slot="pond-stage-box"
        className={cn(
          'relative aspect-square w-full overflow-hidden border border-border sm:aspect-[3/2]',
          fill && 'xl:aspect-auto xl:min-h-[66.667cqw] xl:flex-1',
        )}
      >
        {ready && (
          <Topology
            width={width}
            height={height}
            compact={compact}
            showPackets={showPackets}
            showRoutes={showRoutes}
            linkLabels={linkLabels}
            highlightRoute={highlightRoute}
            onSelect={onSelect}
            className="absolute inset-0"
          />
        )}
      </div>
      {legend && <TopologyLegend />}
    </div>
  );
}
