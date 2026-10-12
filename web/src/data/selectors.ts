// Pure accessors over the store snapshot, ported 1:1 from server/static/app.js
// (190-272 data accessors, 547-562 slot helpers, 1417-1436 top bar).
//
// Conventions
// - `d` selectors read only the state document. They accept the document (`State | null`) or the
//   whole `Snapshot`, so `nodes(useAppState())` and `nodes(useSnapshot())` are the same call.
// - `s` selectors need the fetch clock and take the `Snapshot`.
// - tAgo / whenStr take the network clock first: either `now` from `useNetNow()` or a `Snapshot`.
import type { Snapshot } from '@/data/store';
import type {
  Derived, Light, LightState, Link, MacCounters, Metrics, NodeId, NodeState, Schedule, Series, State, Tone, XY,
} from '@/data/types';
import { DEFAULT_POS, DEFAULT_SLOTS, LIGHT, NODE_IDS, RELEASE, SIM } from '@/lib/constants';
import { fmt, fmtAgo, fmtI, tempC } from '@/lib/format';
import { arr, get, nId, nNum, num, obj } from '@/lib/safe';

/** The state document, or a snapshot holding it. */
export type Src = Snapshot | State | null | undefined;
/** The network clock: `now` in ms from useNetNow(), or a snapshot to read it from. */
export type Clock = Snapshot | number | null | undefined;

function isSnapshot(x: unknown): x is Snapshot {
  return !!x && typeof x === 'object' && 'recvPerf' in x && 'fetchOk' in x;
}
/** Legacy D(): the document, `{}` when nothing has arrived yet. */
function D(x: Src): State {
  return obj<State>(isSnapshot(x) ? x.data : x);
}

/* ---------- document ---------- */

/** derived.* (server-computed block). */
export function derived(d: Src): Derived {
  return obj<Derived>(D(d).derived);
}
export function metrics(d: Src): Metrics {
  return obj<Metrics>(derived(d).metrics);
}
export function series(d: Src): Series {
  return obj<Series>(derived(d).series);
}
/** derived.demo_flow: step name → shown. */
export function demoFlow(d: Src): Record<string, boolean> {
  return obj<Record<string, boolean>>(derived(d).demo_flow);
}

export function nodes(d: Src): NodeState[] {
  return arr<NodeState>(D(d).nodes);
}
/** The node whose `id` or `num` matches; `{}` when absent. */
export function node(d: Src, id: NodeId | number | string | null | undefined): NodeState {
  const n = nNum(id), list = nodes(d);
  for (let i = 0; i < list.length; i++) {
    const x = list[i] || {};
    if (nNum(x.id) === n || num(x.num) === n) return x;
  }
  return {};
}

/** MAC address of a node; N4 falls back to the sink's own `sink_mac`. */
export function macAddr(d: Src, n: NodeState | null | undefined): string | null {
  const x = obj<NodeState & { macaddr?: string | null; mac_address?: string | null }>(n);
  if (typeof x.mac === 'string') return x.mac;
  return x.mac_addr || x.macaddr || x.mac_address || (nNum(x.id) === 4 ? get<string | null>(D(d), 'sink_mac', null) : null);
}
/** MAC-layer counters of a node (`mac` object; legacy `mac_counters` / `mac_stats` tolerated). */
export function macCnt(n: NodeState | null | undefined): MacCounters {
  const x = obj<NodeState & { mac_counters?: MacCounters | null; mac_stats?: MacCounters | null }>(n);
  return obj<MacCounters>(typeof x.mac === 'object' ? x.mac : (x.mac_counters || x.mac_stats));
}

/** True positions in cm per node; DEFAULT_POS for any node the server has not placed. */
export function positions(d: Src): Record<NodeId, XY> {
  const p = obj<Partial<Record<NodeId, unknown>>>(get(D(d), 'localization.positions_true', null));
  const out = {} as Record<NodeId, XY>;
  NODE_IDS.forEach((id) => {
    const v = p[id];
    const x = Array.isArray(v) ? num(v[0]) : null, y = Array.isArray(v) ? num(v[1]) : null;
    out[id] = x !== null && y !== null ? [x, y] : DEFAULT_POS[id];
  });
  return out;
}

/** The links[] entry joining a and b, in either order. */
export function link(d: Src, a: NodeId | number | string, b: NodeId | number | string): Link | null {
  const A = nNum(a), B = nNum(b), L = arr<Link>(D(d).links);
  for (let i = 0; i < L.length; i++) {
    const l = L[i] || {};
    const la = nNum(l.a), lb = nNum(l.b);
    if ((la === A && lb === B) || (la === B && lb === A)) return l;
  }
  return null;
}
export function linkState(d: Src, a: NodeId | number | string, b: NodeId | number | string): 'up' | 'down' | 'unknown' {
  const l = link(d, a, b);
  if (!l) return 'unknown';
  if (l.blocked === true || l.up === false) return 'down';
  return 'up';
}

