// Raw sink events → plain sentences (spec 05 §4.8). Pure and total: every EventRow gives a
// sentence and a tone, and nothing here ever throws or prints raw JSON.
//
// How to audit: RULES is the §4.8 table, top to bottom. Each row is
//   kind  the event `type` the row belongs to (the `sched` type is filed under `tdma`)
//   re    the regex run on `msg`; m[1], m[2] … are its groups
//   say   the sentence; N is the reporting node ("N1"), or "A node" when the row has none
//   tone  the status tone of the line
// The first row that matches wins. Rows of the event's own type are tried first, then every row:
// the simulator, the mock and the firmware do not always agree on the type of the same message
// (the firmware logs `light -> green` as `ctrl` and `LINK_FAIL … expired` as `route`).
// Rows marked "extra" are message shapes that exist in firmware/wsn_node or server/simulator.py
// but not in the spec table.
import type { EventRow, Tone } from '@/data/types';
import { nId, num } from '@/lib/safe';

export type EventKind = 'route' | 'tdma' | 'light' | 'ctrl' | 'mac' | 'node' | 'other';

export interface Interpreted {
  text: string;
  tone: Tone;
  /** The filter group of the line: the matched row's kind, else the event's own type. */
  kind: EventKind;
}

interface Rule {
  kind: Exclude<EventKind, 'other'>;
  re: RegExp;
  say: (m: RegExpExecArray, N: string) => string;
  tone: Tone | ((m: RegExpExecArray) => Tone);
}

/** Subject used when the event names no node. */
const NOBODY = 'A node';

/** `before + value + after` when the group matched, else nothing. */
function opt(before: string, value: string | undefined, after: string = ''): string {
  return value ? before + value + after : '';
}

/** Pond status light states (spec §9.3). Unknown words fall through to "Pond light turned <word>". */
const LIGHT_SAYS: Record<string, { text: string; tone: Tone }> = {
  green: { text: 'Pond light turned green — all nominal', tone: 'ok' },
  red: { text: 'Pond light turned red — water turbid', tone: 'bad' },
  // The four below are reworded from the table's "turned $1 — reason" so they read as sentences.
  hot: { text: 'Pond light is blinking red — N1 enclosure is over its threshold', tone: 'bad' },
  stale: { text: 'Pond light is blinking green — no data for 9 s', tone: 'warn' },
  test: { text: 'Pond light is running its test cycle', tone: 'info' },
  off: { text: 'Pond light turned off', tone: 'info' },
};

