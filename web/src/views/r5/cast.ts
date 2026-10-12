// Message cast of view r5: the frame types per cast and the legacy classification rule (app.js 1147-1164).

export type Cast = 'broadcast' | 'unicast';
export type FeedFilter = 'all' | Cast;

export interface FrameType {
  /** Key into counters.bcast / counters.ucast. */
  k: string;
  desc: string;
}

/** Sent to FF:FF:FF:FF:FF:FF, never ACKed. */
export const BCAST_TYPES: FrameType[] = [
  { k: 'HELLO', desc: 'neighbour discovery + route control' },
  { k: 'SCHED', desc: 'schedule beacon from N3' },
  { k: 'CTRL', desc: 'dashboard commands' },
];

/** Sent to one MAC, ACKed hop by hop. */
export const UCAST_TYPES: FrameType[] = [
  { k: 'DATA', desc: 'sensor readings' },
  { k: 'AGG', desc: 'aggregated N3 → N4' },
  { k: 'STAT', desc: 'node counters' },
  { k: 'ACK', desc: 'link-layer acks' },
];

/** `msg_log[].cast` lower-cased, as the legacy filter compares it. */
export function castKey(cast: unknown): string {
  return String(cast).toLowerCase();
}

/** Anything that is not "broadcast" reads as unicast (app.js 1163). */
export function castOf(cast: unknown): Cast {
  return castKey(cast) === 'broadcast' ? 'broadcast' : 'unicast';
}
