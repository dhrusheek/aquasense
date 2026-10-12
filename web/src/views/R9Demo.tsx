// #r9 — Technical Demonstration & Viva (port of app.js 1381-1414, spec 03 §5).
// Left: the 17-step integrated sequence, ticking as the network shows each behaviour.
// Right: one viva card per rubric item with its key numbers live.
import { Tray } from '@/components/aq/Tray';
import { ViewHeader } from '@/components/aq/ViewHeader';
import { useSnapshot } from '@/data/hooks';
import { demoFlow, lightOf, macCnt, metrics, node, nodes, schedule } from '@/data/selectors';
import type { Snapshot } from '@/data/store';
import type { Counters } from '@/data/types';
import { DEMO_STEPS, LIGHT } from '@/lib/constants';
import { fmt, fmtI, mean, sum } from '@/lib/format';
import { get, obj } from '@/lib/safe';
import { CheatCard, type CheatCardProps } from './r9/CheatCard';
import { DemoSequence } from './r9/DemoSequence';
import { ProgressCells } from './r9/ProgressCells';

/** The eight viva cards (app.js 1400-1409): text and modules are fixed, the live line is computed. */
function cheatCards(s: Snapshot): Omit<CheatCardProps, 'href'>[] {
  const m = metrics(s), d = s.data, sc = schedule(s);
  const act = nodes(s).filter((n) => String(n.status).toLowerCase() === 'active').length;
  const c = obj<Counters>(d?.counters);
  const bcast = obj<Record<string, unknown>>(c.bcast), ucast = obj<Record<string, unknown>>(c.ucast);
  const pdr = obj<Record<string, unknown>>(m.pdr);
  return [
    {
      n: 1, title: 'Architecture',
      live: act + '/4 active · ch ' + String(get<unknown>(d, 'channel', '—')) + ' · light ' + LIGHT[lightOf(s).state].label.split(' · ')[0].toLowerCase(),
      text: 'One sketch, NODE_ID selects role. ESP-NOW for data, BLE for ranging. N1–N4 not allowed → forced multi-hop. Sensors are ESP32 on-chip peripherals: N1 and N3 die temperature (N1 adds an over-temperature alert set from the dashboard by TEMP_WARN), N2 ADC1 + comparator pin for the turbidity module; N4 drives a 3-LED pond status light.',
      code: 'config.h · sensors.h · wsn_node.ino',
    },
    {
      n: 2, title: 'BLE localization',
      live: 'N1 error ' + fmt(get<unknown>(m, 'loc_err_cm.N1.last', null), 1, 'cm'),
      text: 'RSSI → distance by log-distance model (RSSI₁ₘ, n), weighted centroid with w = 1/d².',
      code: 'ble_loc.h · sink.h',
    },
    {
      n: 3, title: 'Wi-Fi MAC',
      live: 'retx ' + fmtI(get<unknown>(m, 'retransmissions.total', null)) + ' · busy ' + fmtI(sum(nodes(s).map((n) => macCnt(n).busy))),
      text: 'CSMA/CA: sense DIFS, random backoff (CW 4→32), ACK in 40 ms, up to 3 retries with BEB.',
      code: 'mac.h',
    },
    {
      n: 4, title: 'TDMA schedule',
      live: 'v' + (sc.ver != null ? sc.ver : '—') + ' · ' + (sc.why || '—'),
      text: '6 × 500 ms slots, N3 broadcasts SCHED in slot 0, unused slots → sleep, re-plan each superframe.',
      code: 'tdma.h',
    },
    {
      n: 5, title: 'Broadcast & unicast',
      live: 'bcast ' + fmtI(sum(Object.keys(bcast).map((k) => bcast[k]))) + ' · ucast ' + fmtI(sum(Object.keys(ucast).map((k) => ucast[k]))),
      text: 'HELLO/SCHED/CTRL to FF:FF:… unACKed; DATA/AGG/STAT to a learned MAC, ACKed hop by hop, duplicates suppressed.',
      code: 'mac.h',
    },
    {
      n: 6, title: 'Aggregation',
      live: fmt(get<unknown>(m, 'reduction_pct.packets', null), 1, '%') + ' fewer packets',
      text: 'N3 fuses the latest N1 enclosure temperature, N2 turbidity ADC and its own die temperature per window into one AGG with count/mean/min/max; the th alert flags (N1 ≥ TEMP_WARN, N2 comparator D) are OR-fused, and the sink turns them into the status light.',
      code: 'aggregation.h · sink.h',
    },
    {
      n: 7, title: 'Adaptive routing',
      live: 'N1 ' + String(node(s, 'N1').route || '—'),
      text: 'cost = hops + loss + RSSI + CH-bypass penalty; LINK_DOWN after 2 failed sends or 9 s without HELLO.',
      code: 'routing.h',
    },
    {
      n: 8, title: 'Performance',
      live: 'PDR ' + fmt(mean(Object.keys(pdr).map((k) => pdr[k])), 1, '%') + ' · ' + fmtI(get<unknown>(m, 'throughput_bps.total', null), 'bps'),
      text: 'All 7 metrics measured at the sink/server; CSV export for the report.',
      code: 'sink.h · server',
    },
  ];
}

export default function R9Demo() {
  const s = useSnapshot();
  const flow = demoFlow(s);
  const steps = DEMO_STEPS.map((st) => ({ ...st, done: flow[st.k] === true }));

  return (
    <>
      <ViewHeader view="r9" />
      <div className="grid grid-cols-12 items-start gap-4">
        <Tray
          title="Integrated demonstration sequence"
          actions={<ProgressCells steps={steps.map((st) => st.done)} className="hidden sm:inline-flex" />}
          className="col-span-12 xl:col-span-8"
        >
          <DemoSequence steps={steps} />
        </Tray>
        <Tray title="Viva cheat-sheet" bare className="col-span-12 xl:col-span-4">
          <div className="flex flex-col gap-2">
            {cheatCards(s).map((card) => <CheatCard key={card.n} {...card} href={`#r${card.n}`} />)}
          </div>
        </Tray>
      </div>
    </>
  );
}
