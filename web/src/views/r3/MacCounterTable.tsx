import type { ReactNode } from 'react';
import { DataTable, type Column } from '@/components/aq/DataTable';
import { NodePattern } from '@/components/viz/NodePattern';
import { macCnt, node, nodes, type Src } from '@/data/selectors';
import type { MacCounters, NodeId } from '@/data/types';
import { NODE_IDS, SHORT_ROLE } from '@/lib/constants';
import { fmt, fmtI } from '@/lib/format';
import { num } from '@/lib/safe';

interface CounterRow {
  id: string;
  label: string;
  /** Mono note beside the label: how a derived row is computed. */
  note?: string;
  value: (c: MacCounters) => string;
}

/** ACKs received per frame put on air (first tries + retries), in %; null before the first frame. */
function ackSuccessPct(c: MacCounters): number | null {
  const att = (num(c.tx) || 0) + (num(c.retx) || 0);
  return att ? (num(c.ok) || 0) / att * 100 : null;
}

// The eight counters of each node's STAT frame (app.js 1048-1055) and the ACK success derived from them.
const ROWS: CounterRow[] = [
  { id: 'tx', label: 'Frames sent (1st try)', value: (c) => fmtI(c.tx) },
  { id: 'retx', label: 'Retransmissions', value: (c) => fmtI(c.retx) },
  { id: 'ok', label: 'ACKs received', value: (c) => fmtI(c.ok) },
  { id: 'to', label: 'ACK timeouts', value: (c) => fmtI(c.to) },
  { id: 'busy', label: 'Channel busy', value: (c) => fmtI(c.busy) },
  { id: 'bo', label: 'Backoff total', value: (c) => fmtI(c.bo, 'ms') },
  { id: 'def', label: 'Deferrals', value: (c) => fmtI(c.def) },
  { id: 'col', label: 'Near-collisions seen', value: (c) => fmtI(c.col) },
  { id: 'ack', label: 'ACK success', note: 'ACKs ÷ (frames + retransmissions)', value: (c) => fmt(ackSuccessPct(c), 1, '%') },
];

/** MAC counters transposed: one row per counter, one column per node. */
export function MacCounterTable({ src }: { src: Src }) {
  const counters = {} as Record<NodeId, MacCounters>;
  NODE_IDS.forEach((id) => { counters[id] = macCnt(node(src, id)); });

  const columns: Column<CounterRow>[] = [
    {
      id: 'counter', header: 'Counter', width: 'w-80',
      cell: (r): ReactNode => (
        <span className="inline-flex flex-wrap items-baseline gap-x-2">
          <span className="text-foreground">{r.label}</span>
          {r.note && <span className="text-[13px] text-muted-foreground">{r.note}</span>}
        </span>
      ),
    },
    ...NODE_IDS.map((id): Column<CounterRow> => ({
      id,
      header: <NodePattern id={id} size={12} label />,
      mono: true,
      align: 'right',
      cell: (r) => r.value(counters[id]),
    })),
  ];

  return (
    <DataTable
      columns={columns}
      // No node has reported yet: say so once instead of printing 36 dashes.
      rows={nodes(src).length ? ROWS : []}
      rowKey={(r) => r.id}
      caption="MAC counters per node: one row per counter, one column per node"
      empty="No MAC counters yet. Each node reports its counters in its STAT frame; they appear here once the sink has uplinked them."
      footer={(
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {NODE_IDS.map((id) => (
            <li key={id} className="inline-flex items-center gap-1.5">
              <NodePattern id={id} size={10} label />
              {SHORT_ROLE[id]}
            </li>
          ))}
        </ul>
      )}
    />
  );
}
