// Contention-test maths, ported 1:1 from server/static/app.js 953-1025 (parseCT, laneHTML, explainCT).
// Pure functions: the drawing lives in ContentionLanes.tsx, the sentences in ExplainList.tsx.
import type { ContentionTest } from '@/data/types';
import { evClass } from '@/lib/events';
import { fmt, fmtSec } from '@/lib/format';
import { arr, num } from '@/lib/safe';

export interface CtEvent {
  /** Offset from the trigger in µs. */
  us: number;
  ev: string;
}

/**
 * One lane of `contention_test`: strings such as "+2100us TX" (a `ms` suffix is ×1000) or objects
 * `{ us | t, ev | e }`, sorted by offset.
 */
export function parseCT(list: unknown): CtEvent[] {
  return arr<unknown>(list).map((x): CtEvent => {
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      return { us: num(o.us != null ? o.us : o.t) || 0, ev: String(o.ev || o.e || '') };
    }
    const m = /^\s*\+?\s*(-?\d+(?:\.\d+)?)\s*(us|µs|ms)?\s*(.*)$/i.exec(String(x));
    if (!m) return { us: 0, ev: String(x) };
    let v = Number(m[1]);
    if ((m[2] || '').toLowerCase() === 'ms') v *= 1000;
    return { us: v, ev: m[3] || '' };
  }).sort((a, b) => a.us - b.us);
}

/** Right edge of the time axis in µs: the latest event (at least 1 ms) plus 8 %. */
export function maxUsOf(...lanes: CtEvent[][]): number {
  return Math.max(...lanes.flat().map((e) => e.us), 1000) * 1.08;
}

export type SegKind = 'backoff' | 'defer' | 'wait' | 'retx';

export interface LaneSegment {
  kind: SegKind;
  /** Position and length as a percentage of the track. */
  left: number;
  width: number;
  /** The event that opens the segment (tooltip). */
  ev: string;
  /** Width in % of the ink tick at the transmit instant; null for every segment but a TX. */
  tick: number | null;
}

/** Segments span from one event to the next: backoff, defer, ACK wait, timeout / retransmission. */
export function laneSegments(evs: CtEvent[], maxUs: number): LaneSegment[] {
  const out: LaneSegment[] = [];
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i], nx = evs[i + 1];
    if (!nx || nx.us <= e.us) continue;
    const c = evClass(e.ev);
    const kind: SegKind | null = c === 'BACKOFF' ? 'backoff'
      : c === 'DEFER' || c === 'CS_BUSY' ? 'defer'
        : c === 'TX' ? 'wait'
          : c === 'RETX' || c === 'ACK_TIMEOUT' ? 'retx'
            : null;
    if (!kind) continue;
    const width = (nx.us - e.us) / maxUs * 100;
    out.push({ kind, left: e.us / maxUs * 100, width, ev: e.ev, tick: c === 'TX' ? Math.min(1.5, width) : null });
  }
  return out;
}

export interface LaneMark {
  us: number;
  /** Position as a percentage of the track. */
  left: number;
  /** "+2.1 ms TX · ACK_OK": events closer than 3 % of the axis share one mark. */
  label: string;
}

export function laneMarks(evs: CtEvent[], maxUs: number): LaneMark[] {
  const groups: { us: number; evs: string[] }[] = [];
  evs.forEach((e) => {
    const g = groups[groups.length - 1];
    if (g && Math.abs(g.us - e.us) < maxUs * 0.03) g.evs.push(e.ev);
    else groups.push({ us: e.us, evs: [e.ev] });
  });
  return groups.map((g) => ({
    us: g.us,
    left: g.us / maxUs * 100,
    label: '+' + fmt(g.us / 1000, 1) + ' ms ' + g.evs.join(' · '),
  }));
}

/** Five axis labels, 0 … maxUs, in ms with one decimal. */
export function axisTicks(maxUs: number): string[] {
  return [0, 1, 2, 3, 4].map((i) => fmt(maxUs * i / 4 / 1000, 1) + ' ms');
}

/* ---------- plain-language explanation ---------- */

/** A lane split into attempts: backoff → TX → ACK_OK | ACK_TIMEOUT. */
interface LaneInfo {
  bo: (number | null)[];
  tx: number[];
  ack: number | null;
  to: number[];
  defer: number[];
}

function info(evs: CtEvent[]): LaneInfo {
  const r: LaneInfo = { bo: [], tx: [], ack: null, to: [], defer: [] };
  evs.forEach((e) => {
    const c = evClass(e.ev);
    if (c === 'BACKOFF') {
      const m = /BACKOFF\s*(\d+)/i.exec(e.ev);
      r.bo.push(m ? Number(m[1]) : null);
    } else if (c === 'TX' || c === 'RETX') r.tx.push(e.us);
    else if (c === 'ACK_OK') r.ack = e.us;
    else if (c === 'ACK_TIMEOUT') r.to.push(e.us);
    else if (c === 'DEFER' || c === 'CS_BUSY') r.defer.push(e.us);
  });
  return r;
}

