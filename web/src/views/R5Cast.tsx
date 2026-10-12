// #r5: Broadcast & Unicast Communication (port of V.r5, app.js 1131-1169; spec 03 §1).
// Row 1: the broadcast and unicast frame counters beside the message mix.
// Row 2: the live message feed with its All / Broadcast / Unicast filter.
// Cast is told apart by glyph (radio / arrow-right) and fill (outline / solid), never by hue.
import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { DataTable, type Column } from '@/components/aq/DataTable';
import { RoutePath } from '@/components/aq/RoutePath';
import { StatTile } from '@/components/aq/StatTile';
import { StatusChip } from '@/components/aq/StatusChip';
import { Tray } from '@/components/aq/Tray';
import { ViewHeader } from '@/components/aq/ViewHeader';
import { useSnapshot } from '@/data/hooks';
import { netNow, tAgo } from '@/data/selectors';
import type { Counters, MsgLogRow, Num } from '@/data/types';
import { fmtI } from '@/lib/format';
import { arr, nId, nNum, num, obj } from '@/lib/safe';
import { cn } from '@/lib/utils';
import { BCAST_TYPES, UCAST_TYPES, castKey, castOf, type FeedFilter, type FrameType } from './r5/cast';
import { CastFilter } from './r5/CastFilter';
import { CastMark } from './r5/CastMark';
import { MessageMix } from './r5/MessageMix';

/* ---------- row 1: counters ---------- */

/** One tile per frame type: 2-up on a phone, one row once the tray is wide enough (`wide`). */
function TypeTiles({ types, counts, wide }: { types: FrameType[]; counts: Record<string, Num>; wide: string }) {
  return (
    <div className="@container h-full">
      <div className={cn('grid h-full grid-cols-2 gap-4', wide)}>
        {types.map((t) => (
          <StatTile
            key={t.k}
            label={t.k}
            value={num(counts[t.k])}
            decimals={0}
            // an element, so the description wraps instead of being cut
            sub={<span className="block">{t.desc}</span>}
          />
        ))}
      </div>
    </div>
  );
}

/* ---------- row 2: feed ---------- */

function AckCell({ m }: { m: MsgLogRow }) {
  if (m.acked === true) {
    return (
      <StatusChip tone="ok" size="sm">
        <Check aria-hidden="true" strokeWidth={3} className="size-3" />
        ACK
      </StatusChip>
    );
  }
  if (m.acked === false) {
    return (
      <StatusChip tone="bad" size="sm">
        <X aria-hidden="true" strokeWidth={3} className="size-3" />
        No ACK
      </StatusChip>
    );
  }
  return <span className="text-[13px] text-muted-foreground">{castOf(m.cast) === 'broadcast' ? 'not ACKed' : '—'}</span>;
}

/** Destination text: a broadcast, `*` or node 0 reads "all nodes" (app.js 1164). */
function destination(m: MsgLogRow): string {
  return castOf(m.cast) === 'broadcast' || m.to === '*' || nNum(m.to) === 0 ? 'all nodes' : nId(m.to);
}

function feedColumns(now: number | null): Column<MsgLogRow>[] {
  return [
    { id: 'when', header: 'When', mono: true, cell: (m) => <span>{tAgo(now, m.t)}</span> },
    { id: 'type', header: 'Type', cell: (m) => <b className="font-semibold">{m.type || '—'}</b> },
    { id: 'cast', header: 'Cast', cell: (m) => <CastMark cast={castOf(m.cast)} /> },
    { id: 'route', header: 'From → To', mono: true, cell: (m) => `${nId(m.from)} → ${destination(m)}` },
    { id: 'seq', header: 'Seq', mono: true, align: 'right', cell: (m) => fmtI(m.seq) },
    { id: 'ack', header: 'ACK', cell: (m) => <AckCell m={m} /> },
    { id: 'path', header: 'Path', cell: (m) => <RoutePath path={m.path || null} /> },
  ];
}

const FEED_EMPTY: Record<FeedFilter, string> = {
  all: 'No messages yet. Every frame the sink sees is listed here, newest first, with its destination and ACK status.',
  broadcast: 'No broadcast messages yet. HELLO, SCHED and CTRL frames are listed here as the sink hears them.',
  unicast: 'No unicast messages yet. DATA, AGG and STAT frames are listed here with their destination and ACK status.',
};

/* ---------- view ---------- */

export default function R5Cast() {
  const s = useSnapshot();
  const now = netNow(s);
  const [filter, setFilter] = useState<FeedFilter>('all');

  const counters = obj<Counters>(s.data?.counters);
  const bcast = obj<Record<string, Num>>(counters.bcast), ucast = obj<Record<string, Num>>(counters.ucast);

  // Newest first; reliability is counted over the whole feed, not the filtered rows.
  const msgs = arr<MsgLogRow>(s.data?.msg_log)
    .map((m) => obj<MsgLogRow>(m))
    .sort((x, y) => (num(y.t) || 0) - (num(x.t) || 0));
  const acked = msgs.filter((m) => m.acked === true).length;
  const ackable = msgs.filter((m) => m.acked === true || m.acked === false).length;
  const rows = msgs.filter((m) => filter === 'all' || castKey(m.cast) === filter);

  return (
    <>
      <ViewHeader view="r5" />
      <div className="flex flex-col gap-10">
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 flex min-w-0 flex-col gap-4 xl:col-span-8">
            <Tray
              title="Broadcast"
              meta="to FF:FF:FF:FF:FF:FF · not ACKed"
              actions={<CastMark cast="broadcast" bare />}
              bare
              className="xl:flex-1"
            >
              <TypeTiles types={BCAST_TYPES} counts={bcast} wide="@[420px]:grid-cols-3" />
            </Tray>
            <Tray
              title="Unicast"
              meta="to one MAC · hop-by-hop ACK"
              actions={<CastMark cast="unicast" bare />}
              bare
              className="xl:flex-1"
            >
              <TypeTiles types={UCAST_TYPES} counts={ucast} wide="@[560px]:grid-cols-4" />
            </Tray>
          </div>

          <Tray title="Message mix" className="col-span-12 xl:col-span-4">
            <MessageMix bcast={bcast} ucast={ucast} acked={acked} ackable={ackable} />
          </Tray>
        </div>

        <Tray
          title="Live message feed"
          meta={filter === 'all' ? `${fmtI(msgs.length)} frames` : `${fmtI(rows.length)} of ${fmtI(msgs.length)} frames`}
          actions={<CastFilter value={filter} onChange={setFilter} />}
        >
          <DataTable
            columns={feedColumns(now)}
            rows={rows}
            rowKey={(m, i) => `${m.t ?? 'x'}-${m.type ?? ''}-${m.from ?? ''}-${m.seq ?? ''}-${i}`}
            caption="Messages seen by the sink, newest first: type, cast, source and destination, sequence number, ACK status and path"
            empty={FEED_EMPTY[filter]}
            maxRows={60}
            maxHeight={440}
            stickyHeader
          />
        </Tray>
      </div>
    </>
  );
}
