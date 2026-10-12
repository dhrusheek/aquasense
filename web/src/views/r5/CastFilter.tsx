import { ArrowRight, Radio } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { FeedFilter } from './cast';

export interface CastFilterProps {
  value: FeedFilter;
  onChange: (v: FeedFilter) => void;
}

const OPTIONS: { value: FeedFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'broadcast', label: 'Broadcast' },
  { value: 'unicast', label: 'Unicast' },
];

function isFilter(v: string): v is FeedFilter {
  return v === 'all' || v === 'broadcast' || v === 'unicast';
}

/**
 * The feed filter of the legacy page (three buttons, the active one raised): All / Broadcast / Unicast.
 * Same chip styling as the DataTable filter, placed in the tray's title row.
 */
export function CastFilter({ value, onChange }: CastFilterProps) {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      spacing={1}
      aria-label="Filter messages"
      value={value}
      onValueChange={(v) => { if (isFilter(v)) onChange(v); }} // a single-select filter always keeps one chip on
    >
      {OPTIONS.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
        >
          {o.value === 'broadcast' && <Radio aria-hidden="true" strokeWidth={2} />}
          {o.value === 'unicast' && <ArrowRight aria-hidden="true" strokeWidth={2} />}
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