const RULES: Rule[] = [
  /* ---- route ---- */
  { kind: 'route', re: /^LINK_DOWN (N\d)(?: \((.+)\))?/, tone: 'bad',
    say: (m, N) => `${N} lost its link to ${m[1]}` + opt(' — ', m[2]) },
  { kind: 'route', re: /^LINK_UP (N\d)/, tone: 'ok',
    say: (m, N) => `${N} can hear ${m[1]} again` },
  // "ROUTE RESTORED", "ROUTE RESTORED N3 cost 30→20" and the firmware's "ROUTE RESTORED N2→N3 cost 30→20":
  // m[1] is always the hop the node is back on.
  { kind: 'route', re: /^ROUTE RESTORED(?: (?:N\d→)?(N\d))?(?: cost (\d+)→(\d+))?/, tone: 'ok',
    say: (m, N) => `${N} is back on its primary route` + opt(' via ', m[1]) + (m[2] && m[3] ? ` (cost ${m[2]} → ${m[3]})` : '') },
  { kind: 'route', re: /^ROUTE (N\d)→(N\d) cost (\d+)→(\d+)/, tone: 'warn',
    say: (m, N) => `${N} switched its next hop from ${m[1]} to ${m[2]} (cost ${m[3]} → ${m[4]})` },
  // extra: first route after boot ("ROUTE -→N3 cost -→20" in the simulator, "ROUTE via N3 cost 20" in firmware)
  { kind: 'route', re: /^ROUTE (?:-→|via )(N\d) cost (?:-→)?(\d+)/, tone: 'info',
    say: (m, N) => `${N} chose ${m[1]} as its next hop (cost ${m[2]})` },
  // extra: no usable neighbour left ("ROUTE N3→- cost 20→-", "NO_ROUTE (was N3)")
  { kind: 'route', re: /^ROUTE (N\d)→-|^NO_ROUTE(?: \(was (N\d)\))?/, tone: 'bad',
    say: (m, N) => `${N} has no route to the sink` + opt(' (was using ', m[1] || m[2], ')') },
  // extra: neighbour discovery
  { kind: 'route', re: /^NEIGHBOUR (N\d)/, tone: 'info',
    say: (m, N) => `${N} found ${m[1]} as a neighbour` },
  { kind: 'route', re: /^BLE DISCOVERED (N\d)/, tone: 'info',
    say: (m, N) => `${N} found ${m[1]} over BLE` },

  /* ---- tdma, sched ---- */
  // "SCHED ver 4 broadcast", "Schedule v4: retx slot for N1", "SCHED v4 retx slot for N1":
  // m[1] the version, m[2] the reason; a bare "broadcast" suffix is dropped.
  { kind: 'tdma', re: /^(?:SCHED|Schedule) v(?:er )?(\d+)(?:[:\s]\s*(.+))?/, tone: 'info',
    say: (m, N) => `${N === NOBODY ? 'N3' : N} broadcast schedule v${m[1]}` + opt(' — ', (m[2] ?? '').replace(/\s*\bbroadcast$/, '')) },
  { kind: 'tdma', re: /became backup scheduler/, tone: 'warn',
    say: () => 'N4 took over as backup scheduler' },
  { kind: 'tdma', re: /resumed as scheduler|yields to N3/, tone: 'ok',
    say: () => 'N3 is the scheduler again' },

  /* ---- light ---- */
  { kind: 'light', re: /^light -> (\w+)/,
    tone: (m) => LIGHT_SAYS[m[1].toLowerCase()]?.tone ?? 'info',
    say: (m) => LIGHT_SAYS[m[1].toLowerCase()]?.text ?? `Pond light turned ${m[1]}` },

  /* ---- ctrl ---- */
  // "expired" comes first, so the row below never sees it.
  { kind: 'ctrl', re: /LINK_FAIL (N\d)[–-](N\d) expired/, tone: 'ok',
    say: (m) => `Block on ${m[1]}–${m[2]} expired` },
  // "LINK_FAIL N1–N3 for 40s", "CTRL LINK_FAIL N1–N3 40 s broadcast", "LINK_FAIL N1-N3 40s"
  { kind: 'ctrl', re: /LINK_FAIL (N\d)[–-](N\d)(?: for (\d+) ?s| (\d+) ?s)?/, tone: 'bad',
    say: (m) => `Dashboard blocked link ${m[1]}–${m[2]}` + opt(' for ', m[3] || m[4], ' s') },
  { kind: 'ctrl', re: /LINK_RESTORE (N\d)[–-](N\d)/, tone: 'ok',
    say: (m) => `Dashboard restored link ${m[1]}–${m[2]}` },
  { kind: 'ctrl', re: /CONTENTION_TEST (?:scheduled|at \d+)/, tone: 'info',
    say: () => 'Contention test scheduled' },
  { kind: 'ctrl', re: /CONTENTION_TEST executed/, tone: 'info',
    say: () => 'Contention test ran' },

  /* ---- mac ---- */
  { kind: 'mac', re: /CONTENTION_TEST done \((.+)\)/, tone: 'info',
    say: (m) => `Contention test finished: ${m[1]}` },
  // extra: the firmware's per-node result, "CONTENTION_TEST ACK_OK (4 steps)" / "… FAIL (9 steps)"
  { kind: 'mac', re: /CONTENTION_TEST (ACK_OK|FAIL) \((\d+) steps?\)/,
    tone: (m) => (m[1] === 'ACK_OK' ? 'ok' : 'bad'),
    say: (m, N) => `${N} finished the contention test in ${m[2]} steps` + (m[1] === 'ACK_OK' ? '' : ' without an ACK') },
  { kind: 'mac', re: /ACK_TIMEOUT x(\d+) to (N\d)/, tone: 'bad',
    say: (m, N) => `${N} got no ACK from ${m[2]} (${m[1]} ${m[1] === '1' ? 'time' : 'times'})` },

  /* ---- ctrl, continued ---- */
  { kind: 'ctrl', re: /SCHED_UPDATE requested/, tone: 'info',
    say: () => 'Dashboard asked for a new schedule' },
  // "TEMP_WARN 60.00 C (was 55.00 C)"; the firmware omits the "(was …)" part.
  { kind: 'ctrl', re: /TEMP_WARN ([\d.]+) C(?: \(was ([\d.]+) C\))?/, tone: 'info',
    say: (m) => `N1 alert threshold set to ${m[1]} °C` + opt(' (was ', m[2], ')') },
  { kind: 'ctrl', re: /RESET_STATS/, tone: 'info',
    say: () => 'Statistics reset from the dashboard' },

  /* ---- node ---- */
  // "N2 killed (simulated failure) for 30s"; the firmware says "KILL N2 30s".
  { kind: 'node', re: /killed.*for (\d+) ?s|^KILL N\d (\d+) ?s/, tone: 'bad',
    say: (m, N) => `${N} switched off for ${m[1] || m[2]} s (simulated failure)` },
  // "N2 woke up"; the firmware says "WAKE N2" or "WAKE N2 (kill expired)".
  { kind: 'node', re: /woke up|^WAKE N\d/, tone: 'ok',
    say: (_m, N) => `${N} is back` },
];