/** Pond status light at N4; an unknown state reads as `off`. */
export function lightOf(d: Src): {
  state: LightState; reason: string; since: number | null; pins: NonNullable<Light['pins']>;
} {
  const l = obj<Light>(D(d).light);
  const st = String(l.state || 'off').toLowerCase();
  return {
    state: Object.prototype.hasOwnProperty.call(LIGHT, st) ? (st as LightState) : 'off',
    reason: l.reason || '',
    since: num(l.since),
    pins: obj<NonNullable<Light['pins']>>(l.pins),
  };
}

/** A node's reading as value + unit: N1/N3 °C with 2 decimals, N2 integer + unit, N4 the light label. */
export function sensorText(s: Src, n: NodeState | null | undefined): { v: string; u: string } {
  const x = obj<NodeState>(n);
  const id = nId(x.id || x.num);
  if (id === 'N4') {
    const L = lightOf(s);
    return { v: (LIGHT[L.state] || LIGHT.off).label.split(' · ')[0], u: 'status light' };
  }
  if (id === 'N1' || id === 'N3') {
    const t = tempC(x.value);
    return { v: t === null ? '—' : fmt(t, 2), u: '°C' };
  }
  let unit = String(x.unit || 'raw ADC');
  unit = /raw\s*adc/i.test(unit) ? 'raw ADC' : unit.replace(/\s*\(.*\)\s*$/, '');
  return { v: num(x.value) === null ? '—' : fmtI(x.value), u: unit };
}

/** nodes[].threshold as a chip: N1 hot / normal (TEMP_WARN), N2 turbid / clear; null for N3 and N4. */
export function thresholdFlag(n: NodeState | null | undefined): { label: string; tone: Tone } | null {
  const x = obj<NodeState>(n);
  const id = nId(x.id || x.num), th = x.threshold;
  if (id !== 'N1' && id !== 'N2') return null;
  if (th !== true && th !== false) return { label: id === 'N1' ? 'alert flag: —' : 'turbidity flag: —', tone: 'neutral' };
  if (id === 'N1') return th ? { label: 'hot', tone: 'warn' } : { label: 'normal', tone: 'neutral' };
  return th ? { label: 'turbid', tone: 'bad' } : { label: 'clear', tone: 'neutral' };
}

/* ---------- clock ---------- */

/** Network time now in ms: net_time + age at the server + time since the fetch. Null before the first fetch. */
export function netNow(s: Snapshot): number | null {
  const d = D(s), base = num(d.net_time);
  if (base === null) return null;
  const age = num(get(d, 'derived.age_s', 0)) || 0;
  const elapsed = s.fetchOk ? performance.now() - s.recvPerf : 0;
  return base + age * 1000 + elapsed;
}
/** Seconds since the sink's last uplink; null until a poll has succeeded. */
export function ageNow(s: Snapshot): number | null {
  if (!s.everOk) return null;
  return (num(get(D(s), 'derived.age_s', 0)) || 0) + (performance.now() - s.recvPerf) / 1000;
}
export function isOnline(s: Snapshot): boolean {
  return s.fetchOk && get<unknown>(D(s), 'derived.online', true) !== false;
}

function clockOf(c: Clock): number | null {
  return isSnapshot(c) ? netNow(c) : num(c);
}
/** Network timestamp → "3.2 s ago" relative to the network clock; "—" when either is unknown. */
export function tAgo(now: Clock, t: unknown): string {
  const nn = clockOf(now), tt = num(t);
  return nn === null || tt === null ? '—' : fmtAgo((nn - tt) / 1000);
}
/**
 * Row time for humans: the HH:MM:SS of the server wall clock `received_at` when the row has one,
 * else `tAgo(row.t)`. `row` may also be the `received_at` string itself.
 */
export function whenStr(now: Clock, row: { received_at?: unknown; t?: unknown } | string | null | undefined): string {
  const rr = typeof row === 'string' ? row : row && row.received_at;
  if (rr) {
    const mm = /(\d{2}:\d{2}:\d{2})/.exec(String(rr));
    return mm ? mm[1] : String(rr);
  }
  return tAgo(now, typeof row === 'string' ? null : row && row.t);
}
/** Network timestamp in ms → "t=348.0 s". */
export function netT(t: unknown): string {
  const tt = num(t);
  return tt === null ? '—' : 't=' + fmt(tt / 1000, 1) + ' s';
}

/* ---------- TDMA schedule ---------- */

export function schedule(d: Src): Schedule {
  return obj<Schedule>(D(d).schedule);
}
/** Owner per slot (0 = control, 255 = unused); DEFAULT_SLOTS when the schedule has none. */
export function slots(d: Src): number[] {
  const raw = arr(schedule(d).slots);
  if (!raw.length) return DEFAULT_SLOTS.slice();
  return raw.map((o) => num(o) ?? 255); // legacy treats a null owner as unused
}

