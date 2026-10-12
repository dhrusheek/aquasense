// TEMP_WARN pending state, shared by every TempWarnForm (views r1 and r6): after a threshold is
// sent, the form shows "sent 45.00 °C · waiting for N1" until N1 reports that value back or 30 s
// pass (app.js 753-759, 788). A module-level external store, read with useSyncExternalStore.
import { useEffect, useSyncExternalStore } from 'react';
import { fmt } from '@/lib/format';
import { num } from '@/lib/safe';

export interface TempWarnPending {
  /** The threshold that was sent, °C × 100. */
  v: number;
  /** performance.now() when the sink accepted it. */
  at: number;
}

/** How long a sent threshold is shown as pending when N1 never confirms it. */
export const TEMP_WARN_PENDING_MS = 30000;

let pending: TempWarnPending | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((cb) => cb());
}

export function getTempWarnPending(): TempWarnPending | null {
  return pending;
}

/** Set (after a successful TEMP_WARN post) or clear the pending threshold. It expires by itself after 30 s. */
export function setTempWarnPending(p: TempWarnPending | null): void {
  if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
  pending = p;
  if (p) {
    const left = Math.max(0, TEMP_WARN_PENDING_MS - (performance.now() - p.at));
    timer = setTimeout(() => { timer = undefined; pending = null; emit(); }, left);
  }
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/**
 * The pending threshold, or null. Pass N1's reported `temp_warn` (°C × 100) to have the pending
 * state cleared as soon as N1 confirms the value.
 */
export function useTempWarnPending(reported?: number | null): TempWarnPending | null {
  const p = useSyncExternalStore(subscribe, getTempWarnPending, () => null);
  const confirmed = p !== null && reported != null && reported === p.v;
  useEffect(() => {
    if (confirmed) setTempWarnPending(null);
  }, [confirmed]);
  return confirmed ? null : p;
}

/** A threshold in °C × 100 as text: "60.00 °C", or "— (not reported yet)" (app.js 739). */
export function twText(v: unknown): string {
  const n = num(v);
  return n === null ? '— (not reported yet)' : fmt(n / 100, 2, '°C');
}
