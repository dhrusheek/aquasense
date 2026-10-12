// Constants ported unchanged from server/static/app.js 10-69.
import type { ViewId } from '@/app/routes';
import type { LightState, NodeId, NodeNum, Tone, XY } from '@/data/types';

/** Static hosted build with no backend: the dashboard replays a recorded simulator run (VITE_AQ_SIM=1). */
export const SIM: boolean = import.meta.env.VITE_AQ_SIM === '1';

/** Public release site (VITE_AQ_RELEASE=1): implies SIM; five story pages instead of the dashboard views. */
export const RELEASE: boolean = import.meta.env.VITE_AQ_RELEASE === '1';

export const POLL_MS = 1000;
export const TIMEOUT_MS = 1500;

export const NODE_IDS: NodeId[] = ['N1', 'N2', 'N3', 'N4'];

/** Radio neighbours per node (N1 and N4 are out of range of each other). */
export const ALLOWED: Record<NodeNum, NodeNum[]> = { 1: [2, 3], 2: [1, 3, 4], 3: [1, 2, 4], 4: [2, 3] };
export const ALL_PAIRS: [NodeNum, NodeNum][] = [[1, 2], [1, 3], [2, 3], [2, 4], [3, 4], [1, 4]];

/** True positions in cm, used until localization.positions_true arrives. */
export const DEFAULT_POS: Record<NodeId, XY> = { N1: [50, 30], N2: [0, 0], N3: [120, 0], N4: [60, 90] };

export const SHORT_ROLE: Record<NodeId, string> = {
  N1: 'Sensor · Temp alert', N2: 'Relay · Turbidity', N3: 'Cluster head · Temp', N4: 'Sink · Light',
};

export const READING_LABEL: Record<'N1' | 'N2' | 'N3', string> = {
  N1: 'Enclosure temperature (N1, pond edge)', N2: 'Turbidity', N3: 'Enclosure temperature (N3, bank)',
};

/** N1 over-temperature alert threshold (spec §1.2, §9.1 TEMP_WARN{a:1, v}); v is °C × 100. */
export const TEMP_WARN: { def: number; minC: number; maxC: number; step: number } = { def: 6000, minC: 0, maxC: 150, step: 0.5 };

/** Exact pins from docs/PROTOCOL_SPEC.md §1. */
export const WIRING: Record<NodeId, string[]> = {
  N1: ['no wiring: ESP32 on-chip temperature sensor', 'USB power only', 'LED GPIO2 = awake / TX'],
  N2: ['V → 3V3', 'G → GND', 'A → GPIO34 (ADC1_CH6, 11 dB)', 'D → GPIO27 (INPUT_PULLUP)', 'probe 1/2/3/4 → board 1/2/3/4', 'LED GPIO2 = awake / TX'],
  N3: ['no wiring: ESP32 on-chip temperature sensor', 'LED GPIO2 = awake / TX'],
  N4: ['GPIO25 → green LED, GPIO27 → red LED, each via its resistor, cathodes → GND', 'USB → laptop (power + Serial 115200)', 'Wi-Fi STA → laptop hotspot, HTTP POST /api/data every 3 s', 'LED GPIO2 = awake / TX'],
};

/**
 * Pond status light at N4 (spec §9.3), two LEDs (red and green), in priority order: label, chip
 * tone, rule. Each flag is the freshest one the sink holds for that node, from an AGG or from a
 * DATA frame that reached it directly.
 */
export const LIGHT: Record<LightState, { label: string; tone: Tone; rule: string }> = {
  test: { label: 'Test · cycling', tone: 'info', rule: 'LIGHT_TEST: red, then green, 1 s each' },
  off: { label: 'Off', tone: 'neutral', rule: 'not time-synced yet / no sample received' },
  stale: { label: 'Green blinking', tone: 'warn', rule: 'no AGG and no direct DATA for 3 superframes (9 s)' },
  red: { label: 'Red', tone: 'bad', rule: 'freshest N2 flag is 1 (turbidity comparator D): water turbid' },
  hot: { label: 'Red blinking', tone: 'bad', rule: 'freshest N1 flag is 1 (N1 enclosure ≥ its TEMP_WARN threshold), water not turbid' },
  green: { label: 'Green', tone: 'ok', rule: 'everything else: all nominal' },
};

