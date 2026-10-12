import { EmptyState } from '@/components/aq/EmptyState';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { NodeId } from '@/data/types';
import { fmtI } from '@/lib/format';
import { num } from '@/lib/safe';
import { cn } from '@/lib/utils';
import { heatScale, type BleMatrix, type HeatLevel } from './loc';
import { NodeTag } from './NodeTag';

export interface RssiMatrixProps {
  /** `"N<scanner>>N<heard>"` → measurement. */
  matrix: BleMatrix;
  nodes: NodeId[];
  className?: string;
}

// Five ink tone steps, weakest to strongest: 0 / 15 / 32 / 65 / 100 % of --ink on the card, each with a 1 px rule.
// The two strongest steps are dark enough to take card-coloured text.
const LEVEL: Record<HeatLevel, string> = {
  0: 'border border-border bg-card text-foreground',
  1: 'border border-border bg-foreground/15 text-foreground',
  2: 'border border-border bg-foreground/32 text-foreground',
  3: 'border border-border bg-foreground/65 text-card',
  4: 'border border-foreground bg-foreground text-card',
};
const LEVELS: HeatLevel[] = [0, 1, 2, 3, 4];

const CHIP = 'tabular inline-flex h-9 w-12 items-center justify-center rounded-lg font-mono text-[13px] leading-none';

/**
 * Who heard whom, and how strongly: a 4 × 4 grid of smoothed RSSI in dBm, row = scanning node,
 * column = advertiser heard. Signal strength is a grey level, never a hue.
 */
export function RssiMatrix({ matrix, nodes, className }: RssiMatrixProps) {
  const pairs = Object.keys(matrix).length;
  const heard: number[] = [];
  nodes.forEach((r) => nodes.forEach((c) => {
    const v = r === c ? null : num(matrix[r + '>' + c]?.rssi);
    if (v !== null) heard.push(v);
  }));
  const scale = heatScale(heard);

  if (pairs === 0) {
    return (
      <div data-slot="rssi-matrix" className={cn('flex flex-col gap-3', className)}>
        <EmptyState
          compact
          title="No BLE measurements yet"
          description="A cell fills in when the sink reports that pair's smoothed RSSI."
        />
        <p className="px-1 text-[13px] text-muted-foreground">
          <span className="tabular font-mono">0</span> of <span className="tabular font-mono">12</span> directed pairs heard.
        </p>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={100} skipDelayDuration={300}>
      <div data-slot="rssi-matrix" className={cn('flex min-w-0 flex-col gap-3', className)}>
        {/* The grid scrolls inside its tray when the tray is narrower than the grid. */}
        <div className="-m-1 overflow-x-auto">
          <table className="border-separate border-spacing-1">
            <caption className="sr-only">
              Smoothed BLE RSSI in dBm. Each row is a scanning node, each column the advertiser it heard.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="pr-3 pb-1 text-left align-bottom text-[13px] font-normal whitespace-nowrap text-muted-foreground">
                  <span className="block">scanner ↓</span>
                  <span className="sr-only"> / </span>
                  <span className="block">heard →</span>
                </th>
                {nodes.map((c) => (
                  <th key={c} scope="col" className="pb-1 text-center align-bottom text-[13px] font-normal">
                    <NodeTag id={c} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {nodes.map((r) => (
                <tr key={r}>
                  <th scope="row" className="pr-3 text-left text-[13px] font-normal whitespace-nowrap">
                    <NodeTag id={r} />
                  </th>
                  {nodes.map((c) => {
                    if (r === c) {
                      return (
                        <td key={c} className="p-0 text-center">
                          <span className={cn(CHIP, 'border border-border bg-card text-muted-foreground')}>
                            <span aria-hidden="true">—</span>
                            <span className="sr-only">same node</span>
                          </span>
                        </td>
                      );
                    }
                    const rssi = num(matrix[r + '>' + c]?.rssi);
                    if (rssi === null) {
                      return (
                        <td key={c} className="p-0 text-center">
                          <span className={cn(CHIP, 'border border-dashed border-border text-muted-foreground')}>
                            <span aria-hidden="true">—</span>
                            <span className="sr-only">not heard</span>
                          </span>
                        </td>
                      );
                    }
                    const level = scale.level(rssi);
                    return (
                      <td key={c} className="p-0 text-center">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span data-level={level} className={cn(CHIP, 'cursor-default', LEVEL[level])}>
                              {fmtI(rssi)}
                              <span className="sr-only"> dBm</span>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" sideOffset={6} className="tabular font-mono text-2xs">
                            {r} heard {c} at {fmtI(rssi)} dBm
                          </TooltipContent>
                        </Tooltip>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1 text-[13px] text-muted-foreground">
          <p>
            <span className="tabular font-mono">{pairs}</span> of <span className="tabular font-mono">12</span> directed pairs heard.
          </p>
          {heard.length > 0 && (
            <p data-slot="rssi-scale" className="tabular flex items-center gap-2 font-mono text-2xs">
              <span>{scale.relative ? 'weakest ' : ''}{fmtI(scale.lo)} dBm</span>
              <span aria-hidden="true" className="inline-flex gap-0.5">
                {LEVELS.map((l) => <span key={l} className={cn('size-3 rounded-[4px]', LEVEL[l])} />)}
              </span>
              <span className="sr-only">to</span>
              <span>{fmtI(scale.hi)} dBm{scale.relative ? ' strongest' : ''}</span>
            </p>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