const KIND_OF_TYPE: Record<string, EventKind> = {
  route: 'route', tdma: 'tdma', sched: 'tdma', schedule: 'tdma', light: 'light', ctrl: 'ctrl', mac: 'mac', node: 'node',
};

function kindOfType(type: unknown): EventKind {
  return KIND_OF_TYPE[typeof type === 'string' ? type.toLowerCase() : ''] ?? 'other';
}

/** `msg` as one line of text; anything that is not text or a number reads as empty. */
function messageOf(msg: unknown): string {
  if (typeof msg === 'string') return msg.replace(/\s+/g, ' ').trim();
  return typeof msg === 'number' && Number.isFinite(msg) ? String(msg) : '';
}

function firstMatch(msg: string, kind: EventKind | null): { rule: Rule; m: RegExpExecArray } | null {
  for (const rule of RULES) {
    if (kind !== null && rule.kind !== kind) continue;
    const m = rule.re.exec(msg);
    if (m) return { rule, m };
  }
  return null;
}

/** One event as a sentence. Never throws; an unknown shape reads "N1: <message>". */
export function interpretEvent(e: EventRow | null | undefined): Interpreted {
  const row = e && typeof e === 'object' ? e : {};
  const msg = messageOf(row.msg);
  const id = nId(row.node);
  const N = id === '—' ? NOBODY : id;
  const kind = kindOfType(row.type);

  const hit = msg ? ((kind !== 'other' ? firstMatch(msg, kind) : null) ?? firstMatch(msg, null)) : null;
  if (hit) {
    const { rule, m } = hit;
    return { text: rule.say(m, N), tone: typeof rule.tone === 'function' ? rule.tone(m) : rule.tone, kind: rule.kind };
  }

  // Fallback: the message as the node sent it, or a sentence saying there was none.
  const what = kind === 'other' ? 'an event' : `a ${kind} event`;
  const text = msg
    ? (N === NOBODY ? msg : `${N}: ${msg}`)
    : `${N} reported ${what} with no message`;
  return { text, tone: 'neutral', kind };
}

/** Stable identity of an event row (the list key of a feed line). */
export function eventKey(e: EventRow | null | undefined): string {
  const row = e && typeof e === 'object' ? e : {};
  return `${num(row.t) ?? 'x'}|${nId(row.node)}|${messageOf(row.msg)}`;
}

/** The rows of `state.events`, newest first. Rows without a time go last; non-objects are dropped. */
export function newestFirst(events: readonly (EventRow | null | undefined)[] | null | undefined): EventRow[] {
  const rows = Array.isArray(events) ? events.filter((e): e is EventRow => !!e && typeof e === 'object') : [];
  return rows.sort((a, b) => (num(b.t) ?? -Infinity) - (num(a.t) ?? -Infinity));
}