export interface DemoStep { k: string; v: ViewId; mod: string; see: string }

/** The 17-step integrated sequence; `k` is also the key into derived.demo_flow. */
export const DEMO_STEPS: DemoStep[] = [
  { k: 'BLE Discovery', v: 'r2', mod: 'ble_loc.h', see: 'Every node advertises as WSN-N<k> and scans; the RSSI matrix fills with the neighbour pairs.' },
  { k: 'RSSI Measurement', v: 'r2', mod: 'ble_loc.h', see: 'EMA-smoothed RSSI in dBm for every pair in the RSSI matrix.' },
  { k: 'Localization', v: 'r2', mod: 'sink.h', see: 'N1 estimated position (filled) vs true position (hollow) with the error in cm on the 2-D map.' },
  { k: 'Wi-Fi Initialization', v: 'r1', mod: 'mac.h', see: 'All four nodes show MAC address, channel and uptime; the sink shows its IP on the hotspot.' },
  { k: 'Dynamic Schedule Assignment', v: 'r4', mod: 'tdma.h', see: 'The slot strip shows the SCHED broadcast by N3: owner per slot, version and reason.' },
  { k: 'Channel Sensing', v: 'r3', mod: 'mac.h', see: 'CS_BUSY events in the MAC timeline and the per-node channel-busy counter.' },
  { k: 'Random Backoff', v: 'r3', mod: 'mac.h', see: 'BACKOFF n slots events, total backoff ms and the two contention-test lanes.' },
  { k: 'Scheduled Transmission', v: 'r4', mod: 'tdma.h', see: 'The live cursor sweeps the slots; each node sends DATA only in its own slot, sleeps otherwise.' },
  { k: 'Unicast Communication', v: 'r5', mod: 'mac.h', see: 'Message feed: DATA / AGG / STAT unicast with destination and ACK ✓.' },
  { k: 'Data Aggregation', v: 'r6', mod: 'aggregation.h', see: 'N1 + N2 + N3 inputs fused into one AGG frame; packet and byte reduction %.' },
  { k: 'Multi-Hop Routing', v: 'r7', mod: 'routing.h', see: 'Route strings such as 1>3>4 and hop counts per node; packets animate along the path.' },
  { k: 'Sink', v: 'r1', mod: 'sink.h', see: 'N4 collects AGG/STAT, computes PDR and delay, and posts JSON every 3 s (online pill green).' },
  { k: 'Link Failure', v: 'r7', mod: 'routing.h', see: 'Press "Simulate link failure N1–N3": the link turns dashed red on the map.' },
  { k: 'Failure Detection', v: 'r7', mod: 'routing.h', see: 'ACK timeouts lead to a LINK_DOWN event in the failure / recovery timeline.' },
  { k: 'Alternate Route Selection', v: 'r7', mod: 'routing.h', see: 'N1 switches to 1>2>3>4 (next hop N2) with its new route cost.' },
  { k: 'Route Recovery', v: 'r7', mod: 'routing.h', see: 'Press "Restore": HELLOs resume and ROUTE RESTORED brings 1>3>4 back.' },
  { k: 'Performance Analysis', v: 'r8', mod: 'sink.h', see: 'Metric table with formulas, measured values and interpretation; Export CSV.' },
];

/** Fallback TDMA superframe when schedule.slots is empty (app.js 1448): owner per slot, 0 = control, 255 = unused. */
export const DEFAULT_SLOTS: number[] = [3, 1, 2, 3, 0, 255];
