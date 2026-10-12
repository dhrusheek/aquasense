// #r4 — Dynamic Schedule-Based Communication (port of app.js 547-563 + 1080-1128, spec 02 §4).
// Row 1: the live superframe (slot strip, cursor, facts) beside the commands that change the schedule.
// Row 2: sleep / wake per node beside the schedule version history.
import { useState } from 'react';
import { CommandButton } from '@/components/aq/CommandButton';
import { DataTable, type Column } from '@/components/aq/DataTable';
import { KeyValue } from '@/components/aq/KeyValue';
import { StatusChip } from '@/components/aq/StatusChip';
import { Tray } from '@/components/aq/Tray';
import { ViewHeader } from '@/components/aq/ViewHeader';
import { SlotStrip } from '@/components/viz/SlotStrip';
import { useSnapshot } from '@/data/hooks';
import { currentSlot, derived, isOnline, netNow, netT, node, nodes, schedule, slotInfo, slots, whenStr } from '@/data/selectors';
import type { ScheduleHist, Tdma } from '@/data/types';
import { DEFAULT_SLOTS, NODE_IDS } from '@/lib/constants';
import { fmtI } from '@/lib/format';
import { arr, get, nId, num, obj } from '@/lib/safe';
import { DutyBars, type DutyRow } from './r4/DutyBars';

function historyColumns(now: number | null): Column<ScheduleHist>[] {
  return [
    {
      id: 'ver', header: 'Version', width: 'w-20',
      cell: (h, i) => (
        <StatusChip tone="neutral" variant={i === 0 ? 'inverse' : 'soft'} size="sm" mono>
          v{h.ver != null ? h.ver : '?'}
        </StatusChip>
      ),
    },
    { id: 'why', header: 'Why it changed', cell: (h) => h.why || '—' },
    { id: 'net', header: 'Network time', mono: true, cell: (h) => netT(h.t) },
    { id: 'received', header: 'Received', mono: true, cell: (h) => whenStr(now, h) },
  ];
}

export default function R4Schedule() {
  const s = useSnapshot();
  const now = netNow(s);
  const sc = schedule(s);
  const sl = num(sc.slot_ms) || 500;

  // Owner per slot as announced; the legacy fallback when the schedule has none (app.js 1097-1098).
  const announced = arr<unknown>(sc.slots);
  const rawSlots: unknown[] = announced.length ? announced : DEFAULT_SLOTS;
  const n = rawSlots.length;

  // The strip reports the slot under its cursor as it sweeps; while it has no cursor (offline) the
  // slot is worked out from the network clock, as the legacy page did.
  const [cursorIdx, setCursorIdx] = useState<number | null>(null);
  const idx = cursorIdx !== null && cursorIdx < n ? cursorIdx : currentSlot(s)?.idx ?? null;

  const master = num(sc.master);
  const duty: DutyRow[] = !nodes(s).length ? [] : NODE_IDS.map((id) => {
    const t = obj<Tdma>(node(s, id).tdma);
    const awake = num(t.awake_ms), sleep = num(t.sleep_ms);
    let d = num(t.duty);
    if (d === null && awake !== null && sleep !== null) d = awake / Math.max(1, awake + sleep) * 100;
    return { node: id, duty: d, awakeMs: t.awake_ms, sleepMs: t.sleep_ms };
  });

  let hist = arr<ScheduleHist>(derived(s).schedule_history);
  if (!hist.length) hist = arr<ScheduleHist>(sc.history);
  hist = hist.slice().sort((a, b) => (num(b.ver) || 0) - (num(a.ver) || 0));

  return (
    <>
      <ViewHeader view="r4" />
      <div className="grid grid-cols-12 gap-4">
        <Tray
          title="Superframe"
          actions={<StatusChip tone="neutral">Version {sc.ver != null ? sc.ver : '—'}</StatusChip>}
          className="col-span-12 xl:col-span-8"
        >
          <div className="flex flex-col gap-5">
            <SlotStrip
              variant="full"
              slots={slots(s)}
              master={master}
              slotMs={sl}
              t0={num(sc.t0)}
              now={now}
              stale={!isOnline(s)}
              onCurrentSlot={setCursorIdx}
            />
            <KeyValue
              className="border-t border-border pt-4"
              items={[
                { k: 'Current reason', v: sc.why || '—' },
                {
                  k: 'Scheduler / time master',
                  v: (
                    <>
                      <span className="tabular font-mono">{nId(sc.master || get<unknown>(s.data, 'sched_master', null))}</span>
                      {master === 4 ? ' (backup — N3 not heard)' : ''}
                    </>
                  ),
                },
                {
                  k: 'Superframe',
                  v: `#${String(get<unknown>(sc, 'sf', get<unknown>(s.data, 'sf', '—')))} · ${n} × ${fmtI(sl)} ms = ${fmtI(n * sl)} ms`,
                  mono: true,
                },
                {
                  k: 'Current slot',
                  v: idx !== null ? `${idx} (${slotInfo(idx, rawSlots, sc.master).owner})` : '—',
                  mono: true,
                },
                { k: 'Unused slots', v: String(rawSlots.filter((o) => num(o) === 255).length), mono: true },
              ]}
            />
          </div>
        </Tray>

        <Tray title="Schedule controls" className="col-span-12 xl:col-span-4">
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap gap-2">
              <CommandButton label="Request schedule update" command={{ c: 'SCHED_UPDATE' }} variant="default" cooldownMs={3000} />
            </div>
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-foreground">Node leaves / joins (unused-slot handling)</h3>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                  <CommandButton label="Kill N1 (30 s)" command={{ c: 'NODE_KILL', a: 1, dur: 30 }} variant="destructive" cooldownMs={3000} />
                  <CommandButton label="Wake N1" command={{ c: 'NODE_WAKE', a: 1 }} cooldownMs={3000} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <CommandButton label="Kill N2 (30 s)" command={{ c: 'NODE_KILL', a: 2, dur: 30 }} variant="destructive" cooldownMs={3000} />
                  <CommandButton label="Wake N2" command={{ c: 'NODE_WAKE', a: 2 }} cooldownMs={3000} />
                </div>
              </div>
            </div>
            <p className="max-w-[72ch] text-[13px] text-muted-foreground">
              Rules: a member silent for 3 superframes loses its slot (→ UNUSED, everyone sleeps); it regains it when heard
              again; an extra retransmission slot is granted when ACK timeouts exceed 20 %.
            </p>
          </div>
        </Tray>

        <Tray
          title="Sleep / wake"
          description="Awake in beacon, own, control and children's slots; asleep otherwise."
          className="col-span-12 xl:col-span-6"
        >
          <DutyBars rows={duty} />
        </Tray>

        <Tray title="Version history" className="col-span-12 xl:col-span-6">
          <DataTable
            columns={historyColumns(now)}
            rows={hist}
            rowKey={(h, i) => `${h.ver ?? 'x'}-${h.t ?? ''}-${i}`}
            caption="Schedule version history, newest first"
            empty="No schedule history yet. Each schedule version the scheduler announces is listed here with the reason for the change."
            rowEmphasis={(_, i) => i === 0}
            stickyHeader
            maxHeight={320}
          />
        </Tray>
      </div>
    </>
  );
}
