// Mock mode (?mock, ?mock=<name>.json): load a fixture once, then animate it.
// Port of mockNext (server/static/app.js 1536-1601) with the same jitter rules: net_time stays
// continuous, every third tick is a new superframe (values, seqs, counters, series capped at 120,
// msg/mac logs capped at 60, N1 localization estimate orbiting its true position).
import { mockUrl } from '@/data/api';
import type { State } from '@/data/types';
import { arr, get, nNum, num } from '@/lib/safe';

export interface MockSource {
  /** First call fetches the fixture; later calls return the next animated frame (a deep copy). */
  next(): Promise<State>;
}

// The fixture is mutated in place exactly like the legacy code did, so it is handled untyped here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = any;

const clone = (d: Doc): State => JSON.parse(JSON.stringify(d));

function jit(v: unknown, a: number): Doc {
  const n = num(v);
  return n === null ? v : Math.round((n + (Math.random() - 0.5) * a) * 10) / 10;
}

export function createMockSource(mockFile: string = 'mock_state.json'): MockSource {
  let doc: Doc = null;
  let tick = 0;
  let net0: number | null = null;

  async function load(): Promise<State> {
    const r = await fetch(mockUrl(mockFile), { cache: 'no-store' });
    if (!r.ok) throw new Error('mock_state.json HTTP ' + r.status);
    const d: Doc = await r.json();
    doc = d;
    return clone(d);
  }

  function step(): State {
    const d = doc;
    const k = ++tick;
    if (net0 == null) net0 = num(d.net_time) || 0;
    const age = Math.round((0.2 + Math.random() * 1.1) * 10) / 10;
    d.net_time = Math.round(net0 + k * 1000 - age * 1000); // net_time + age stays continuous
    if (d.derived) d.derived.age_s = age;

    if (k % 3 === 0) {
      d.sf = (num(d.sf) || 0) + 1;
      if (d.schedule) { d.schedule.sf = d.sf; d.schedule.t0 = (num(d.schedule.t0) || 0) + 3000; }

      arr<Doc>(d.nodes).forEach((n) => {
        if (!n || nNum(n.id) === 4) return;
        n.value = Math.round(jit(n.value, ({ 1: 30, 2: 30, 3: 30 } as Record<number, number>)[nNum(n.id) ?? 0] || 4));
        n.seq = (num(n.seq) || 0) + 1; n.max_seq = (num(n.max_seq) || 0) + 1; n.rx_count = (num(n.rx_count) || 0) + 1;
        n.uptime_s = (num(n.uptime_s) || 0) + 3;
        if (n.mac && typeof n.mac === 'object') {
          n.mac.tx = (num(n.mac.tx) || 0) + 2; n.mac.ok = (num(n.mac.ok) || 0) + 2;
          n.mac.bo = (num(n.mac.bo) || 0) + Math.round(Math.random() * 4);
        }
      });

      const ag = d.aggregation;
      if (ag) {
        ag.window = d.sf;
        if (ag.n1) ag.n1.v = get(d, 'nodes.0.value', ag.n1.v);
        if (ag.n2) ag.n2.v = get(d, 'nodes.1.value', ag.n2.v);
        if (ag.n3) ag.n3.v = get(d, 'nodes.2.value', ag.n3.v);
        if (ag.cum) { ag.cum.in += 2; ag.cum.out += 1; ag.cum.bytes_in += 214; ag.cum.bytes_out += 132; }
      }

      const c = d.counters;
      if (c && c.bcast && c.ucast) {
        c.bcast.HELLO += 4; c.bcast.SCHED += 1;
        c.ucast.DATA += 3; c.ucast.AGG += 1; c.ucast.STAT += 4; c.ucast.ACK += 8;
      }

      const ser: Doc = get(d, 'derived.series', null);
      if (ser) {
        Object.keys(ser).forEach((key) => {
          const a = ser[key];
          if (!Array.isArray(a) || !a.length) return;
          const last = a[a.length - 1];
          const nv = key === 't' ? (num(last) || 0) + 3000
            : key === 'retx_total' ? last + (Math.random() < 0.2 ? 1 : 0)
              : /^pdr/.test(key) ? last
                : key === 'loc_err_N1' ? Math.max(0.5, jit(last, 3))
                  : key === 'value_N3' || key === 'value_N1' ? Math.round(jit(last, 20))
                    : jit(last, Math.abs(num(last) || 1) * 0.04);
          a.push(nv);
          if (a.length > 120) a.shift();
        });
        const dv = d.derived.metrics;
        const lastOf = (a: unknown): Doc => (Array.isArray(a) && a.length ? a[a.length - 1] : undefined);
        if (dv) {
          if (dv.retransmissions && lastOf(ser.retx_total) !== undefined) dv.retransmissions.total = lastOf(ser.retx_total);
          if (dv.loc_err_cm?.N1 && lastOf(ser.loc_err_N1) !== undefined) dv.loc_err_cm.N1.last = lastOf(ser.loc_err_N1);
          if (dv.throughput_bps && lastOf(ser.throughput) !== undefined) dv.throughput_bps.total = lastOf(ser.throughput);
        }
        const tgt = arr<Doc>(get(d, 'localization.targets', []))[0];
        if (tgt && dv?.loc_err_cm?.N1) {
          tgt.err_cm = dv.loc_err_cm.N1.last;
          const ang = k / 5;
          tgt.est = [Math.round((50 + Math.cos(ang) * tgt.err_cm) * 10) / 10, Math.round((30 + Math.sin(ang) * tgt.err_cm) * 10) / 10];
        }
      }

      const types = [
        ['DATA', 'unicast', 'N1', 'N2', '1>2'], ['DATA', 'unicast', 'N2', 'N3', '1>2>3'], ['AGG', 'unicast', 'N3', 'N4', '3>4'],
        ['HELLO', 'broadcast', 'N2', '*', ''], ['SCHED', 'broadcast', 'N3', '*', ''],
      ];
      const ty = types[k % types.length];
      if (Array.isArray(d.msg_log)) {
        d.msg_log.unshift({
          t: d.net_time - 200, type: ty[0], cast: ty[1], from: ty[2], to: ty[3], seq: d.sf,
          acked: ty[1] === 'unicast' ? Math.random() > 0.05 : null, path: ty[4],
        });
        if (d.msg_log.length > 60) d.msg_log.length = 60;
      }
      const mevs = ['CS_BUSY', 'BACKOFF ' + Math.floor(Math.random() * 4) + ' slots', 'TX DATA q=' + d.sf, 'ACK_OK', 'DEFER'];
      if (Array.isArray(d.mac_log)) {
        d.mac_log.unshift({ t: d.net_time - 150, node: ['N1', 'N2', 'N3'][k % 3], ev: mevs[k % mevs.length] });
        if (d.mac_log.length > 60) d.mac_log.length = 60;
      }
    }
    return clone(d);
  }

  return {
    // async so that a malformed fixture rejects (the store shows "offline") instead of throwing.
    async next() {
      return doc ? step() : load();
    },
  };
}
