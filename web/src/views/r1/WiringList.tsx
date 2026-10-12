// The wiring of one board, as a pinout list (port of the legacy `.wiring`, app.js 689-691).
import { EmptyState } from '@/components/aq/EmptyState';
import { NodePattern } from '@/components/viz/NodePattern';
import type { NodeId } from '@/data/types';

export interface WiringListProps {
  node: NodeId;
  /** `N<k> · <short role>`. */
  title: string;
  /** One connection per line, verbatim from docs/PROTOCOL_SPEC.md §1. */
  items: string[];
}

export function WiringList({ node, title, items }: WiringListProps) {
  return (
    <article
      data-slot="wiring-list"
      data-node={node}
      aria-label={`Wiring of ${title}`}
      className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card p-4 text-card-foreground sm:p-6"
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <span aria-hidden="true" className="flex shrink-0">
          <NodePattern id={node} size={18} />
        </span>
        <span className="min-w-0">{title}</span>
      </h3>
      {items.length ? (
        <ul className="flex flex-col divide-y divide-border border-t border-border">
          {items.map((w) => (
            <li key={w} className="py-2 font-mono text-[13px] leading-6 wrap-break-word text-foreground last:pb-0">
              {w}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact description="No wiring is listed for this board. Each connection between the ESP32 and an external part appears here, one per line." />
      )}
    </article>
  );
}
