import type { ReactNode } from 'react';
import { KeyValue, type KeyValueItem } from '@/components/aq/KeyValue';
import { RoutePath } from '@/components/aq/RoutePath';
import { NodeGlyph } from '@/components/viz/NodeGlyph';
import type { NodeId } from '@/data/types';

export interface RouteCardProps {
  node: NodeId;
  /** Title line: the node's short role ("Sensor · Temp alert"), or "Sink". */
  role: string;
  /** Mono line under the role (the sink's "hops = 0, advertises cost 0"). */
  sub?: string;
  /** Primary / alternate route chip. */
  routeChip?: ReactNode;
  /** The node's current route string, e.g. "1>2>3>4". */
  path?: string | null;
  /** Next hop, hops, cost, alternate, forwarded, out-of-range drops. Left out for the sink, which has no route. */
  kv?: KeyValueItem[];
}

/** One node's current route: identity swatch, role, route chip, the path as hop tokens and its facts. */
export function RouteCard({ node, role, sub, routeChip, path, kv }: RouteCardProps) {
  return (
    <article
      data-slot="route-card"
      data-node={node}
      aria-label={`${node} route`}
      className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card p-4 text-card-foreground sm:p-6"
    >
      <div className="flex items-center gap-3">
        <NodeGlyph id={node} size={28} label="inside" />
        <div className="flex min-w-0 flex-col items-start gap-1">
          <h3 className="text-sm font-semibold text-foreground">{role}</h3>
          {sub && <p className="tabular font-mono text-[13px] text-muted-foreground">{sub}</p>}
          {routeChip}
        </div>
      </div>
      {kv && (
        <>
          <RoutePath path={path ?? null} className="flex-wrap self-start" />
          <KeyValue
            align="right"
            items={kv}
            emptyText={`${node} has not reported a route yet. Its next hop, hop count and cost appear with its first STAT frame.`}
          />
        </>
      )}
    </article>
  );
}