function ms(us: number | null | undefined): string {
  return us == null ? '?' : '+' + fmt(us / 1000, 1) + ' ms';
}
function bo(x: LaneInfo, i: number): string {
  const v = x.bo[i];
  return v == null ? '?' : v + ' slot' + (v === 1 ? '' : 's');
}

export interface Explanation {
  title: string;
  steps: string[];
  verdict: string;
}

/** What the two lanes show, step by step, and the verdict. Null when neither lane has an event. */
export function explainCT(ct: ContentionTest | null | undefined): Explanation | null {
  const a = parseCT(ct?.N1), b = parseCT(ct?.N2);
  if (!a.length && !b.length) return null;
  const A = info(a), B = info(b), li: string[] = [];
  li.push('At network time ' + fmtSec(ct?.at) + ' N1 and N2 both called macSend() for a DATA frame to N3 at the same instant (CTRL CONTENTION_TEST).');
  li.push('Both sensed the channel idle for DIFS and drew a random backoff: N1 = ' + bo(A, 0) + ', N2 = ' + bo(B, 0) + ' (1 slot = 1 ms)'
    + (A.bo[0] != null && A.bo[0] === B.bo[0] ? ' — the same value, so their counters expired together.' : '.'));
  const collided = A.tx.length > 0 && B.tx.length > 0 && A.to.length > 0 && B.to.length > 0
    && A.to[0] > A.tx[0] && B.to[0] > B.tx[0] && Math.abs(A.tx[0] - B.tx[0]) < 2000;
  const lanes: [string, LaneInfo][] = [['N1', A], ['N2', B]];
  const byTx = (k: number) => (x: [string, LaneInfo], y: [string, LaneInfo]) =>
    (x[1].tx[k] == null ? 1e12 : x[1].tx[k]) - (y[1].tx[k] == null ? 1e12 : y[1].tx[k]);
  if (collided) {
    li.push('Both transmitted at ' + ms(A.tx[0]) + ' / ' + ms(B.tx[0]) + ' → the frames collided at N3 and neither was ACKed.');
    li.push('At ' + ms(Math.min(A.to[0], B.to[0])) + ' both hit ACK_TIMEOUT (40 ms), doubled the contention window and drew new backoffs: N1 = ' + bo(A, 1) + ', N2 = ' + bo(B, 1) + '.');
    lanes.sort(byTx(1));
    const w = lanes[0], l = lanes[1];
    li.push(w[0] + '\'s new backoff expired first → it retransmitted at ' + ms(w[1].tx[1]) + (w[1].ack != null ? ', ACK at ' + ms(w[1].ack) + '.' : '.'));
    const ld = l[1].defer.filter((t) => t > (l[1].to[0] || 0)).length;
    li.push(l[0] + (ld ? ' sensed the channel busy, froze its backoff (DEFER) and' : '') + ' retransmitted at ' + ms(l[1].tx[1]) + (l[1].ack != null ? ', ACK at ' + ms(l[1].ack) + '.' : '.'));
  } else {
    lanes.sort(byTx(0));
    const f = lanes[0], s2 = lanes[1];
    li.push(f[0] + '\'s backoff expired first → it transmitted at ' + ms(f[1].tx[0]) + (f[1].ack != null && !f[1].to.length ? ' and got the ACK at ' + ms(f[1].ack) + '.' : '.'));
    if (s2[1].tx[0] == null) li.push(s2[0] + ' did not transmit in the recorded window.');
    else li.push(s2[0] + (s2[1].defer.length ? ' sensed the channel busy, froze its backoff counter (DEFER) and' : '') + ' transmitted at ' + ms(s2[1].tx[0]) + (s2[1].ack != null ? ', ACK at ' + ms(s2[1].ack) + '.' : '.'));
  }
  const okBoth = A.ack != null && B.ack != null;
  const verdict = collided
    ? 'Collision detected by the missing ACK and resolved by retransmission with binary exponential backoff' + (okBoth ? ' — both frames were finally delivered.' : '.')
    : (A.to.length + B.to.length
      ? 'ACK timeouts occurred and were recovered by retransmission.'
      : 'No collision — carrier sensing + random backoff serialised the two transmissions' + (okBoth ? ' and both frames were ACKed.' : '.'));
  return { title: 'How the MAC resolved the simultaneous attempt', steps: li, verdict };
}
