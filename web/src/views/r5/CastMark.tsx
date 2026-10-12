import { ArrowRight, Radio } from 'lucide-react';
import { StatusChip } from '@/components/aq/StatusChip';
import { cn } from '@/lib/utils';
import type { Cast } from './cast';

export interface CastMarkProps {
  cast: Cast;
  /** Glyph only, for places where the word is already written next to it. */
  bare?: boolean;
  className?: string;
}

/**
 * How a frame was sent, told by shape and never by hue: the `radio` glyph is a broadcast to every
 * node, the `arrow-right` glyph a unicast to one MAC. Replaces the legacy accent / info chips.
 */
export function CastMark({ cast, bare = false, className }: CastMarkProps) {
  const Icon = cast === 'broadcast' ? Radio : ArrowRight;
  if (bare) {
    return <Icon aria-hidden="true" data-cast={cast} strokeWidth={2} className={cn('size-[18px] shrink-0 text-foreground', className)} />;
  }
  return (
    <span data-slot="cast-mark" data-cast={cast} className={cn('inline-flex items-center gap-2 align-middle', className)}>
      <Icon aria-hidden="true" strokeWidth={2} className="size-[18px] shrink-0 text-foreground" />
      <StatusChip tone="neutral" size="sm">{cast === 'broadcast' ? 'Broadcast' : 'Unicast'}</StatusChip>
    </span>
  );
}
