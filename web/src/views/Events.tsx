// #events — everything the sink has reported (spec 05 §7.1). Left: the events as sentences, with a
// node and a type filter. Right: the same rows exactly as posted. The light, route and schedule
// histories are on their rubric views and are linked, not repeated.
import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { DataTable, type Column } from '@/components/aq/DataTable';
import { EventTimeline, type EventTimelineItem } from '@/components/aq/EventTimeline';
import { StatusChip } from '@/components/aq/StatusChip';
import { Tray } from '@/components/aq/Tray';
import { ViewHeader } from '@/components/aq/ViewHeader';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { NodePattern } from '@/components/viz/NodePattern';
import { isNodeId } from '@/components/viz/patterns';
import { useSnapshot } from '@/data/hooks';
import { netNow, netT, tAgo } from '@/data/selectors';
import type { EventRow } from '@/data/types';
import { eventKey, interpretEvent, newestFirst, type EventKind } from '@/lib/interpret';
import { arr, nId } from '@/lib/safe';

const MAX_LINES = 60;

const NODE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'N1', label: 'N1' },
  { value: 'N2', label: 'N2' },
  { value: 'N3', label: 'N3' },
  { value: 'N4', label: 'N4' },
];

const KIND_OPTIONS: { value: 'all' | EventKind; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'route', label: 'Route' },
  { value: 'tdma', label: 'TDMA' },
  { value: 'light', label: 'Light' },
  { value: 'ctrl', label: 'Control' },
  { value: 'mac', label: 'MAC' },
  { value: 'node', label: 'Node' },
];

const CHIP = 'font-sans text-[13px]';
const LINK = 'inline-flex items-center gap-1 font-sans text-[13px] whitespace-nowrap text-foreground underline underline-offset-4 transition-colors duration-150 hover:bg-[var(--ink-4)]';

function Filter({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      spacing={1}
      aria-label={label}
      value={value}
      onValueChange={(v) => { if (v) onChange(v); }} // a single-select filter always keeps one chip on
      className="flex-wrap"
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} className={CHIP}>{o.label}</ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

const RAW_COLUMNS: Column<EventRow>[] = [
  { id: 't', header: 't', mono: true, width: 'w-24', cell: (e) => <span className="whitespace-nowrap">{netT(e.t)}</span> },
  {
    id: 'node', header: 'Node', mono: true, width: 'w-14',
    cell: (e) => {
      const id = nId(e.node);
      return isNodeId(id) ? <NodePattern id={id} size={10} label /> : id;
    },
  },
  { id: 'type', header: 'Type', width: 'w-20', cell: (e) => <StatusChip tone="neutral" size="sm">{e.type || '—'}</StatusChip> },
  { id: 'msg', header: 'Message', cell: (e) => <span className="block min-w-36 whitespace-normal">{e.msg || '—'}</span> },
];

const HISTORY_LINKS = [
  { href: '#r1', label: 'Light history' },
  { href: '#r7', label: 'Route history' },
  { href: '#r4', label: 'Schedule history' },
];

export default function Events() {
  const s = useSnapshot();
  const now = netNow(s);
  const [nodeFilter, setNodeFilter] = useState('all');
  const [kindFilter, setKindFilter] = useState('all');

  const rows = newestFirst(arr<EventRow>(s.data?.events));

  const items: EventTimelineItem[] = [];
  rows.forEach((e, i) => {
    const said = interpretEvent(e);
    if (nodeFilter !== 'all' && nId(e.node) !== nodeFilter) return;
    if (kindFilter !== 'all' && said.kind !== kindFilter) return;
    items.push({
      key: `${eventKey(e)}|${i}`,
      t: e.t,
      timeLabel: `${netT(e.t)} · ${tAgo(now, e.t)}`,
      tone: said.tone,
      title: said.text,
    });
  });
  const filtered = nodeFilter !== 'all' || kindFilter !== 'all';

  return (
    <>
      <ViewHeader view="events" />
      {/* A size container: the two trays sit side by side from 896 px of room, whatever the sidebar does. */}
      <div className="@container flex flex-col gap-6">
        <div className="grid grid-cols-12 gap-4">
          <Tray title="Live events" className="col-span-12 @4xl:col-span-7">
            <div className="flex flex-col gap-4">
              <div data-slot="event-filters" className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Filter label="Filter by node" value={nodeFilter} onChange={setNodeFilter} options={NODE_OPTIONS} />
                <Filter label="Filter by type" value={kindFilter} onChange={setKindFilter} options={KIND_OPTIONS} />
              </div>
              <EventTimeline
                items={items}
                max={MAX_LINES}
                label="Events, newest first"
                emptyText={rows.length && filtered
                  ? 'No event matches this filter. Choose All to see every event.'
                  : 'Events appear here as the sink reports them.'}
              />
            </div>
          </Tray>

          <Tray title="Raw events" className="col-span-12 @4xl:col-span-5">
            <DataTable
              columns={RAW_COLUMNS}
              rows={rows}
              rowKey={(e, i) => `${eventKey(e)}|${i}`}
              caption="Raw events as posted by the sink"
              empty="Raw events appear here as the sink posts them."
              search={{ placeholder: 'Search messages', keys: ['msg'] }}
              stickyHeader
              maxHeight={560}
              dense
            />
          </Tray>
        </div>

        <nav aria-label="Histories on other pages" className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {HISTORY_LINKS.map((l) => (
            <a key={l.href} href={l.href} className={LINK}>
              {l.label}
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </a>
          ))}
        </nav>
      </div>
    </>
  );
}
