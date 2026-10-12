import { useState } from 'react';
import { DataTable, type Column } from '@/components/aq/DataTable';
import { StatusChip } from '@/components/aq/StatusChip';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { NodePattern } from '@/components/viz/NodePattern';
import { isNodeId } from '@/components/viz/patterns';
import { tAgo } from '@/data/selectors';
import type { MacLogRow, Tone } from '@/data/types';
import { NODE_IDS } from '@/lib/constants';
import { EV_LABEL, evClass, type EvClass } from '@/lib/events';
import { fmtI } from '@/lib/format';
import { nId, num } from '@/lib/safe';

/** Rows kept (app.js 1072). */
const MAX_ROWS = 60;

// One ink: only a failure keeps a hue (--bad); everything else is an ink chip.
const EV_TONE: Record<EvClass, Tone> = {
  NEAR_COLLISION: 'bad', ACK_TIMEOUT: 'bad', ACK_OK: 'ok', RETX: 'warn',
  DEFER: 'neutral', CS_BUSY: 'neutral', BACKOFF: 'neutral', TX: 'neutral', OTHER: 'neutral',
};

// Filter chips in the order a frame meets them: sense → backoff → transmit → wait for ACK → retry.
const CLASS_OPTIONS: { value: 'all' | EvClass; label: string }[] = [
  { value: 'all', label: 'All' },
  ...(['CS_BUSY', 'DEFER', 'BACKOFF', 'TX', 'ACK_OK', 'ACK_TIMEOUT', 'RETX', 'NEAR_COLLISION'] as const)
    .map((c) => ({ value: c, label: EV_LABEL[c] })),
  { value: 'OTHER', label: 'Other' },
];
const NODE_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  ...NODE_IDS.map((id) => ({ value: id as string, label: id as string })),
];

function FilterGroup({ name, label, value, onChange, options }: {
  name: string; label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span aria-hidden="true" className="text-[13px] text-muted-foreground">{name}</span>
      <ToggleGroup
        type="single"
        size="sm"
        spacing={1}
        aria-label={label}
        value={value}
        onValueChange={(v) => { if (v) onChange(v); }} // a single-select filter always keeps one chip on
        className="flex-wrap" // nine event classes do not fit one line at 375 px
      >
        {options.map((o) => (
          <ToggleGroupItem key={o.value} value={o.value}>{o.label}</ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

function columns(now: number | null): Column<MacLogRow>[] {
  return [
    { id: 'when', header: 'When', mono: true, width: 'w-32', cell: (e) => tAgo(now, e.t) },
    {
      id: 'node', header: 'Node', mono: true, width: 'w-24',
      cell: (e) => {
        const id = nId(e.node);
        return (
          <span className="inline-flex items-center gap-1.5 font-semibold">
            {isNodeId(id) && <NodePattern id={id} size={10} />}
            {id}
          </span>
        );
      },
    },
    {
      id: 'event', header: 'Event', width: 'w-44',
      cell: (e) => {
        const c = evClass(e.ev);
        return <StatusChip tone={EV_TONE[c]} size="sm">{EV_LABEL[c]}</StatusChip>;
      },
    },
    { id: 'detail', header: 'Detail', cell: (e) => e.ev || '—' },
  ];
}

export interface MacLogProps {
  /** state.mac_log, in any order. */
  log: MacLogRow[];
  /** Network clock in ms, for the "… ago" column. */
  now: number | null;
}

/** The MAC event timeline, newest first, with a node filter and an event-class filter. */
export function MacLog({ log, now }: MacLogProps) {
  const [nodeF, setNodeF] = useState('all');
  const [classF, setClassF] = useState('all');

  const sorted = log.slice().sort((x, y) => (num(y.t) || 0) - (num(x.t) || 0));
  const rows = sorted.filter((e) =>
    (nodeF === 'all' || nId(e.node) === nodeF) && (classF === 'all' || evClass(e.ev) === classF));
  const filtered = nodeF !== 'all' || classF !== 'all';

  return (
    <div data-slot="mac-log" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <FilterGroup name="Node" label="Filter by node" value={nodeF} onChange={setNodeF} options={NODE_OPTIONS} />
        <FilterGroup name="Event" label="Filter by event class" value={classF} onChange={setClassF} options={CLASS_OPTIONS} />
        <span className="tabular ml-auto text-[13px] text-muted-foreground">
          {filtered ? `${fmtI(rows.length)} of ${fmtI(sorted.length)} events` : `${fmtI(sorted.length)} events`}
        </span>
      </div>
      <DataTable
        columns={columns(now)}
        rows={rows}
        rowKey={(e, i) => `${e.t ?? 'x'}-${e.node ?? ''}-${i}`}
        caption="MAC event timeline, newest first"
        empty={sorted.length
          ? 'No MAC events match this filter. Choose “All” in both groups to see every event.'
          : 'No MAC events yet. Channel sensing, backoff, transmit, ACK and retry events appear here as the nodes report them.'}
        maxRows={MAX_ROWS}
        dense
        stickyHeader
        maxHeight={440}
      />
    </div>
  );
}
