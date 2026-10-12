import { useId, useMemo, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui';
import './aq-motion.css';
import { EmptyState } from '@/components/aq/EmptyState';
import { Input } from '@/components/ui/input';
import { ScrollBar } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useControllable } from '@/lib/useControllable';
import { cn } from '@/lib/utils';

export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T, i: number) => ReactNode;
  /** Mono tabular cells (numbers, ids, addresses, timestamps). */
  mono?: boolean;
  align?: 'left' | 'right' | 'center';
  /** A Tailwind width class for the column, e.g. `w-24` or `w-[120px]` (no inline styles). */
  width?: string;
  /** Hide the header text visually (it stays in the accessibility tree). */
  srOnly?: boolean;
}

/**
 * One group of filter chips. Give `value` + `onChange` to own the value (and filter `rows` yourself),
 * or leave `value` out and pass `predicate` to let the table keep the value and filter.
 */
export interface DataTableFilter<T> {
  value?: string;
  defaultValue?: string;
  onChange?: (v: string) => void;
  options: { value: string; label: string }[];
  /** Accessible name of the chip group, e.g. "Filter by cast". */
  label?: string;
  /** Row test for the selected value; without it the table does not filter rows itself. */
  predicate?: (row: T, value: string) => boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, i: number) => string;
  /** Visually hidden <caption>: what the table lists. Required. */
  caption: string;
  /** Sentence shown when there are no rows; say what will fill the table. */
  empty: string;
  /** Text box above the table; case-insensitive substring match on the given keys. */
  search?: { placeholder: string; keys: (keyof T)[] };
  /** One group of filter chips, or several. */
  filter?: DataTableFilter<T> | DataTableFilter<T>[];
  /** Show at most this many rows (newest first is the caller's job) and a "+N more" line. */
  maxRows?: number;
  /** 32 px rows instead of 36 px. */
  /** Kept for call sites; every row is 44 px now. */
  dense?: boolean;
  /** Keep the header visible while the body scrolls; needs `maxHeight`. */
  stickyHeader?: boolean;
  /** Height in px of the scroll area (rounded to the nearest 40 px step between 160 and 720). */
  maxHeight?: number;
  /** A line under the table (a legend, "last 30", a formula note). */
  footer?: ReactNode;
  /** Rows that get a 2 px ink left border (the chosen route, the current version). */
  rowEmphasis?: (row: T, i: number) => boolean;
  className?: string;
}

// Static classes so Tailwind can see them; `maxHeight` picks the nearest step.
const MAX_H: [number, string][] = [
  [160, 'max-h-[160px]'], [200, 'max-h-[200px]'], [240, 'max-h-[240px]'], [280, 'max-h-[280px]'],
  [320, 'max-h-[320px]'], [360, 'max-h-[360px]'], [400, 'max-h-[400px]'], [440, 'max-h-[440px]'],
  [480, 'max-h-[480px]'], [520, 'max-h-[520px]'], [560, 'max-h-[560px]'], [600, 'max-h-[600px]'],
  [640, 'max-h-[640px]'], [680, 'max-h-[680px]'], [720, 'max-h-[720px]'],
];
function maxHClass(px: number): string {
  let best = MAX_H[0];
  for (const step of MAX_H) if (Math.abs(step[0] - px) < Math.abs(best[0] - px)) best = step;
  return best[1];
}

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