export interface SlotInfo {
  cls: 'control' | 'unused' | 'beacon' | 'owner';
  /** "ALL", "UNUSED" or "N<k>". */
  owner: string;
  /** Owning node number; null for control and unused slots. */
  ownerNum: number | null;
  kind: string;
}
export function slotInfo(i: number, slots: readonly unknown[], master: unknown): SlotInfo {
  const o = num(slots[i]);
  if (o === 0) return { cls: 'control', owner: 'ALL', ownerNum: null, kind: 'CONTROL · CSMA (HELLO, CTRL)' };
  if (o === 255 || o === null) return { cls: 'unused', owner: 'UNUSED', ownerNum: null, kind: 'Everyone sleeps' };
  if (i === 0) return { cls: 'beacon', owner: 'N' + o, ownerNum: o, kind: 'BEACON · SCHED broadcast' + (num(master) === 4 ? ' (backup)' : '') };
  const first = slots.indexOf(slots[i], 1) === i; // first non-beacon slot of this owner
  const kind = o === 3 ? 'AGG + STAT → N4' : o === 4 ? 'Sink TX' : (first ? 'DATA + STAT' : 'Retransmission slot');
  return { cls: 'owner', owner: 'N' + o, ownerNum: o, kind };
}

export interface CurrentSlot {
  /** Index of the slot the network is in now. */
  idx: number;
  /** Position inside the superframe, 0..1. */
  frac: number;
  /** Slots per superframe. */
  n: number;
  /** Slot length in ms. */
  sl: number;
  /** Superframes elapsed since schedule.t0. */
  sfOff: number;
}
export function currentSlot(s: Snapshot): CurrentSlot | null {
  const sc = schedule(s), t0 = num(sc.t0), sl = num(sc.slot_ms) || 500, n = arr(sc.slots).length || 6, nn = netNow(s);
  if (t0 === null || nn === null) return null;
  const sfMs = sl * n, ph = ((nn - t0) % sfMs + sfMs) % sfMs;
  return { idx: Math.floor(ph / sl), frac: ph / sfMs, n, sl, sfOff: Math.floor((nn - t0) / sfMs) };
}

/* ---------- top bar ---------- */

function sourceOf(s: Snapshot): string {
  return String(get<unknown>(derived(s), 'source', get<unknown>(D(s), 'source', '')) || '').toLowerCase();
}
/** Where the data comes from, as a sentence fragment for the overview. */
export function sourceLabel(s: Snapshot): string {
  if (SIM) return RELEASE ? 'Demo pond (simulated)' : 'Simulation (recorded run)';
  if (s.mock) return 'Preview (mock data)';
  const src = sourceOf(s);
  return src === 'hardware' ? 'ESP32 hardware' : src === 'simulator' ? 'Simulator' : '—';
}
/** Top-bar badge: HARDWARE | SIMULATOR | — , prefixed PREVIEW · in mock mode (PREVIEW · MOCK when the source is unknown). */
export function sourceBadge(s: Snapshot): { text: string; kind: 'hw' | 'sim' | 'mock' | 'none' } {
  const src = sourceOf(s);
  let text = src === 'hardware' ? 'HARDWARE' : src === 'simulator' ? 'SIMULATOR' : '—';
  if (SIM) return { text: RELEASE ? 'Demo pond' : 'SIMULATION', kind: 'sim' };
  if (s.mock) text = 'PREVIEW · ' + (text === '—' ? 'MOCK' : text);
  return { text, kind: s.mock ? 'mock' : src === 'hardware' ? 'hw' : src === 'simulator' ? 'sim' : 'none' };
}
/**
 * Online pill. `text` is the exact legacy sentence; `short` is the phone form; `stable` is `text`
 * without the ticking age, for a live region that should speak only when the state changes.
 */
export function onlineText(s: Snapshot): { tone: Tone; text: string; short: string; stable: string } {
  const age = ageNow(s), on = isOnline(s);
  if (!s.everOk) {
    return s.fetchFailed
      ? { tone: 'neutral', text: 'Offline · dashboard server unreachable', short: 'Offline', stable: 'Offline · dashboard server unreachable' }
      : { tone: 'neutral', text: 'Connecting…', short: 'Connecting…', stable: 'Connecting…' };
  }
  if (on) return { tone: 'ok', text: 'Online · last update ' + fmtAgo(age), short: 'Online', stable: 'Online' };
  if (!s.fetchOk) {
    const t = 'Offline · server unreachable, showing last data';
    return { tone: 'bad', text: t, short: 'Offline', stable: t };
  }
  if (get<unknown>(derived(s), 'received_at', null) == null) {
    const t = 'Offline · waiting for the first uplink from the sink';
    return { tone: 'bad', text: t, short: 'Offline', stable: t };
  }
  return { tone: 'bad', text: 'Offline · sink silent, last data ' + fmtAgo(age), short: 'Offline', stable: 'Offline · sink silent' };
}
