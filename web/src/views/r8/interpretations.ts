// One generated sentence per metric, ported 1:1 from interpretations() (app.js 1308-1331).
// Every sentence falls back to "No data yet." when its inputs are missing.
import { derived, metrics, node } from '@/data/selectors';
import type { Snapshot } from '@/data/store';
import type { AggCum, MinMax } from '@/data/types';
import { fmt, fmtI } from '@/lib/format';
import { arr, get, num, obj } from '@/lib/safe';

export interface Interpretations {
  pdr: string;
  loss: string;
  delay: string;
  thr: string;
  retx: string;
  loc: string;
  red: string;
}

const NO_DATA = 'No data yet.';

export function interpretations(d: Snapshot): Interpretations {
  const m = metrics(d);

  const pdr = obj<Record<string, unknown>>(m.pdr);
  const parts = Object.keys(pdr).sort().map((k) => {
    const n = node(d, k);
    const maxSeq = num(n.max_seq), firstSeq = num(n.first_seq);
    const exp = maxSeq !== null && firstSeq !== null ? maxSeq - firstSeq + 1 : null;
    const lost = num(n.lost);
    return k + ' ' + fmt(pdr[k], 1) + ' %'
      + (exp !== null && lost !== null ? (lost ? ' (' + lost + ' of ' + exp + ' lost)' : ' (lossless, ' + exp + ' packets)') : '');
  });

  const lt = num(m.lost_total), rx = num(m.rx_total);
  const loss = lt !== null && rx !== null
    ? 'Total loss ' + fmt(lt / Math.max(1, lt + rx) * 100, 1) + ' % — ' + lt + ' of ' + (lt + rx) + ' expected packets missing'
      + (lt && arr(derived(d).route_history).length ? '; losses coincide with link failures before the alternate route took over.' : '.')
    : NO_DATA;

  const dl = obj<Record<string, unknown>>(m.delay_ms);
  const delay = Object.keys(dl).length
    ? Object.keys(dl).sort().map((k) => k + ' avg ' + fmtI(get<unknown>(dl[k], 'avg', null)) + ' ms').join(', ')
      + '. N1/N2 include the aggregation hold at N3 (up to one 3 s superframe) and extra hops; N3 is one hop from the sink.'
    : NO_DATA;

  const thr = num(get<unknown>(m, 'throughput_bps.total', null));

  const r = obj<Record<string, unknown>>(m.retransmissions);
  let worst: string | null = null;
  for (const k of Object.keys(r)) {
    if (k !== 'total' && (worst === null || (num(r[k]) || 0) > (num(r[worst]) || 0))) worst = k;
  }

  const le = obj<MinMax>(get<unknown>(m, 'loc_err_cm.N1', null));
  const a = obj<AggCum>(d.data?.aggregation?.cum);
  const redPackets = get<unknown>(m, 'reduction_pct.packets', null), redBytes = get<unknown>(m, 'reduction_pct.bytes', null);

  return {
    pdr: parts.length ? parts.join(' · ') + '.' : NO_DATA,
    loss,
    delay,
    thr: thr !== null
      ? fmtI(thr) + ' bps (' + fmt(thr / 8, 1) + ' B/s) delivered at the sink — the duty-cycled TDMA carries roughly one AGG + one STAT per node per superframe, so throughput is small by design.'
      : NO_DATA,
    retx: num(r.total) !== null
      ? fmtI(r.total) + ' retransmissions in total'
        + (worst && num(r[worst]) ? '; most on ' + worst + ' (' + fmtI(r[worst]) + '), the node whose link was failed/contended.' : '; the channel was clean.')
      : NO_DATA,
    loc: num(le.last) !== null
      ? 'N1 estimated ' + fmt(le.last, 1) + ' cm from its true position (avg ' + fmt(le.avg, 1) + ', range ' + fmt(le.min, 1) + '–' + fmt(le.max, 1) + ' cm) using a weighted centroid of 3 anchors.'
      : NO_DATA,
    red: num(redPackets) !== null
      ? 'N3 sent ' + fmtI(a.out) + ' AGG frames instead of forwarding ' + fmtI(a.in) + ' DATA frames → ' + fmt(redPackets, 1) + ' % fewer packets and ' + fmt(redBytes, 1) + ' % fewer bytes.'
      : NO_DATA,
  };
}
