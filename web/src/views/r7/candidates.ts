// Route-cost breakdown per candidate next hop, ported 1:1 from candidates() (app.js 1221-1239).
// Recomputed from the reported link statistics with the firmware's metric:
//   cost = 10·(hops+1) + (100 − ACK%)/5 + max(0, −70 − RSSI)/2 + 20 if a member bypasses the cluster head.
import { link, linkState, node, type Src } from '@/data/selectors';
import type { Link } from '@/data/types';
import { ALLOWED } from '@/lib/constants';
import { fmt, fmtI } from '@/lib/format';
import { nNum, num, obj } from '@/lib/safe';

export interface Candidate {
  /** Neighbour node number. */
  nb: number;
  st: 'up' | 'down' | 'unknown';
  /** Hops from the neighbour to the sink (0 for the sink itself). */
  h: number | null;
  ack: number | null;
  rssi: number | null;
  /** The neighbour itself routes through this node, so it cannot be a next hop. */
  loop: boolean;
  /** Null when the candidate is excluded (link not up, no route, or a loop). */
  cost: number | null;
  /** The four cost terms as text: "30 + 0.8 + 0.0 + 0". */
  parts: string;
}

/** The neighbour table of node `id` (N1, N2 or N3) with the cost of each candidate. */
export function candidates(d: Src, id: string | number): Candidate[] {
  const k = nNum(id), out: Candidate[] = [];
  if (k === null) return out;
  const chUp = k !== 3 && linkState(d, k, 3) === 'up';
  ((ALLOWED as Record<number, number[]>)[k] || []).forEach((nb) => {
    const l = obj<Link>(link(d, k, nb)), st = linkState(d, k, nb);
    const h = nb === 4 ? 0 : num(node(d, nb).hops);
    const ack = num(l.ack_pct), rssi = num(l.wifi_rssi);
    const loop = nb !== 4 && num(node(d, nb).next_hop) === k;
    const row: Candidate = { nb, st, h, ack, rssi, loop, cost: null, parts: '' };
    if (st === 'up' && h !== null && h < 255 && !loop) {
      const a = 10 * (h + 1), b = (100 - (ack === null ? 100 : ack)) / 5, c = Math.max(0, -70 - (rssi === null ? -50 : rssi)) / 2;
      const p = (k === 1 || k === 2) && nb !== 3 && chUp ? 20 : 0;
      row.cost = a + b + c + p;
      row.parts = fmtI(a) + ' + ' + fmt(b, 1) + ' + ' + fmt(c, 1) + ' + ' + p;
    }
    out.push(row);
  });
  return out;
}
