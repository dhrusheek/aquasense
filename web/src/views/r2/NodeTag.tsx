import { NodeGlyph } from '@/components/viz/NodeGlyph';
import { isNodeId } from '@/components/viz/patterns';
import { cn } from '@/lib/utils';

/** A node id in mono with its identity pattern in front (tone step, never hue). "—" has no swatch. */
export function NodeTag({ id, className }: { id: string; className?: string }) {
  return (
    <span data-slot="node-tag" className={cn('tabular inline-flex items-center gap-1.5 align-middle font-mono', className)}>
      {isNodeId(id) && (
        <span aria-hidden="true" className="inline-flex">
          <NodeGlyph id={id} size={12} />
        </span>
      )}
      <span className={isNodeId(id) ? 'font-medium text-foreground' : 'text-muted-foreground'}>{id}</span>
    </span>
  );
}
