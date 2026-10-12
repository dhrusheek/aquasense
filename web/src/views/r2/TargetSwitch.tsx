import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { NodeId } from '@/data/types';
import { cn } from '@/lib/utils';

export interface TargetSwitchProps {
  /** Nodes the sink has a localization result for, in report order. */
  targets: NodeId[];
  /** The target drawn on the map. */
  value: NodeId | null;
  onChange: (id: NodeId) => void;
  className?: string;
}

/** "Show N1 … Show N4": picks which node the map locates; the others become its anchors. */
export function TargetSwitch({ targets, value, onChange, className }: TargetSwitchProps) {
  if (!targets.length) return null;
  return (
    <ToggleGroup
      type="single"
      size="lg"
      spacing={2}
      aria-label="Node located on the map"
      value={value ?? ''}
      // A single-select switch always keeps one target on.
      onValueChange={(v) => { if (v) onChange(v as NodeId); }}
      className={cn('max-w-full flex-wrap', className)}
    >
      {targets.map((id) => (
        <ToggleGroupItem
          key={id}
          value={id}
          className="gap-1.5 px-3"
        >
          Show <span className="tabular font-mono">{id}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
