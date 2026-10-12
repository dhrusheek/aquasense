// Shape of GET /api/state (docs/PROTOCOL_SPEC.md §9, server/static/mock_state.json).
// Everything the server may omit is optional and nullable. Never index raw state in components;
// go through @/data/selectors.

export type Num = number | null | undefined;
export type Str = string | null | undefined;
export type NodeId = 'N1' | 'N2' | 'N3' | 'N4';
export type NodeNum = 1 | 2 | 3 | 4;
export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';

export interface MacCounters { tx?: Num; retx?: Num; ok?: Num; to?: Num; busy?: Num; bo?: Num; col?: Num; def?: Num }
export interface Tdma { slot?: Num; ver?: Num; awake_ms?: Num; sleep_ms?: Num; duty?: Num }
export interface BleRow { id?: Str; rssi?: Num; dist_cm?: Num }
export interface AggCounters { in?: Num; out?: Num; bi?: Num; bo?: Num }
export interface NodeState {
  id?: Str; num?: Num; role?: Str; sensor?: Str; unit?: Str; status?: Str; last_seen_s?: Num;
  mac_addr?: Str; mac?: MacCounters | string | null;      // legacy tolerates mac as string (app.js 203-207)
  uptime_s?: Num; value?: Num; seq?: Num; value_ts?: Num; threshold?: boolean | null; temp_warn?: Num;
  route?: Str; next_hop?: Num; hops?: Num; alt_next_hop?: Num; route_cost?: Num; alt_cost?: Num;
  delay_ms?: Num; wifi_rssi?: Num; ble_rssi?: Num;
  rx_count?: Num; first_seq?: Num; max_seq?: Num; lost?: Num; tx_count?: Num; fwd_count?: Num; oor?: Num;
  tdma?: Tdma | null; ble?: BleRow[] | null; nearest?: Str; events?: string[] | null; agg?: AggCounters | null;
}
export interface ScheduleHist { ver?: Num; why?: Str; t?: Num }
export interface Schedule { ver?: Num; sf?: Num; slot_ms?: Num; slots?: Num[] | null; t0?: Num; master?: Num; why?: Str; history?: ScheduleHist[] | null }
export interface AggInput { v?: Num; q?: Num; ts?: Num; cnt?: Num; mean?: Num; min?: Num; max?: Num; th?: Num }
export interface AggCum { in?: Num; out?: Num; bytes_in?: Num; bytes_out?: Num; reduction_packets_pct?: Num; reduction_bytes_pct?: Num }
export interface Aggregation { window?: Num; in?: Num; bytes_in?: Num; bytes_out?: Num; reduction_pct?: Num;
  n1?: AggInput | null; n2?: AggInput | null; n3?: AggInput | null; path?: Str; delay_ms?: Num; cum?: AggCum | null }
export type XY = [number, number];
export interface LocTarget { id?: Str; est?: Num[] | null; true?: Num[] | null; err_cm?: Num; anchors?: { id?: Str; dist_cm?: Num }[] | null }
export interface Localization { params?: { rssi_1m?: Num; n?: Num } | null; positions_true?: Partial<Record<NodeId, Num[]>> | null;
  matrix?: { from?: Str; to?: Str; rssi?: Num; dist_cm?: Num }[] | null; targets?: LocTarget[] | null; nearest?: Partial<Record<NodeId, Str>> | null }
export interface Link { a?: Str; b?: Str; up?: boolean | null; wifi_rssi?: Num; ble_rssi?: Num; ack_pct?: Num; blocked?: boolean | null }
export interface MacLogRow { t?: Num; node?: Str; ev?: Str }
export interface MsgLogRow { t?: Num; type?: Str; cast?: Str; from?: Str; to?: Str; seq?: Num; acked?: boolean | null; path?: Str }
export interface EventRow { t?: Num; node?: Str; type?: Str; msg?: Str }
export interface Counters { bcast?: Record<string, Num> | null; ucast?: Record<string, Num> | null }
export type ContentionTest = { at?: Num } & Partial<Record<NodeId, string[]>>;
export type LightState = 'green' | 'red' | 'hot' | 'stale' | 'test' | 'off';
export interface Light { state?: Str; reason?: Str; since?: Num; pins?: Partial<Record<'green' | 'red', Num>> | null }
export interface MinMax { last?: Num; avg?: Num; min?: Num; max?: Num }
export interface Metrics { pdr?: Record<string, Num>; packet_loss?: Record<string, Num>; lost_total?: Num; rx_total?: Num;
  delay_ms?: Record<string, MinMax>; throughput_bps?: Record<string, Num>; retransmissions?: Record<string, Num>;
  loc_err_cm?: Record<string, MinMax>; reduction_pct?: { packets?: Num; bytes?: Num } }
export type Series = Partial<Record<'t' | 'pdr_N1' | 'pdr_N2' | 'delay_N1' | 'delay_N2' | 'delay_N3' | 'throughput'
  | 'retx_total' | 'loc_err_N1' | 'reduction' | 'value_N1' | 'value_N2' | 'value_N3', Num[]>>;
export interface RouteHist { t?: Num; node?: Str; from?: Str; to?: Str; reason?: Str }
export interface LightHist { t?: Num; state?: Str; reason?: Str; received_at?: Str }
export interface Derived { received_at?: Str; age_s?: Num; online?: boolean | null; source?: Str; metrics?: Metrics | null;
  series?: Series | null; demo_flow?: Record<string, boolean> | null; schedule_history?: ScheduleHist[] | null;
  route_history?: RouteHist[] | null; light_history?: LightHist[] | null }
export interface State {
  source?: Str; sink?: Str; net_time?: Num; sf?: Num; uptime_s?: Num; sched_master?: Num; sink_ip?: Str; sink_mac?: Str; channel?: Num;
  nodes?: NodeState[] | null; schedule?: Schedule | null; aggregation?: Aggregation | null; localization?: Localization | null;
  light?: Light | null; links?: Link[] | null; mac_log?: MacLogRow[] | null; msg_log?: MsgLogRow[] | null; events?: EventRow[] | null;
  counters?: Counters | null; contention_test?: ContentionTest | null; derived?: Derived | null;
}
export type CommandName = 'LINK_FAIL' | 'LINK_RESTORE' | 'CONTENTION_TEST' | 'SCHED_UPDATE' | 'RESET_STATS'
  | 'NODE_KILL' | 'NODE_WAKE' | 'TEMP_WARN' | 'LIGHT_TEST';
export interface Command { c: CommandName; a?: number; b?: number; dur?: number; v?: number }
export interface CommandOk { ok: true; id: number; command: Command & { id: number } }
export interface CommandErr { ok: false; error: string }