function FilterChips<T>({ group, onValue }: { group: DataTableFilter<T>; onValue: (v: string) => void }) {
  const [value, setValue] = useControllable<string>({
    prop: group.value,
    defaultProp: group.defaultValue ?? group.options[0]?.value ?? '',
    onChange: (v) => { group.onChange?.(v); onValue(v); },
  });
  return (
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      spacing={1}
      aria-label={group.label ?? 'Filter rows'}
      value={value}
      onValueChange={(v) => { if (v) setValue(v); }} // a single-select filter always keeps one chip on
    >
      {group.options.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          className="text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** The one table of the dashboard: caption, search, filter chips, sticky scroll, empty state. */
export function DataTable<T>({
  columns, rows, rowKey, caption, empty, search, filter, maxRows,
  stickyHeader = false, maxHeight, footer, rowEmphasis, className,
}: DataTableProps<T>) {
  const searchId = useId();
  const [query, setQuery] = useState('');
  const groups = useMemo(() => (filter ? (Array.isArray(filter) ? filter : [filter]) : []), [filter]);
  // Mirror of the uncontrolled chip values, so `predicate` filters can run here.
  const [picked, setPicked] = useState<Record<number, string>>({});

  let visible = rows;
  groups.forEach((g, gi) => {
    if (!g.predicate) return;
    const v = g.value ?? picked[gi] ?? g.defaultValue ?? g.options[0]?.value ?? '';
    visible = visible.filter((row) => g.predicate!(row, v));
  });
  const q = query.trim().toLowerCase();
  if (search && q) {
    visible = visible.filter((row) => search.keys.some((k) => String(row[k] ?? '').toLowerCase().includes(q)));
  }
  const narrowed = visible.length !== rows.length;
  const hidden = maxRows != null && visible.length > maxRows ? visible.length - maxRows : 0;
  const shown = hidden ? visible.slice(0, maxRows) : visible;

  const head = (
    <TableHeader className={cn('bg-card', stickyHeader && 'sticky top-0 z-[1]')}>
      <TableRow className="hover:bg-transparent">
        {columns.map((c) => (
          <TableHead
            key={c.id}
            scope="col"
            className={cn('bg-card', ALIGN[c.align ?? 'left'], c.width)}
          >
            {c.srOnly ? <span className="sr-only">{c.header}</span> : c.header}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );

  const body = (
    <TableBody>
      {shown.length === 0 ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={columns.length} className="p-4 whitespace-normal">
            <EmptyState
              compact
              title={rows.length && narrowed ? 'No matching rows' : undefined}
              description={rows.length && narrowed ? 'Nothing matches the current search or filter. Clear it to see every row.' : empty}
            />
          </TableCell>
        </TableRow>
      ) : shown.map((row, i) => (
        <TableRow
          key={rowKey(row, i)}
          data-row=""
          data-emphasis={rowEmphasis?.(row, i) || undefined}
          className={cn(
            'transition-colors duration-150',
            'h-11',
            // 2 px ink bar on the leading edge; an inset shadow, because row borders collapse.
            rowEmphasis?.(row, i) && '[&>td:first-child]:shadow-[inset_2px_0_0_0_var(--foreground)]',
          )}
        >
          {columns.map((c) => (
            <TableCell
              key={c.id}
              className={cn(c.mono && 'font-mono text-[13px]', ALIGN[c.align ?? 'left'], c.width)}
            >
              {c.cell(row, i)}
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  );

  const captionEl = <caption className="sr-only">{caption}</caption>;
  const scroll = stickyHeader || maxHeight != null;

  return (
    <div data-slot="data-table" className={cn('flex min-w-0 flex-col gap-4', className)}>
      {(search || groups.length > 0) && (
        <div data-slot="data-table-toolbar" className="flex flex-wrap items-center gap-2">
          {search && (
            <div className="relative min-w-0 flex-1 basis-56">
              <label htmlFor={searchId} className="sr-only">{search.placeholder}</label>
              <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id={searchId}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={search.placeholder}
                className="pl-10"
              />
            </div>
          )}
          {groups.map((g, gi) => (
            <FilterChips key={gi} group={g} onValue={(v) => setPicked((p) => (p[gi] === v ? p : { ...p, [gi]: v }))} />
          ))}
        </div>
      )}

      {scroll ? (
        // One scroll container for both axes, so the sticky header and wide tables work together.
        <ScrollAreaPrimitive.Root data-slot="scroll-area" className="relative min-w-0 overflow-hidden">
          <ScrollAreaPrimitive.Viewport
            data-slot="scroll-area-viewport"
            tabIndex={0}
            className={cn('size-full rounded-[inherit]', maxHClass(maxHeight ?? 440))}
          >
            <table data-slot="table" className="w-full caption-bottom text-sm">
              {captionEl}{head}{body}
            </table>
          </ScrollAreaPrimitive.Viewport>
          <ScrollBar />
          <ScrollBar orientation="horizontal" />
          <ScrollAreaPrimitive.Corner />
        </ScrollAreaPrimitive.Root>
      ) : (
        // shadcn Table brings its own overflow-x-auto wrapper: wide tables scroll inside their tray.
        <div className="min-w-0 overflow-hidden">
          <Table>{captionEl}{head}{body}</Table>
        </div>
      )}

      {(hidden > 0 || footer != null) && (
        <div data-slot="data-table-footer" className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 text-[13px] text-muted-foreground">
          {footer != null ? <div className="min-w-0">{footer}</div> : <span />}
          {hidden > 0 && <span className="tabular font-mono text-xs">+{hidden} more</span>}
        </div>
      )}
    </div>
  );
}
