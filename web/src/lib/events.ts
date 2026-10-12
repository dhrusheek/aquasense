// MAC event classification (app.js 163-176) and route-string parsing (app.js 155-162).
import { nNum } from '@/lib/safe';

export type EvClass =
  | 'CS_BUSY' | 'BACKOFF' | 'TX' | 'ACK_OK' | 'ACK_TIMEOUT' | 'RETX' | 'DEFER' | 'NEAR_COLLISION' | 'OTHER';

/** Classify a free-text MAC log event ("BACKOFF 3 slots", "TX DATA q=12", "ACK_TIMEOUT -> RETX"). */
export function evClass(ev: unknown): EvClass {
  const e = String(ev || '').toUpperCase();
  if (e.indexOf('NEAR_COLLISION') >= 0 || e.indexOf('COLLISION') >= 0) return 'NEAR_COLLISION';
  if (e.indexOf('ACK_TIMEOUT') >= 0 || e.indexOf('TIMEOUT') >= 0) return 'ACK_TIMEOUT';
  if (e.indexOf('ACK_OK') >= 0) return 'ACK_OK';
  if (e.indexOf('DEFER') >= 0) return 'DEFER';
  if (e.indexOf('CS_BUSY') >= 0) return 'CS_BUSY';
  if (e.indexOf('RETX') >= 0) return 'RETX';
  if (e.indexOf('BACKOFF') >= 0) return 'BACKOFF';
  if (/(^|\W)TX(\W|$)/.test(e)) return 'TX';
  return 'OTHER';
}

export const EV_LABEL: Record<EvClass, string> = {
  CS_BUSY: 'Channel busy', BACKOFF: 'Backoff', TX: 'Transmit', ACK_OK: 'ACK received', ACK_TIMEOUT: 'ACK timeout',
  RETX: 'Retransmit', DEFER: 'Defer', NEAR_COLLISION: 'Near-collision', OTHER: 'Event',
};

/** "1>2>3>4" → [1, 2, 3, 4]. Null, empty and non-numeric hops are dropped. */
export function parsePath(p: unknown): number[] {
  if (p == null || p === '') return [];
  return String(p).split('>').map((h) => nNum(h.trim())).filter((n): n is number => n !== null);
}
