import { Fragment } from 'react';
import { cn } from '@/lib/utils';

export interface RoutePathProps {
  /** A route string such as "1>2>3>4"; null or '' renders "—". */
  path: string | null;
  className?: string;
}

/** A 6 px dot in the hop's node tone step, leading the token (same step as the node on the map). */
const HOP_RULE: Record<string, string> = {
  '1': 'before:bg-n1',
  '2': 'before:bg-n2',
  '3': 'before:bg-n3',
  '4': 'before:bg-n4',
};
/** The detour hop: a faint ink fill behind the text. */
const DETOUR_WASH = 'bg-ink-4';

/**
 * A route as hop tokens joined by a short rule. Each token leads with a dot in its node's tone step, the same
 * step the hop has on the map. A token for node 2 that sits strictly inside the path is the detour
 * hop (the alternate route through the relay) and also gets a faint ink fill.
 * Port of pathHTML (app.js 155-162).
 */
export function RoutePath({ path, className }: RoutePathProps) {
  if (path == null || path === '') {
    return <span data-slot="route-path" className={cn('text-muted-foreground', className)}>—</span>;
  }
  const hops = String(path).split('>').map((h) => h.trim()).filter(Boolean);
  const text = hops.map((h) => 'N' + h).join(' → ');
  return (
    <span
      data-slot="route-path"
      role="img"
      aria-label={`Route ${text}`}
      // No wrapping by default (a route is at most four hops), so a table column never stacks the hops.
      className={cn('tabular inline-flex items-center gap-0.5 align-middle font-mono text-[13px] whitespace-nowrap', className)}
    >
      {hops.map((h, i) => {
        const detour = h === '2' && i > 0 && i < hops.length - 1;
        return (
          <Fragment key={i}>
            {i > 0 && <span aria-hidden="true" className="h-px w-1.5 shrink-0 bg-ink-3" />}
            <span
              aria-hidden="true"
              data-hop={h}
              data-detour={detour || undefined}
              title={detour ? 'Detour through the relay N2' : undefined}
              className={cn(
                "inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-ink-3 px-2 text-foreground before:size-1.5 before:shrink-0 before:rounded-full before:content-['']",
                HOP_RULE[h],
                detour && ['font-semibold', DETOUR_WASH],
              )}
            >
              N{h}
            </span>
          </Fragment>
        );
      })}
    </span>
  );
}
